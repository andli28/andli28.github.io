// The board: the model in the middle with the harness parts around it, and
// beside it the trace of the last run with its evals. Tasks come one at a
// time. The player runs one, reads the trace, connects the part that
// appears, and runs it again. Progress lives in localStorage under one key.

import { TASKS, runTask } from "./agent.js";
import { BRANCHES, PARTS, ORDER } from "./world.js";
import { modelManager } from "./llm.js";
import { icon } from "./icons.js";

const KEY = "ah:v4";
const ALL = Object.keys(PARTS);
const LAST = TASKS.length - 1;
const REAL = "Qwen 3 0.6B";
// How long each trace line holds when the stand-in is driving, in ms. The
// real model sets its own pace.
const PACE = { line: 420, signal: 380 };

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") ?? {};
  } catch {
    return {};
  }
}

export function mountHarness(root) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const saved = load();
  const query = new URLSearchParams(location.search);
  const everything = query.has("all");
  const state = {
    owned: everything ? [...ALL] : saved.owned || [],
    on: saved.on || {},
    done: saved.done || {},
    top: everything ? LAST : Math.min(saved.top || 0, LAST),
    at: Math.min(saved.at || 0, LAST),
    sound: !!saved.sound,
    model: query.get("model") || saved.model || "auto",
    running: false,
    fast: false,
    runId: 0,
  };
  const save = () => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          owned: state.owned,
          on: state.on,
          done: state.done,
          top: state.top,
          at: state.at,
          sound: state.sound,
          model: state.model,
        })
      );
    } catch {
      // private mode: play on without saving
    }
  };

  const task = () => TASKS[state.at];
  const owns = id => state.owned.includes(id);
  // A new task starts with the harness the last one ended with.
  const wired = () => {
    const T = task();
    if (!state.on[T.id]) {
      const prev = state.at ? state.on[TASKS[state.at - 1].id] : null;
      state.on[T.id] = (prev || []).filter(owns);
    }
    return state.on[T.id];
  };
  const isOn = id => wired().includes(id);

  // ---------- sound ----------
  let ctx;
  function blip(freq, dur = 0.07, type = "sine", vol = 0.05) {
    if (!state.sound) return;
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    } catch {
      // no audio, no problem
    }
  }

  // ---------- skeleton ----------
  root.innerHTML = "";
  const wrap = h("div", "ah-wrap");
  const head = h("div", "ah-head");
  const nameEl = h("h2", "ah-name", "Harness");
  const pager = h("div", "ah-pager");
  const mkRound = (name, label, fn) => {
    const b = h("button", "ah-round", icon(name));
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  };
  const prevBtn = mkRound("back", "Previous task", () => go(state.at - 1));
  const nextBtn = mkRound("fwd", "Next task", () => go(state.at + 1));
  const countEl = h("span", "ah-count");
  pager.append(prevBtn, countEl, nextBtn);
  const chip = h("button", "ah-modelchip");
  chip.type = "button";
  const tools = h("div", "ah-tools");
  head.append(nameEl, pager, chip, tools);

  const askEl = h("p", "ah-ask");
  const tipEl = h("p", "ah-tip");
  tipEl.setAttribute("aria-live", "polite");
  const top = h("div", "ah-top");
  top.append(askEl, tipEl);

  const board = h("div", "ah-board");
  const map = h("div", "ah-map");
  const wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wires.setAttribute("class", "ah-wires");
  wires.setAttribute("aria-hidden", "true");
  const modelEl = h(
    "div",
    "ah-model",
    `<div class="ah-bot" data-face="idle"><span class="ah-ant"></span><span class="ah-body"><span class="ah-visor"><i></i><i></i></span></span></div><b>Model</b>`
  );
  const botEl = modelEl.querySelector(".ah-bot");
  const dot = h("div", "ah-dot");
  map.append(wires);
  const branchEls = {};
  for (const b of BRANCHES) {
    const e = h("section", `ah-branch ah-b-${b.id}`);
    branchEls[b.id] = e;
    map.append(e);
  }
  map.append(modelEl, dot);

  // the trace side
  const side = h("div", "ah-side");
  const sideHead = h("div", "ah-sidehead", `<span>Trace</span>`);
  const flip = h("div", "ah-flip");
  flip.hidden = true;
  const mkFlip = (label, which) => {
    const b = h("button", "", label);
    b.type = "button";
    b.addEventListener("click", () => show(which));
    flip.append(b);
    return b;
  };
  const flipPrev = mkFlip("Last run", "prev");
  const flipNow = mkFlip("This run", "now");
  sideHead.append(flip);
  const panes = { prev: h("div", "ah-trace"), now: h("div", "ah-trace") };
  for (const p of Object.values(panes)) {
    p.setAttribute("role", "log");
    p.tabIndex = 0;
  }
  panes.prev.hidden = true;
  const actions = h("div", "ah-actions");
  const mkBtn = (cls, ic, label) => {
    const b = h("button", `ah-btn ${cls}`, `${icon(ic)}<span>${label}</span>`);
    b.type = "button";
    actions.append(b);
    return b;
  };
  const hintBtn = mkBtn("", "bulb", "Hint");
  const runBtn = mkBtn("ah-run", "play", "Run");
  // the evals have a box of their own, under the trace
  const evalsBox = h("div", "ah-evalsbox");
  const evalsHead = h("div", "ah-sidehead");
  const evalsEl = h("ul", "ah-evals");
  evalsBox.append(evalsHead, evalsEl);
  const graded = { prev: null, now: null };
  side.append(sideHead, panes.prev, panes.now, evalsBox, actions);
  board.append(map, side);

  const overlay = h("div", "ah-overlay");
  overlay.hidden = true;
  wrap.append(head, top, board);
  root.append(wrap, overlay);

  const notesBtn = mkRound("book", "Field notes", () => showNotes());
  const soundBtn = mkRound("mute", "Sound", () => {
    state.sound = !state.sound;
    save();
    syncSound();
    blip(660);
  });
  tools.append(notesBtn, soundBtn);
  const syncSound = () => {
    soundBtn.innerHTML = icon(state.sound ? "sound" : "mute");
    soundBtn.setAttribute("aria-pressed", String(state.sound));
  };
  syncSound();

  // ---------- the model ----------
  function syncChip(s) {
    const pct = Math.round(s.progress * 100);
    // [wide screens, phones]
    const [long, short] =
      s.state === "loading"
        ? [`${REAL} · ${pct}%`, `Qwen ${pct}%`]
        : s.state === "real"
          ? [REAL, "Qwen"]
          : ["Stand-in model", "Stand-in"];
    chip.innerHTML = `<i></i><span class="ah-long">${long}</span><span class="ah-short">${short}</span>`;
    chip.setAttribute("aria-label", long);
    chip.dataset.state = s.state;
    chip.setAttribute("aria-pressed", String(s.state === "real"));
    chip.title =
      s.state === "real"
        ? `${REAL}, running in this tab on your GPU. Tap to use the scripted stand-in.`
        : s.state === "loading"
          ? `Loading ${REAL} (about 400 MB, kept by your browser). You can play meanwhile. Tap to cancel.`
          : s.state === "failed"
            ? `${REAL} could not load here (${s.why}). Tap to try again.`
            : `A scripted stand-in that behaves like a small model. Tap to load ${REAL} into this tab (about 400 MB).`;
  }
  const models = modelManager({ want: state.model, onChange: syncChip });
  syncChip(models.status());
  chip.addEventListener("click", () => {
    state.model = models.toggle();
    save();
  });

  // ---------- drawing ----------
  function partEl(id) {
    const P = PARTS[id];
    const b = h(
      "button",
      `ah-part ${isOn(id) ? "ah-on" : "ah-off"}`,
      `${icon(id)}<span>${P.name}</span>`
    );
    b.type = "button";
    b.dataset.part = id;
    b.setAttribute("aria-label", P.name);
    b.setAttribute("aria-pressed", String(isOn(id)));
    return b;
  }

  function draw() {
    const T = task();
    notesBtn.dataset.count = state.owned.length || "";
    countEl.textContent = `${state.at + 1} / ${TASKS.length}`;
    prevBtn.disabled = state.at === 0;
    nextBtn.disabled = state.at >= state.top;
    askEl.textContent = `“${[].concat(T.ask).join(" … ")}”`;

    for (const b of BRANCHES) {
      const e = branchEls[b.id];
      const mine = ORDER[b.id].filter(owns);
      e.classList.toggle("ah-fog", !mine.length);
      e.innerHTML = "";
      if (!mine.length) continue;
      e.append(h("h3", "", b.name));
      const parts = h("div", "ah-parts");
      for (const id of mine) parts.append(partEl(id));
      e.append(parts);
    }
    const cleared = !!state.done[T.id] && state.at < LAST;
    runBtn.querySelector("span").textContent = cleared ? "Next" : "Run";
    hintBtn.querySelector("span").textContent = cleared ? "Run again" : "Hint";
    requestAnimationFrame(drawWires);
  }

  function note(text, bad = false) {
    tipEl.textContent = text;
    tipEl.classList.toggle("ah-bad", bad);
  }

  const centre = el => {
    const a = el.getBoundingClientRect();
    const m = map.getBoundingClientRect();
    return {
      x: a.left - m.left + a.width / 2,
      y: a.top - m.top + a.height / 2,
      w: a.width,
      h: a.height,
    };
  };

  // One arrow per branch that has something connected. Each end stops at the
  // edge of its box.
  function drawWires() {
    const m = map.getBoundingClientRect();
    wires.setAttribute("viewBox", `0 0 ${m.width} ${m.height}`);
    const to = centre(modelEl);
    let out = "";
    for (const b of BRANCHES) {
      if (!ORDER[b.id].some(id => owns(id) && isOn(id))) continue;
      const from = centre(branchEls[b.id]);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const edge = box =>
        Math.min(
          dx ? (box.w / 2 + 3) / Math.abs(dx) : Infinity,
          dy ? (box.h / 2 + 3) / Math.abs(dy) : Infinity
        );
      const t1 = edge(from);
      const t2 = edge(to);
      if (t1 + t2 >= 1) continue;
      out += `<line class="ah-wire ah-w-${b.id}" x1="${from.x + dx * t1}" y1="${from.y + dy * t1}" x2="${to.x - dx * t2}" y2="${to.y - dy * t2}"/>`;
    }
    wires.innerHTML = out;
  }

  const elOf = id =>
    id === "model" ? modelEl : map.querySelector(`[data-part="${id}"]`);
  function ping(id) {
    const e = elOf(id);
    if (!e) return;
    e.classList.remove("ah-ping");
    void e.offsetWidth;
    e.classList.add("ah-ping");
  }
  // A signal travelling from a part to the model.
  function travel(from) {
    const a = elOf(from);
    if (!a || reduced() || state.fast) return;
    const p = centre(a);
    const q = centre(modelEl);
    dot.className = `ah-dot ah-c-${PARTS[from].branch}`;
    dot.animate(
      [
        { transform: `translate(${p.x}px, ${p.y}px) scale(0.6)`, opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { opacity: 1, offset: 0.85 },
        { transform: `translate(${q.x}px, ${q.y}px) scale(1)`, opacity: 0 },
      ],
      { duration: PACE.signal, easing: "cubic-bezier(0.45, 0, 0.25, 1)" }
    );
  }

  // ---------- the trace ----------
  function show(which) {
    panes.prev.hidden = which !== "prev";
    panes.now.hidden = which !== "now";
    flipPrev.setAttribute("aria-pressed", String(which === "prev"));
    flipNow.setAttribute("aria-pressed", String(which === "now"));
    drawEvals(graded[which]);
  }
  function idleTrace() {
    panes.now.innerHTML = `<p class="ah-idle">Nothing has run yet. Press Run and every step the model and the harness take is listed here.</p>`;
    graded.now = graded.prev = null;
    drawEvals(null);
  }
  // The checks for this task: open circles before a run, ticks and crosses
  // after one.
  function drawEvals(res) {
    const list = res ? res.evals : task().evals;
    const passed = res ? res.evals.filter(e => e.ok).length : 0;
    evalsHead.innerHTML = `<span>Evals</span><span class="ah-evalmeta">${
      res
        ? `${passed} of ${list.length} pass · ${res.turns} turns · ${res.tokens} tokens`
        : "how the run will be graded"
    }</span>`;
    evalsEl.innerHTML = "";
    for (const e of list) {
      const st = !res ? "todo" : e.ok ? "ok" : "no";
      evalsEl.append(
        h(
          "li",
          `ah-e-${st}`,
          `${st === "todo" ? "<i></i>" : icon(st === "ok" ? "check" : "x")}<span>${e.label}</span>`
        )
      );
    }
  }
  const tidy = text =>
    text
      .replace(/^TOOL RESULT( \(error\))?: /, "")
      .replace(/\n\(If that is enough[^)]*\)$/, "");
  function line(kind, who, text, part) {
    const P = PARTS[part];
    const e = h(
      "div",
      `ah-line ah-k-${kind}${P ? ` ah-c-${P.branch}` : ""}`,
      `<b>${P ? icon(part) : ""}${who}</b><span></span>`
    );
    e.lastChild.textContent = text;
    if (kind === "tool" && text.length > 140) {
      e.classList.add("ah-fold");
      e.lastChild.title = "Tap to open";
    }
    panes.now.append(e);
    panes.now.scrollTop = panes.now.scrollHeight;
    return e;
  }
  panes.now.addEventListener("click", ev =>
    ev.target.closest(".ah-fold")?.classList.toggle("ah-open")
  );
  panes.prev.addEventListener("click", ev =>
    ev.target.closest(".ah-fold")?.classList.toggle("ah-open")
  );

  // ---------- parts ----------
  function toggle(id) {
    const set = wired();
    if (set.includes(id)) state.on[task().id] = set.filter(x => x !== id);
    else set.push(id);
    blip(isOn(id) ? 520 : 400, 0.05, "triangle");
    save();
    draw();
    note(`${PARTS[id].name}${isOn(id) ? "" : ", off"}. ${PARTS[id].short}`);
  }

  // What to change: the first part of the known solution that isn't on. A
  // part the task introduces arrives on the map here, switched off.
  function point() {
    const id = task().sol.find(x => !isOn(x));
    if (!id) return "";
    const name = PARTS[id].name;
    if (owns(id)) {
      elOf(id)?.classList.add("ah-hinted");
      return `${name} is switched off.`;
    }
    state.owned.push(id);
    blip(660, 0.09);
    setTimeout(() => blip(880, 0.12), 90);
    save();
    draw();
    elOf(id)?.classList.add("ah-new", "ah-hinted");
    return `New part: ${name}. Tap it.`;
  }

  map.addEventListener("click", ev => {
    if (state.running) return;
    const p = ev.target.closest("[data-part]");
    if (p) toggle(p.dataset.part);
  });
  hintBtn.addEventListener("click", () => {
    if (state.running) return;
    if (state.done[task().id] && state.at < LAST) return run();
    note(point() || "This harness has what the task needs. Run it.");
  });
  runBtn.addEventListener("click", () => {
    if (state.running) {
      state.fast = true;
      return;
    }
    if (state.done[task().id] && state.at < LAST) return go(state.at + 1);
    run();
  });
  const onKey = ev => {
    if (!root.isConnected)
      return document.removeEventListener("keydown", onKey);
    if (!overlay.hidden) {
      if (ev.key === "Escape") closeOverlay();
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "r" || ev.key === "R") runBtn.click();
  };
  document.addEventListener("keydown", onKey);

  // ---------- running ----------
  async function run() {
    const T = task();
    const id = ++state.runId;
    const parts = [...wired()];
    const model = models.current();
    const alive = () => id === state.runId;
    state.running = true;
    state.fast = false;
    root.classList.add("ah-running");
    runBtn.querySelector("span").textContent = model.real ? "Running" : "Skip";
    runBtn.disabled = !!model.real;
    hintBtn.disabled = true;
    note("");
    root
      .querySelectorAll(".ah-hinted,.ah-new")
      .forEach(e => e.classList.remove("ah-hinted", "ah-new"));

    // keep the last run to read against this one
    if (panes.now.querySelector(".ah-line")) {
      panes.prev.innerHTML = panes.now.innerHTML;
      graded.prev = graded.now;
      flip.hidden = false;
    }
    panes.now.innerHTML = "";
    graded.now = null;
    show("now");
    const withEl = h(
      "p",
      "ah-with",
      parts.length
        ? `${model.name} + ${parts.map(p => PARTS[p].name).join(", ")}`
        : `${model.name}, nothing around it`
    );
    panes.now.append(withEl);
    botEl.dataset.face = "idle";

    const pace = ms =>
      model.real || state.fast ? Promise.resolve() : wait(ms);
    let live = null;
    const res = await runTask(T, parts, model, {
      onToken(text) {
        if (!alive()) return;
        botEl.dataset.face = "think";
        live ||= line("model", "Model", "");
        live.lastChild.textContent = text;
        panes.now.scrollTop = panes.now.scrollHeight;
      },
      async onStep(e) {
        if (!alive()) return;
        if (e.kind === "model") {
          if (live) live.lastChild.textContent = e.text;
          else line("model", "Model", e.text);
          live = null;
          ping("model");
          blip(500, 0.05, "triangle");
        } else if (e.kind === "user") line("user", "User", e.text);
        else if (e.kind === "end") line("end", "Run", e.text);
        else if (e.kind === "sys") panes.now.append(h("p", "ah-rule", e.text));
        else if (e.kind === "ask")
          line("part", PARTS.perms.name, e.text, "perms");
        else {
          line(e.kind, PARTS[e.part].name, tidy(e.text), e.part);
          ping(e.part);
          travel(e.part);
          blip(420, 0.05, "triangle");
        }
        await pace(PACE.line);
      },
      // The player is the user. The run waits for the answer.
      askUser({ args }) {
        return new Promise(resolve => {
          const row = h("div", "ah-askrow");
          for (const [label, yes] of [
            ["Allow", true],
            ["Deny", false],
          ]) {
            const b = h("button", `ah-btn${yes ? " ah-run" : ""}`, label);
            b.type = "button";
            b.addEventListener("click", () => {
              row.remove();
              resolve(yes);
            });
            row.append(b);
          }
          row.dataset.path = args.path || "";
          panes.now.append(row);
          panes.now.scrollTop = panes.now.scrollHeight;
        });
      },
    });
    if (!alive()) return;

    if (res.answer && !res.trace.some(e => e.kind === "end"))
      panes.now.lastChild.classList.add(res.pass ? "ah-good" : "ah-bad");
    graded.now = res;
    drawEvals(res);
    panes.now.scrollTop = panes.now.scrollHeight;

    state.running = false;
    root.classList.remove("ah-running");
    runBtn.disabled = false;
    hintBtn.disabled = false;
    const usedNew = parts.includes(T.gives);
    if (res.pass || usedNew) {
      if (state.at === state.top && state.top < LAST) state.top++;
      // solved another way: the part this task introduces still arrives
      if (!owns(T.gives)) state.owned.push(T.gives);
    }
    if (res.pass) state.done[T.id] = true;
    save();
    draw();
    if (res.pass) {
      botEl.dataset.face = "happy";
      blip(660, 0.09);
      setTimeout(() => blip(880, 0.12), 90);
      note(
        state.at < LAST
          ? "Every eval passes."
          : "Every eval passes. That's the whole harness."
      );
    } else {
      botEl.dataset.face = "sad";
      blip(160, 0.2, "sawtooth", 0.04);
      const miss = res.evals.find(e => !e.ok).label;
      const fix = point();
      note(
        `Failed: ${miss}. ${fix || (model.real ? "The harness is right; this small model still slipped. Read the trace, or move on." : "")}`,
        true
      );
    }
  }

  function go(i) {
    if (i < 0 || i > state.top) return;
    state.runId++;
    state.running = false;
    root.classList.remove("ah-running");
    runBtn.disabled = false;
    hintBtn.disabled = false;
    state.at = i;
    botEl.dataset.face = "idle";
    panes.prev.innerHTML = "";
    flip.hidden = true;
    show("now");
    save();
    closeOverlay();
    draw();
    idleTrace();
    note("");
  }

  // ---------- overlays ----------
  function closeOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = "";
  }
  overlay.addEventListener("click", ev => {
    if (ev.target === overlay) closeOverlay();
  });

  function showNotes() {
    overlay.innerHTML = "";
    overlay.hidden = false;
    const s = h("div", "ah-sheet");
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-label", "Field notes");
    const x = h("button", "ah-round ah-close", icon("x"));
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closeOverlay);
    const done = state.owned.length === ALL.length;
    const card = id => {
      const P = PARTS[id];
      const B = BRANCHES.find(b => b.id === P.branch);
      return `<article class="ah-note ah-c-${P.branch}"><header>${icon(id)}<div><small>${B.name}</small><h4>${P.name}</h4></div></header><p>${P.does}</p><p class="ah-wild"><b>In the wild</b> ${P.wild}</p></article>`;
    };
    const body = h(
      "div",
      "ah-sheetbody",
      `<p class="ah-sub">${done ? "The whole harness." : `${state.owned.length} of ${ALL.length} parts so far.`} Each one is real code running in this page.</p><div class="ah-notes">${BRANCHES.map(b => ORDER[b.id].filter(owns).map(card).join("")).join("")}</div>`
    );
    s.append(x, h("h3", "ah-sheettitle", "Field notes"), body);
    overlay.append(s);
    x.focus();
  }

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(drawWires, 120);
  });

  draw();
  idleTrace();
  show("now");
}
