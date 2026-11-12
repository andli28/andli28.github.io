// The real model, in a worker of its own so the page stays responsive: Qwen 3
// 0.6B on the GPU, through ExecuTorch's Wasm runtime and its WebGPU backend.
// executorch.js is the page's side of this.
//
// This is a classic worker with no imports, because the runtime's loader is a
// classic script and needs importScripts. The loader is served from
// /vendor/executorch/; the runtime's .wasm, the tokenizer and the model come
// from Hugging Face at pinned revisions, are checked against their SHA-256,
// and are kept in the browser's Cache Storage.
//
// The generation loop follows the ExecuTorch WebGPU playground
// (pytorch/executorch, website/playground/webgpu/src/runtime/llm.js,
// BSD licence): the model file keeps its own key-value cache, forward() takes
// `tokens` [1, n] and `input_pos` [1] and returns the logits after the last
// token, and the loop that feeds it runs here.
//
// Messages in:  { type: "load" } · { type: "chat", id, messages, max }
// Messages out: { type: "progress", stage, loaded, total } · { type: "ready" }
//               { type: "token", id, text } · { type: "result", id, text, in, out }
//               { type: "error", id?, message }

/* global importScripts */

const RUNTIME =
  "https://huggingface.co/executorch-community/ExecuTorch-WebGPU-Runtime/resolve/48a27434e9f3096f100d79a5d1e8437a124ca654/";
const MODEL =
  "https://huggingface.co/executorch-community/Qwen3-0.6B-ExecuTorch-WebGPU/resolve/65fa8ec0b8996b4a0157cdb89ea766b000b1134a/";

const FILES = {
  script: "/vendor/executorch/executorch_wasm_lib.js",
  // The tokenizer is built from these two; both are verified and cached like
  // everything else.
  tokenizer: {
    url: `${MODEL}tokenizer/tokenizer.json`,
    sha256: "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4",
  },
  tokenizerConfig: {
    url: `${MODEL}tokenizer/tokenizer_config.json`,
    sha256: "d5d09f07b48c3086c508b30d1c9114bd1189145b74e982a265350c923acd8101",
  },
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

const SPEC = {
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
// before it was stored. `file.bytes` is optional; the hash is what counts.
async function fetchPinned(file, onProgress = () => {}) {
  const cache = globalThis.caches ? await caches.open(CACHE) : null;
  if (cache) for (const old of OLD_CACHES) caches.delete(old).catch(() => {});
  const hit = await cache?.match(file.url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const parts = [];
  let bytes = file.bytes ? new Uint8Array(file.bytes) : null;
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytes) {
      if (n + value.byteLength > bytes.byteLength)
        throw new Error("the download is larger than expected");
      bytes.set(value, n);
    } else parts.push(value);
    n += value.byteLength;
    onProgress(n);
  }
  if (!bytes) {
    bytes = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.byteLength;
    }
  }
  if ((file.bytes && n !== file.bytes) || (await sha256(bytes)) !== file.sha256)
    throw new Error("the download doesn't match its checksum");
  try {
    await cache?.put(file.url, new Response(bytes));
  } catch {
    // No room, or a private window: it still works, it just won't be kept.
  }
  return bytes;
}
const isCached = async file =>
  !!(globalThis.caches && (await (await caches.open(CACHE)).match(file.url)));

// The runtime's own log lines. The last few are added to an error message,
// since they usually say what went wrong.
const logs = [];
const log = line => {
  logs.push(String(line));
  if (logs.length > 6) logs.shift();
};
const withLogs = e =>
  `${e?.message || e}${logs.length ? ` [${logs.join(" | ")}]` : ""}`;

async function startRuntime() {
  const wasmBinary = await fetchPinned(FILES.wasm);
  // The loader is a classic script, which is why this is a classic worker.
  importScripts(FILES.script);
  const et = await globalThis.createExecuTorch({
    wasmBinary,
    print: log,
    printErr: log,
  });
  await et.initWebGPU();
  return et;
}

async function loadTokenizer() {
  // Import the pinned library from a blob, with import.meta.url pointed back
  // at where it came from.
  const [lib, json, config] = await Promise.all([
    fetchPinned(FILES.tokenizerLib),
    fetchPinned(FILES.tokenizer),
    fetchPinned(FILES.tokenizerConfig),
  ]);
  const text = b => new TextDecoder().decode(b);
  const code = text(lib).replaceAll(
    "import.meta.url",
    JSON.stringify(FILES.tokenizerLib.url)
  );
  const blob = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" })
  );
  let tj;
  try {
    tj = await import(/* @vite-ignore */ blob);
  } finally {
    URL.revokeObjectURL(blob);
  }
  // Built from the verified bytes; the library fetches nothing itself.
  tj.env.allowRemoteModels = false;
  return new tj.PreTrainedTokenizer(
    JSON.parse(text(json)),
    JSON.parse(text(config))
  );
}

/**
 * The chat loop, independent of the runtime: give it a tokenizer and a
 * `forward(tokens, pos) → logits` and it turns messages into a reply.
 * Greedy decoding, so the same prompt gives the same answer.
 */
class ChatLoop {
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

let loop = null;
// The runtime must not be entered twice at once, so calls go one at a time.
let queue = Promise.resolve();

async function load() {
  if (!globalThis.isSecureContext || !navigator.gpu)
    throw new Error("this browser doesn't have WebGPU");
  const total = FILES.pte.bytes;
  const cached = await isCached(FILES.pte);
  const stage = cached ? "cache" : "download";
  postMessage({ type: "progress", stage, loaded: 0, total });
  let last = 0;
  const [et, tokenizer, pte] = await Promise.all([
    startRuntime(),
    loadTokenizer(),
    fetchPinned(FILES.pte, loaded => {
      // about one message per megabyte
      if (loaded - last < 1e6 && loaded < total) return;
      last = loaded;
      postMessage({ type: "progress", stage, loaded, total });
    }),
  ]);
  postMessage({ type: "progress", stage: "gpu", loaded: total, total });
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
  loop = new ChatLoop({ tokenizer, forward });
}

self.onmessage = ({ data }) => {
  if (data.type === "load")
    load().then(
      () => postMessage({ type: "ready" }),
      e => postMessage({ type: "error", message: withLogs(e) })
    );
  else if (data.type === "chat") {
    const { id, messages, max } = data;
    queue = queue
      .then(() =>
        loop.generate(messages, {
          max,
          onToken: text => postMessage({ type: "token", id, text }),
        })
      )
      .then(
        out => postMessage({ type: "result", id, ...out }),
        e => postMessage({ type: "error", id, message: withLogs(e) })
      );
  }
};
