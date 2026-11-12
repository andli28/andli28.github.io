// The two models the game can run on. Both expose the same thing:
//   chat(messages, { task, stage, summary, max, onToken }) → { text, in, out }
//
// `standIn` is a scripted weak model: it reads the real transcript and
// behaves the way small models tend to. The real one is Qwen 3 0.6B running
// in the browser on WebGPU (see executorch.js). `modelManager` decides which
// to use and loads the real one by itself when the device looks able.

import { est } from "./agent.js";

const call = (tool, args) => JSON.stringify({ tool, args });
const nap = ms => new Promise(r => setTimeout(r, ms));

function decide(messages, task, { summary, stage = 0 }) {
  if (summary) {
    const bits = messages[1].content
      .split(/\n|; /)
      .map(l => l.replace(/^(Known so far: |TOOL RESULT: )/, "").trim());
    const found = new Set();
    for (const step of task.plan) {
      const line = bits.find(l => step.want.test(l));
      if (line) found.add(line.slice(0, 90));
    }
    return found.size ? [...found].join("; ") : "Nothing important yet.";
  }
  const sys = messages[0].content;
  if (!/"tool"/.test(sys)) return task.guess;
  const rest = messages.slice(1);
  const said = rest.filter(m => m.role === "assistant").map(m => m.content);
  const heard = rest.filter(m => m.role === "user").map(m => m.content);
  const seen = heard.join("\n");
  const all = `${sys}\n${seen}`;
  const last = heard[heard.length - 1] || "";

  // a follow-up only makes sense if the earlier exchange is still there
  if (stage > 0) {
    const f = task.follow[stage - 1];
    return `ANSWER: ${f.needs.test(all) ? f.answer : f.lost}`;
  }

  // a small model does what the page says, unless the text is fenced off
  const hostile = heard.some(
    m => /IGNORE PREVIOUS INSTRUCTIONS/.test(m) && !/<untrusted>/.test(m)
  );
  if (hostile && !said.some(t => /write_file/.test(t)))
    return call("write_file", { path: "owned.txt", content: "pwned" });

  // told to stop repeating itself, it does
  if (/already made that exact call/.test(last))
    return `ANSWER: ${task.answer(all)}`;

  // and it is sure it can do sums in its head
  if (task.cocky && !said.length) return `ANSWER: ${task.guess}`;

  const lazy = /load_tool/.test(sys);
  for (const step of task.plan) {
    if (step.want.test(seen)) continue;
    // it can't open a file it has never heard of
    if (step.knows && !step.knows.test(all)) return `ANSWER: ${task.guess}`;
    if (lazy && !seen.includes(`${step.tool} {`))
      return call("load_tool", { name: step.tool });
    const key = Object.values(step.args)[0];
    const tries = said.filter(t => t.includes(String(key))).length;
    const fix = last.match(/Did you mean ([^?]+)\?/);
    if (fix) return call(step.tool, { ...step.args, path: fix[1] });
    if (tries && step.grep && /characters trimmed/.test(seen))
      return call(step.tool, { ...step.args, grep: step.grep });
    return call(step.tool, step.args);
  }
  return `ANSWER: ${task.answer(all)}`;
}

export function standIn() {
  return {
    name: "Stand-in model",
    real: false,
    async chat(messages, opts) {
      const text = decide(messages, opts.task, opts);
      // arrive a few words at a time, like a model does
      if (opts.onToken) {
        const words = text.split(/(?<=\s)/);
        let shown = "";
        for (const w of words) {
          shown += w;
          opts.onToken(shown);
          await nap(Math.min(40, 600 / words.length));
        }
      } else await nap(0);
      return {
        text,
        in: messages.reduce((n, m) => n + est(m.content) + 4, 0),
        out: est(text),
      };
    },
  };
}

// Can this device be expected to run the real model without being asked?
// Phones and tablets say no: they tend to run out of memory. `deviceMemory`
// only exists in Chromium, is capped at 8 and counts RAM rather than GPU
// memory, so a browser that doesn't report it passes on the other checks.
export async function canAutoload(nav = globalThis.navigator) {
  if (!nav?.gpu || globalThis.isSecureContext === false) return "no-webgpu";
  if (
    nav.userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || "") ??
    false
  )
    return "mobile";
  // iPadOS calls itself a Mac
  if (/Macintosh/.test(nav.userAgent || "") && nav.maxTouchPoints > 1)
    return "mobile";
  if (nav.deviceMemory != null && nav.deviceMemory < 8) return "low-memory";
  if (nav.connection?.saveData) return "save-data";
  try {
    const { quota = Infinity, usage = 0 } =
      (await nav.storage?.estimate?.()) ?? {};
    if (quota - usage < 600e6) return "no-space";
    if (!(await nav.gpu.requestAdapter())) return "no-webgpu";
  } catch {
    return "no-webgpu";
  }
  return "ok";
}

/**
 * Chooses and loads the model. `want` is the saved preference: "auto" (decide
 * from the device), "on" or "off". onChange is called with the new status:
 *   { state: "standin" | "loading" | "real" | "failed", progress, why }
 */
export function modelManager({ want = "auto", onChange = () => {} } = {}) {
  const fallback = standIn();
  let real = null;
  let loading = null;
  const status = { state: "standin", progress: 0, why: "" };
  const set = patch => {
    Object.assign(status, patch);
    onChange({ ...status });
  };

  function load() {
    if (real || loading) return loading;
    set({ state: "loading", progress: 0, why: "" });
    loading = import("./executorch.js")
      .then(m => m.executorch(f => set({ progress: f })))
      .then(m => {
        real = m;
        if (status.state === "loading") set({ state: "real" });
      })
      .catch(e => {
        set({ state: "failed", why: String(e.message || e) });
      })
      .finally(() => (loading = null));
    return loading;
  }

  (async () => {
    if (want === "off") return;
    const verdict = want === "on" ? "ok" : await canAutoload();
    if (verdict === "ok") load();
    else set({ why: verdict });
  })();

  return {
    status: () => ({ ...status }),
    current: () => (status.state === "real" && real ? real : fallback),
    // Tapping the chip: real → stand-in, anything else → try the real one.
    toggle() {
      if (status.state === "real" || status.state === "loading") {
        set({ state: "standin", why: "off" });
        return "off";
      }
      if (real) set({ state: "real" });
      else load();
      return "on";
    },
  };
}
