// A real model for the Live bench: Qwen 3 0.6B running in this tab on the
// GPU, through ExecuTorch's Wasm runtime and its WebGPU backend.
//
// Nothing here loads until the player asks for it. The loader script is
// served from /vendor/executorch/; the runtime's .wasm, the tokenizer library
// and the model come from Hugging Face at pinned revisions, are checked
// against their SHA-256, and are kept in the browser's Cache Storage.
//
// The generation loop follows the ExecuTorch WebGPU playground
// (pytorch/executorch, website/playground/webgpu/src/runtime/llm.js,
// BSD licence): the model file keeps its own key-value cache, forward() takes
// `tokens` [1, n] and `input_pos` [1] and returns the logits after the last
// token, and the loop that feeds it runs here.

const RUNTIME =
  "https://huggingface.co/executorch-community/ExecuTorch-WebGPU-Runtime/resolve/48a27434e9f3096f100d79a5d1e8437a124ca654/";
const MODEL =
  "https://huggingface.co/executorch-community/Qwen3-0.6B-ExecuTorch-WebGPU/resolve/65fa8ec0b8996b4a0157cdb89ea766b000b1134a/";

const FILES = {
  script: "/vendor/executorch/executorch_wasm_lib.js",
  wasm: {
    url: `${RUNTIME}executorch_wasm_lib.wasm`,
    sha256: "35a9087d0b6cd86c279e7111adfd54a58156bd993928b20f63348f1043652eb4",
    bytes: 6562188,
  },
  // @huggingface/transformers 3.0.2 (Apache-2.0), used for the tokenizer and
  // chat template only.
  tokenizerLib: {
    url: `${RUNTIME}vendor/transformers/transformers.min.js`,
    sha256: "495b03b846b315baab6ff2e2f048085e45684b910799e36c4d7f2b4be00cff72",
    bytes: 748496,
  },
  pte: {
    url: `${MODEL}qwen3_0_6b_q4gsw.pte`,
    sha256: "057af5734a6ce17cbf19598bcc0e972aed2401d1522eed41249675c1ab372ce6",
    bytes: 400532224,
  },
};

export const SPEC = {
  name: "Qwen 3 0.6B",
  megabytes: Math.round(FILES.pte.bytes / 1e6),
  maxCtx: 8960,
  prefillMax: 512,
  eos: [151645, 151643],
};

const CACHE = "harness-executorch-v2";
const OLD_CACHES = ["harness-executorch-v1"];

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, b => b.toString(16).padStart(2, "0")).join("");
}

// Download once, verify, keep. A cached copy is trusted: it was verified
// before it was stored.
async function fetchPinned(file, onProgress = () => {}) {
  const cache = globalThis.caches ? await caches.open(CACHE) : null;
  if (cache) for (const old of OLD_CACHES) caches.delete(old).catch(() => {});
  const hit = await cache?.match(file.url);
  if (hit) {
    onProgress(1);
    return new Uint8Array(await hit.arrayBuffer());
  }
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const bytes = new Uint8Array(file.bytes);
  const reader = res.body.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.byteLength > bytes.byteLength)
      throw new Error("the download is larger than expected");
    bytes.set(value, n);
    n += value.byteLength;
    onProgress(n / file.bytes);
  }
  if (n !== file.bytes || (await sha256(bytes)) !== file.sha256)
    throw new Error("the download doesn't match its checksum");
  try {
    await cache?.put(file.url, new Response(bytes));
  } catch {
    // No room, or a private window: it still works, it just won't be kept.
  }
  return bytes;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("could not load the runtime script"));
    document.head.append(el);
  });
}

let runtime = null;
function startRuntime() {
  runtime ??= (async () => {
    const wasmBinary = await fetchPinned(FILES.wasm);
    if (typeof globalThis.createExecuTorch !== "function")
      await loadScript(FILES.script);
    const et = await globalThis.createExecuTorch({
      wasmBinary,
      print: () => {},
      printErr: () => {},
    });
    await et.initWebGPU();
    return et;
  })();
  runtime.catch(() => (runtime = null));
  return runtime;
}

async function loadTokenizer() {
  // Import the pinned library from a blob, with import.meta.url pointed back
  // at where it came from.
  const code = new TextDecoder()
    .decode(await fetchPinned(FILES.tokenizerLib))
    .replaceAll("import.meta.url", JSON.stringify(FILES.tokenizerLib.url));
  const blob = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" })
  );
  let tj;
  try {
    tj = await import(/* @vite-ignore */ blob);
  } finally {
    URL.revokeObjectURL(blob);
  }
  tj.env.allowLocalModels = true;
  tj.env.allowRemoteModels = false;
  tj.env.useBrowserCache = false;
  tj.env.localModelPath = MODEL;
  return tj.AutoTokenizer.from_pretrained("tokenizer");
}

