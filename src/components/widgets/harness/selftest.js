// A self-test for the real model, opened with ?selftest (or ?selftest=port,sum
// for chosen levels). It runs every level twice on this device, with the
// parts the game carries to it and with the same parts minus the level's own,
// and builds a plain-text report to copy out. Not linked from the game.

import { TASKS, runTask } from "./agent.js";
import { PARTS } from "./world.js";
import { REAL } from "./llm.js";

const esc = s =>
  String(s).replace(
    /[&<>]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
  );
const marks = r => r.evals.map(e => (e.ok ? "✓" : "✗")).join("");
const one = s => String(s).replace(/\s+/g, " ").trim();

export async function selfTest(root, only = "") {
  const ids = only.split(",").filter(Boolean);
  const tasks = TASKS.filter(t => !ids.length || ids.includes(t.id));
  root.innerHTML = `<div style="max-width:60rem;margin:2rem auto;padding:0 1rem;font:14px/1.5 ui-monospace,monospace">
    <h1 style="font-size:1.2rem">Harness self-test: ${esc(REAL.name)}</h1>
    <p data-s>Starting…</p>
    <p><button data-c disabled style="padding:.4rem .8rem">Copy results</button></p>
    <pre data-r style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
  </div>`;
  const status = root.querySelector("[data-s]");
  const out = root.querySelector("[data-r]");
  const copy = root.querySelector("[data-c]");
  const lines = [];
  const say = text => {
    lines.push(text);
    out.textContent = lines.join("\n");
  };
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      copy.textContent = "Copied";
    } catch {
      // no clipboard access: select the text so it can be copied by hand
      getSelection().selectAllChildren(out);
    }
  };

  let gpu = "unknown";
  try {
    const info = (await navigator.gpu?.requestAdapter())?.info;
    if (info)
      gpu = [info.vendor, info.architecture, info.device, info.description]
        .filter(Boolean)
        .join(" ");
  } catch {
    // reported as unknown
  }
  say(`Harness self-test, ${REAL.name}`);
  say(`Browser: ${navigator.userAgent}`);
  say(`GPU: ${gpu}`);
  say("");

  let model;
  let dead = "";
  try {
    const { executorch } = await import("./executorch.js");
    model = await executorch(
      p => {
        const mb = n => Math.round(n / 1e6);
        status.textContent = `Loading the model: ${p.stage}${p.total ? ` ${mb(p.loaded)} / ${mb(p.total)} MB` : ""}`;
      },
      why => (dead = why)
    );
  } catch (e) {
    status.textContent = "The model could not be loaded. Nothing was tested.";
    say(`Could not load the model: ${e.message || e}`);
    copy.disabled = false;
    return;
  }

  const t0 = performance.now();
  const odd = [];
  let n = 0;
  for (const task of tasks) {
    const carried = TASKS.slice(0, TASKS.indexOf(task) + 1).map(t => t.gives);
    const runs = {};
    for (const mode of ["with", "without"]) {
      n++;
      status.textContent = `Run ${n} of ${tasks.length * 2}: ${task.name}, ${mode} ${PARTS[task.gives].name}`;
      const parts =
        mode === "with" ? carried : carried.filter(p => p !== task.gives);
      try {
        runs[mode] = await runTask(task, parts, model);
      } catch (e) {
        runs[mode] = {
          pass: false,
          evals: [],
          turns: 0,
          answer: "",
          trace: [],
        };
        dead ||= String(e.message || e);
      }
      if (dead) break;
    }
    if (dead) {
      say(`Stopped at ${task.id}: ${dead}`);
      break;
    }
    const { with: a, without: b } = runs;
    const ok = a.pass && !b.pass;
    if (!ok) odd.push([task, runs]);
    say(
      `${ok ? "ok " : "ODD"} ${String(TASKS.indexOf(task) + 1).padStart(2)} ${task.id.padEnd(7)} ${PARTS[task.gives].name.padEnd(13)} with ${marks(a)} t${a.turns} | without ${marks(b)} t${b.turns} | ${one(a.answer).slice(0, 70)}`
    );
  }

  say("");
  say(
    `${odd.length ? `${odd.length} unexpected` : "All as expected"} (expected: passes with the part, fails without). ${((performance.now() - t0) / 60000).toFixed(1)} min.`
  );
  for (const [task, runs] of odd)
    for (const mode of ["with", "without"]) {
      const r = runs[mode];
      if (r.pass !== (mode === "with")) {
        say("");
        say(
          `--- ${task.id}, ${mode} ${task.gives}: ${r.evals.map(e => `${e.ok ? "✓" : "✗"} ${e.label}`).join(" / ")}`
        );
        // the instructions are long and the same every time: skip them
        for (const e of r.trace.filter(e => e.kind !== "system"))
          say(
            `${e.kind}${e.part ? ` ${e.part}` : ""}: ${one(e.text).slice(0, 400)}`
          );
      }
    }
  status.textContent = dead
    ? "Stopped early. Copy the results so far."
    : "Done. Copy the results and paste them back.";
  copy.disabled = false;
}
