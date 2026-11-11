// The Live screen: pick harness pieces, run the job set bare and with the
// harness, and compare. Uses the emulated model unless the player opts in to
// downloading a real one.

import { JOBS, SWITCHES, runBench } from "./bench.js";
import { emulated, webllm, hasWebGPU } from "./llm.js";
import { icon } from "./icons.js";

const KEY = "ah:bench";
const esc = s =>
  s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

let real = null; // a loaded real model survives closing the sheet

export function openBench(body) {
  let on;
  try {
    on = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    on = null;
  }
  on ||= { loop: true };
  let useReal = false;
  let running = false;
  let stop = false;

  body.innerHTML = `
    <p class="ah-sub">The same pieces, as real code around a model. Seven small jobs, run once bare and once with your harness.</p>
    <div class="ah-engine" role="group" aria-label="Model">
      <button type="button" class="ah-seg" data-e="emu" aria-pressed="true">Emulated model</button>
      <button type="button" class="ah-seg" data-e="real" aria-pressed="false">Real model</button>
    </div>
    <p class="ah-enginenote" aria-live="polite"></p>
    <div class="ah-switches"></div>
    <div class="ah-lanes">
      <div class="ah-lane ah-lanehead"><span></span>${JOBS.map(j => `<span title="${j.name}">${j.name}</span>`).join("")}<span>ok</span><span>tokens</span><span>turns</span></div>
      <div class="ah-lane" data-lane="bare"><b>Bare</b>${JOBS.map(() => `<i></i>`).join("")}<span>–</span><span>–</span><span>–</span></div>
      <div class="ah-lane" data-lane="mine"><b>Yours</b>${JOBS.map(() => `<i></i>`).join("")}<span>–</span><span>–</span><span>–</span></div>
    </div>
    <p class="ah-benchnow" aria-live="polite">&nbsp;</p>
    <button type="button" class="ah-btn ah-run ah-benchgo">${icon("play")}<span>Run</span></button>
    <div class="ah-transcripts"></div>`;
  const $ = s => body.querySelector(s);
  const noteEl = $(".ah-enginenote");
  const nowEl = $(".ah-benchnow");
  const goBtn = $(".ah-benchgo");
  const segs = [...body.querySelectorAll(".ah-seg")];

  const sw = $(".ah-switches");
  for (const s of SWITCHES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ah-chip ah-core ah-switch";
    b.innerHTML = `${icon(s.chip)}<b>${s.name}</b>`;
    b.setAttribute("aria-pressed", String(!!on[s.id]));
    b.addEventListener("click", () => {
      if (running) return;
      on[s.id] = !on[s.id];
      b.setAttribute("aria-pressed", String(!!on[s.id]));
      try {
        localStorage.setItem(KEY, JSON.stringify(on));
      } catch {
        // fine
      }
    });
    sw.append(b);
  }

  const emuNote =
    "A scripted stand-in that reads the real transcript and behaves like a small model: instant, and the same every time.";
  const realNote = () =>
    !hasWebGPU()
      ? "This browser has no WebGPU, so a real model can't run here. Try desktop Chrome or Edge."
      : real
        ? `${real.name}, running in this tab. Results are measured and will vary.`
        : "Runs a small open model inside this tab on your GPU. It downloads about 1 GB once, then your browser keeps it.";
  function syncEngine() {
    segs[0].setAttribute("aria-pressed", String(!useReal));
    segs[1].setAttribute("aria-pressed", String(useReal));
    noteEl.textContent = useReal ? realNote() : emuNote;
    goBtn.disabled = useReal && !hasWebGPU();
    goBtn.querySelector("span").textContent =
      useReal && !real && hasWebGPU() ? "Download and run" : "Run";
  }
  segs.forEach(b =>
    b.addEventListener("click", () => {
      if (running) return;
      useReal = b.dataset.e === "real";
      syncEngine();
    })
  );
  syncEngine();

  // While a run is going, the controls that would be ignored are disabled.
  const lock = on => [...segs, ...sw.children].forEach(b => (b.disabled = on));

  function paintLane(name, results, live) {
    const lane = $(`[data-lane="${name}"]`);
    const dots = [...lane.querySelectorAll("i")];
    dots.forEach((d, k) => {
      const r = results[k];
      d.className = r
        ? r.pass
          ? "ah-pass"
          : "ah-nope"
        : k === live
          ? "ah-live"
          : "";
      d.title = r ? `${JOBS[k].name}: ${r.pass ? "passed" : r.why}` : "";
    });
    const spans = [...lane.querySelectorAll("span")];
    if (results.length) {
      spans[0].textContent = `${results.filter(r => r.pass).length}/${JOBS.length}`;
      spans[1].textContent = results
        .reduce((n, r) => n + r.tokens, 0)
        .toLocaleString();
      spans[2].textContent = results.reduce((n, r) => n + r.turns, 0);
    } else spans.forEach(s => (s.textContent = "–"));
  }

  function transcripts(sets) {
    const el = $(".ah-transcripts");
    el.innerHTML =
      `<h4>Transcripts</h4>` +
      JOBS.map((j, k) => {
        const cols = sets
          .map(([label, res]) => {
            const r = res[k];
            if (!r) return "";
            return `<div><b>${label}: ${r.pass ? "passed" : esc(r.why)}</b>${r.log
              .map(
                l =>
                  `<p class="ah-l-${l.kind}"><em>${l.kind}</em>${esc(l.text)}</p>`
              )
              .join("")}</div>`;
          })
          .join("");
        return `<details><summary>${j.name}</summary>${cols}</details>`;
      }).join("");
  }

  goBtn.addEventListener("click", async () => {
    if (running) {
      stop = true;
      return;
    }
    running = true;
    stop = false;
    lock(true);
    let model;
    try {
      if (useReal) {
        if (!real) {
          goBtn.disabled = true;
          real = await webllm((p, text) => {
            noteEl.textContent =
              `Loading the model: ${Math.round(p * 100)}%. ${text}`.slice(
                0,
                160
              );
          });
          goBtn.disabled = false;
        }
        model = real;
      } else model = emulated();
    } catch (e) {
      noteEl.textContent = `Couldn't load a real model (${e.message}). The emulated model still works.`;
      running = false;
      goBtn.disabled = false;
      lock(false);
      return;
    }
    syncEngine();
    goBtn.querySelector("span").textContent = "Stop";
    const done = { bare: [], mine: [] };
    paintLane("bare", [], -1);
    paintLane("mine", [], -1);
    $(".ah-transcripts").innerHTML = "";
    for (const [lane, h] of [
      ["bare", {}],
      ["mine", on],
    ]) {
      await runBench(
        h,
        model,
        ({ job, state, result, step }) => {
          if (!body.isConnected) stop = true;
          const k = JOBS.indexOf(job);
          if (state === "done") done[lane].push(result);
          if (state === "step" && step.kind === "model")
            nowEl.textContent = `${lane === "bare" ? "Bare" : "Yours"} · ${job.name} · turn ${step.turns}`;
          paintLane(lane, done[lane], k);
        },
        () => stop
      );
      paintLane(lane, done[lane], -1);
    }
    transcripts([
      ["Bare", done.bare],
      ["Yours", done.mine],
    ]);
    const a = done.bare.filter(r => r.pass).length;
    const b = done.mine.filter(r => r.pass).length;
    nowEl.textContent = stop
      ? "Stopped."
      : `Bare ${a}/${JOBS.length}, yours ${b}/${JOBS.length}. ${model.real ? `Measured on ${model.name}` : "Emulated model"}.`;
    running = false;
    lock(false);
    syncEngine();
  });
}