/**
 * The chat loop, independent of the runtime: give it a tokenizer and a
 * `forward(tokens, pos) → logits` and it turns messages into a reply.
 * Greedy decoding, so the same prompt gives the same answer.
 */
export class ChatLoop {
  constructor({ tokenizer, forward, spec = SPEC }) {
    this.tokenizer = tokenizer;
    this.forward = forward;
    this.spec = spec;
    this.eos = new Set(spec.eos);
    this.committed = []; // the tokens resident in the model's cache
  }

  // ChatML, the format of the Qwen family. The empty <think> block is what
  // Qwen 3's own template writes when thinking is switched off.
  encode(messages) {
    let text = "";
    for (const m of messages)
      text += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
    text += "<|im_start|>assistant\n<think>\n\n</think>\n\n";
    const ids = Array.from(
      this.tokenizer.encode(text, { add_special_tokens: false })
    ).map(Number);
    if (!ids.length) throw new Error("the prompt encoded to nothing");
    return ids;
  }

  async generate(messages, { max = 160, onToken } = {}) {
    const { maxCtx, prefillMax } = this.spec;
    const ids = this.encode(messages);
    if (ids.length + 16 > maxCtx)
      throw new Error(`the prompt (${ids.length} tokens) doesn't fit`);
    const budget = Math.min(max, maxCtx - ids.length - 1);

    // Only the part of the prompt that differs from what is already in the
    // cache is fed again.
    let keep = 0;
    while (
      keep < this.committed.length &&
      keep < ids.length - 1 &&
      this.committed[keep] === ids[keep]
    )
      keep++;
    this.committed = ids.slice(0, keep);
    let logits = null;
    for (let off = keep; off < ids.length;) {
      const n = Math.min(prefillMax, ids.length - off);
      logits = await this.forward(ids.slice(off, off + n), off);
      off += n;
    }
    this.committed = ids.slice();

    const out = [];
    for (let n = 0; n < budget; n++) {
      let next = -1;
      let best = -Infinity;
      for (let i = 0; i < logits.length; i++)
        if (logits[i] > best) {
          best = logits[i];
          next = i;
        }
      if (next < 0) throw new Error("the model produced no usable output");
      if (this.eos.has(next)) break;
      out.push(next);
      onToken?.(this.tokenizer.decode(out, { skip_special_tokens: true }));
      if (n + 1 < budget) {
        logits = await this.forward([next], this.committed.length);
        this.committed.push(next);
      }
    }
    return {
      text: this.tokenizer.decode(out, { skip_special_tokens: true }),
      in: ids.length,
      out: out.length,
    };
  }
}

/**
 * Load everything and return a bench model adapter.
 * onProgress(fraction, label) reports the model download.
 */
export async function executorch(onProgress = () => {}) {
  if (!globalThis.isSecureContext || !navigator.gpu)
    throw new Error("this browser doesn't have WebGPU");
  onProgress(0, "Starting the runtime");
  const [et, tokenizer, pte] = await Promise.all([
    startRuntime(),
    loadTokenizer(),
    fetchPinned(FILES.pte, f => onProgress(f, "Downloading the model")),
  ]);
  onProgress(1, "Loading the model onto the GPU");
  const path = "/harness-model.pte";
  et.FS.writeFile(path, pte, { canOwn: true });
  let module;
  try {
    module = et.Module.load(path);
    await module.loadMethod("forward");
  } finally {
    try {
      et.FS.unlink(path);
    } catch {
      // never written
    }
  }

  const forward = async (tokens, pos) => {
    const inputs = [
      et.Tensor.fromArray(
        [1, tokens.length],
        BigInt64Array.from(tokens, BigInt),
        et.ScalarType.Long
      ),
      et.Tensor.fromArray(
        [1],
        BigInt64Array.of(BigInt(pos)),
        et.ScalarType.Long
      ),
    ];
    let outputs;
    try {
      outputs = await module.forward(inputs);
    } finally {
      for (const t of inputs) t.delete();
    }
    const logits = outputs[0].data.slice();
    for (const t of outputs) t.delete();
    return logits;
  };

  const loop = new ChatLoop({ tokenizer, forward });
  // The runtime must not be entered twice at once, so calls go one at a time.
  let queue = Promise.resolve();
  return {
    name: SPEC.name,
    real: true,
    chat(messages, opts = {}) {
      const run = queue.then(() => loop.generate(messages, opts));
      queue = run.catch(() => {});
      return run;
    },
    dispose() {
      module?.delete();
      module = null;
    },
  };
}
