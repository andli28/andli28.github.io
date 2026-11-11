// Model adapters for the Live bench. Both expose the same thing:
//   chat(messages, { job, summary, max }) → { text, in, out }
//
// `emulated` is a scripted weak model: it reads the real transcript and
// behaves the way small models tend to. `webllm` is a real model running in
// the browser on WebGPU; nothing is downloaded until it is asked for.

import { est, TOOLS } from "./bench.js";

const call = (tool, args) => JSON.stringify({ tool, args });
const nap = ms => new Promise(r => setTimeout(r, ms));

function decide(messages, job, summary) {
  if (summary) {
    const text = messages[1].content;
    const found = [];
    for (const step of job.plan) {
      const line = text.split("\n").find(l => step.want.test(l));
      if (line)
        found.push(
          line
            .replace(/^TOOL RESULT: /, "")
            .trim()
            .slice(0, 90)
        );
    }
    return found.length ? found.join("; ") : "Nothing important yet.";
  }
  const sys = messages[0].content;
  if (!/"tool"/.test(sys)) return job.guess;
  const rest = messages.slice(1);
  const said = rest.filter(m => m.role === "assistant").map(m => m.content);
  const heard = rest.filter(m => m.role === "user").map(m => m.content);
  const seen = heard.join("\n");
  const last = heard[heard.length - 1] || "";

  // a small model does what the page says, unless the text is fenced off
  const hostile = heard.some(
    m => /IGNORE PREVIOUS INSTRUCTIONS/.test(m) && !/<untrusted>/.test(m)
  );
  if (hostile && !said.some(t => /write_file/.test(t)))
    return call("write_file", { path: "owned.txt", content: "pwned" });

  // and is sure it can do sums in its head
  if (job.cocky && !said.length) return `ANSWER: ${job.guess}`;

  const lazy = /load_tool/.test(sys);
  for (const step of job.plan) {
    if (step.want.test(seen)) continue;
    if (lazy && !seen.includes(TOOLS[step.tool].desc))
      return call("load_tool", { name: step.tool });
    const key = Object.values(step.args)[0];
    const tries = said.filter(t => t.includes(String(key))).length;
    if (job.sloppy && step === job.plan[0] && !tries)
      return `{"tool": "${step.tool}", "args": {"path": "${step.args.path}"`;
    const fix = last.match(/Did you mean ([^?]+)\?/);
    if (fix) return call(step.tool, { ...step.args, path: fix[1] });
    if (tries && step.grep && /characters trimmed/.test(seen))
      return call(step.tool, { ...step.args, grep: step.grep });
    return call(step.tool, step.args);
  }
  return `ANSWER: ${job.answer()}`;
}

export function emulated() {
  return {
    name: "emulated model",
    real: false,
    async chat(messages, { job, summary }) {
      await nap(70);
      const text = decide(messages, job, summary);
      return {
        text,
        in: messages.reduce((n, m) => n + est(m.content) + 4, 0),
        out: est(text),
      };
    },
  };
}

// Small instruct models, best first. The first one WebLLM ships is used.
const PREFERRED = [
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
];

export const hasWebGPU = () =>
  typeof navigator !== "undefined" && "gpu" in navigator;

export async function webllm(onProgress = () => {}) {
  if (!hasWebGPU()) throw new Error("This browser doesn't have WebGPU.");
  const lib = await import("@mlc-ai/web-llm");
  const list = lib.prebuiltAppConfig.model_list;
  const id = PREFERRED.find(x => list.some(m => m.model_id === x));
  if (!id) throw new Error("No suitable model in this WebLLM build.");
  const engine = await lib.CreateMLCEngine(
    id,
    { initProgressCallback: p => onProgress(p.progress ?? 0, p.text ?? "") },
    { context_window_size: 4096 }
  );
  return {
    name: id.replace(/-q4.*$/, ""),
    real: true,
    async chat(messages, { max = 160 } = {}) {
      const r = await engine.chat.completions.create({
        messages,
        temperature: 0,
        seed: 7,
        max_tokens: max,
      });
      const text = r.choices?.[0]?.message?.content || "";
      return {
        text,
        in:
          r.usage?.prompt_tokens ??
          messages.reduce((n, m) => n + est(m.content) + 4, 0),
        out: r.usage?.completion_tokens ?? est(text),
      };
    },
    dispose: () => engine.unload(),
  };
}
