// The board is a diagram: the model in the middle, six branches of harness
// parts around it. Jobs come one at a time. The player runs one, reads where
// it broke, connects the part that appears, and moves on. Progress lives in
// localStorage under one key.

import { simulate } from "./engine.js";
import { JOBS } from "./jobs.js";
import { BRANCHES, PARTS, ORDER, FAILS } from "./world.js";
import { icon } from "./icons.js";
import { openBench } from "./bench-ui.js";
import { openDrill } from "./drill.js";
import { advise } from "./guide.js";

const KEY = "ah:v3";
const ALL = Object.keys(PARTS);
const FACE = {
  notool: "confused",
  lostthread: "confused",
  unknown: "confused",
  amnesia: "confused",
  loop: "confused",
  lostplace: "dizzy",
  skipped: "dizzy",
  runaway: "dizzy",
  overflow: "dizzy",
  injected: "alarm",
  damage: "alarm",
  unapproved: "alarm",
};
// How long each kind of step holds during a run, in ms. Steps that put words
// in the bot's bubble hold long enough to read them.
const PACE = {
  start: 350,
  turn: 340,
  signal: 380,
  drop: 300,
  bubble: 900,
  bubbleStays: 1700,
};

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const branchOf = id => BRANCHES.find(b => b.id === PARTS[id].branch);

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
  const everything = new URLSearchParams(location.search).has("all");
  const LAST = JOBS.length - 1;
  const state = {
    owned: everything ? [...ALL] : saved.owned || [],
    on: saved.on || {},
    best: saved.best || {},
    top: everything ? LAST : Math.min(saved.top || 0, LAST),
    at: Math.min(saved.at || 0, LAST),
    sound: !!saved.sound,
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
          best: state.best,
          top: state.top,
          at: state.at,
          sound: state.sound,
        })
      );
    } catch {
      // private mode: play on without saving
    }
  };

  const job = () => JOBS[state.at];
  const owns = id => state.owned.includes(id);
  // A new job starts with the harness the last one ended with.
  const wired = () => {
    const J = job();
    if (!state.on[J.id]) {
      const prev = state.at ? state.on[JOBS[state.at - 1].id] : null;
      state.on[J.id] = (prev || []).filter(owns);
    }
    return state.on[J.id];
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
  const mkStep = (name, label, by) => {
    const b = h("button", "ah-round", icon(name));
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => go(state.at + by));
    return b;
  };
  const prevBtn = mkStep("back", "Previous job", -1);
  const nextBtn = mkStep("fwd", "Next job", 1);
  const countEl = h("span", "ah-count");
  pager.append(prevBtn, countEl, nextBtn);
  const tools = h("div", "ah-tools");
  const mkTool = (name, label, fn) => {
    const b = h("button", "ah-round", icon(name));
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    tools.append(b);
    return b;
  };
  head.append(nameEl, pager, tools);

  const board = h("div", "ah-board");
  const askEl = h("p", "ah-ask");
  const tipEl = h("p", "ah-tip");
  tipEl.setAttribute("aria-live", "polite");
  const heartsEl = h("div", "ah-hearts");
  const top = h("div", "ah-top");
  top.append(askEl, heartsEl, tipEl);
  const map = h("div", "ah-map");
  const wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wires.setAttribute("class", "ah-wires");
  wires.setAttribute("aria-hidden", "true");
  const modelEl = h(
    "div",
    "ah-model",
    `<div class="ah-bot" data-face="idle"><span class="ah-ant"></span><span class="ah-body"><span class="ah-visor"><i></i><i></i></span></span><span class="ah-bubble"></span></div><b>Model</b>`
  );
  const botEl = modelEl.querySelector(".ah-bot");
  const dot = h("div", "ah-dot");
  map.append(wires);
  const branchEls = {};
  for (const b of BRANCHES) {
    const e = h("section", `ah-branch ah-b-${b.id}`);
    e.dataset.branch = b.id;
    branchEls[b.id] = e;
    map.append(e);
  }
  map.append(modelEl, dot);

  const dock = h("div", "ah-dock");
  const winHead = h("div", "ah-winhead");
  const winEl = h("div", "ah-win");
  const cellsEl = h("div", "ah-cells");
  const blocksEl = h("div", "ah-blocks");
  winEl.append(cellsEl, blocksEl);
  const meter = h(
    "div",
    "ah-meter",
    `<div class="ah-bar"><span class="ah-fillbar"></span><span class="ah-partick"></span></div><div class="ah-nums"><span class="ah-tok"> </span><span class="ah-par"></span></div>`
  );
  board.append(top, map);

  const actions = h("div", "ah-actions");
  const mkBtn = (cls, ic, label) => {
    const b = h("button", `ah-btn ${cls}`, `${icon(ic)}<span>${label}</span>`);
    b.type = "button";
    actions.append(b);
    return b;
  };
  const hintBtn = mkBtn("", "bulb", "Hint");
  const runBtn = mkBtn("ah-run", "play", "Run");

  const overlay = h("div", "ah-overlay");
  overlay.hidden = true;
  dock.append(winHead, winEl, meter, actions);
  wrap.append(head, board, dock);
  root.append(wrap, overlay);

  const notesBtn = mkTool("book", "Field notes", () => showNotes());
  mkTool("target", "Permission drill", () =>
    openDrill(sheet("Drill"), { blip })
  );
  mkTool("bolt", "Live bench", () => openBench(sheet("Live bench")));
  const soundBtn = mkTool("mute", "Sound", () => {
    state.sound = !state.sound;
    save();
    syncSound();
    blip(660);
  });
  const syncSound = () => {
    soundBtn.innerHTML = icon(state.sound ? "sound" : "mute");
    soundBtn.setAttribute("aria-pressed", String(state.sound));
  };
  syncSound();

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
    const J = job();
    notesBtn.dataset.count = state.owned.length || "";
    countEl.textContent = `${state.at + 1} / ${JOBS.length}`;
    prevBtn.disabled = state.at === 0;
    nextBtn.disabled = state.at >= state.top;

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

    // window
    cellsEl.innerHTML = "";
    cellsEl.style.setProperty("--n", J.window);
    blocksEl.style.setProperty("--n", J.window);
    for (let k = 0; k < J.window; k++) cellsEl.append(h("i", "ah-cell"));

    const risky = J.steps.some(s => s.risky || s.hostile);
    heartsEl.hidden = !risky;
    heartsEl.innerHTML = Array.from({ length: J.hearts ?? 1 }, () =>
      icon("heart")
    ).join("");

    rest();
    requestAnimationFrame(drawWires);
  }

  function ask() {
    askEl.textContent = `“${job().ask}”`;
    note("");
  }

  function note(text, bad = false) {
    tipEl.textContent = text;
    tipEl.classList.toggle("ah-bad", bad);
  }

  // The window as it will be before the first turn.
  function rest() {
    const first = simulate(job(), wired()).events[0];
    renderWin(first.win, false);
    setMeter(0);
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
      const live = ORDER[b.id].some(id => owns(id) && isOn(id));
      if (!live) continue;
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

  function renderWin(win, animate = true) {
    const N = job().window;
    const have = new Map([...blocksEl.children].map(e => [e.dataset.id, e]));
    let x = 0;
    for (const b of win) {
      let e = have.get(String(b.id));
      if (!e) {
        e = h("div", "ah-block");
        e.dataset.id = b.id;
        if (animate) e.classList.add("ah-in");
        blocksEl.append(e);
      }
      have.delete(String(b.id));
      const fresh = e.classList.contains("ah-in");
      e.className = `ah-block ah-k-${b.kind}${fresh ? " ah-in" : ""}`;
      if (b.part && PARTS[b.part])
        e.classList.add(`ah-c-${PARTS[b.part].branch}`);
      if (b.hostile) e.classList.add("ah-spiked");
      if (b.shielded) e.classList.add("ah-shielded");
      if (b.red) e.classList.add("ah-red");
      if (b.parked) e.classList.add("ah-parked");
      if (x + b.size > N) e.classList.add("ah-over");
      e.style.setProperty("--x", x);
      e.style.setProperty("--w", b.size);
      let inner = "";
      if (b.kind === "task") inner = icon("task");
      else if (b.kind === "check") inner = icon(b.red ? "x" : "check");
      else if (b.kind === "err") inner = `<span class="ah-errmark">!</span>`;
      else if (b.kind === "summary") inner = icon(b.part || "compact");
      else if (b.part) inner = icon(b.part);
      const facts = b.facts.length
        ? `<span class="ah-gems">${b.facts.map(() => `<i class="ah-gem"></i>`).join("")}</span>`
        : "";
      e.innerHTML = inner + facts;
      x += b.size;
    }
    for (const e of have.values()) e.remove();
    const fill = win.reduce((n, b) => n + b.size, 0);
    winHead.innerHTML = `<button type="button" class="ah-winq" aria-label="What is the context window?">Context window<i>?</i></button><span class="ah-clock"></span><span class="${fill > N ? "ah-bad" : ""}">${fill}/${N}</span>`;
    setClock(clock);
  }
  let clock = 0;
  function setClock(turns) {
    clock = turns;
    const J = job();
    const c = winHead.querySelector(".ah-clock");
    if (!c || !J.deadline) return;
    c.textContent = `turn ${Math.min(turns, J.deadline + 1)} of ${J.deadline}`;
    c.classList.toggle("ah-bad", turns > J.deadline);
  }

  function setMeter(tok) {
    const par = job().par;
    const pct = Math.min(100, (tok / (par * 1.5)) * 100);
    meter.querySelector(".ah-fillbar").style.transform = `scaleX(${pct / 100})`;
    meter.classList.toggle("ah-overpar", tok > par);
    meter.querySelector(".ah-tok").firstChild.textContent = `${tok} tokens`;
    meter.querySelector(".ah-par").textContent = `leanest ${par}`;
  }

  let sayTimer;
  function say(text) {
    const b = botEl.querySelector(".ah-bubble");
    clearTimeout(sayTimer);
    if (text) b.textContent = text;
    b.classList.toggle("ah-show", !!text);
    if (text)
      sayTimer = setTimeout(
        () => b.classList.remove("ah-show"),
        PACE.bubbleStays
      );
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
  // A signal travelling from one box to another.
  function travel(from, to, ms) {
    const a = elOf(from);
    const z = elOf(to);
    if (!a || !z || reduced()) return;
    const p = centre(a);
    const q = centre(z);
    const part = from === "model" ? to : from;
    dot.className = `ah-dot ah-c-${PARTS[part]?.branch || "action"}`;
    dot.animate(
      [
        { transform: `translate(${p.x}px, ${p.y}px) scale(0.6)`, opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { opacity: 1, offset: 0.85 },
        { transform: `translate(${q.x}px, ${q.y}px) scale(1)`, opacity: 0 },
      ],
      { duration: ms, easing: "cubic-bezier(0.45, 0, 0.25, 1)" }
    );
  }

  // ---------- parts ----------
  function describe(id) {
    const P = PARTS[id];
    note(`${P.name}${isOn(id) ? "" : ", off"}. ${P.short}`);
  }

  function toggle(id) {
    const set = wired();
    if (set.includes(id)) {
      // anything that leans on this part goes with it
      state.on[job().id] = set.filter(x => x !== id && PARTS[x].needs !== id);
    } else {
      set.push(id);
      const dep = PARTS[id].needs;
      if (dep && owns(dep) && !set.includes(dep)) set.push(dep);
    }
    blip(isOn(id) ? 520 : 400, 0.05, "triangle");
    save();
    draw();
    describe(id);
  }

  // A part the job introduces arrives on the map, switched off.
  function hand(id) {
    state.owned.push(id);
    blip(660, 0.09);
    setTimeout(() => blip(880, 0.12), 90);
    save();
    draw();
    elOf(id)?.classList.add("ah-new", "ah-hinted");
  }

  // Point at the part to change. Returns the words to add to the tip.
  function point(a) {
    const name = PARTS[a.part].name;
    if (a.kind === "new") {
      hand(a.part);
      return `New part: ${name}. Tap it.`;
    }
    elOf(a.part)?.classList.add("ah-hinted");
    return a.kind === "on"
      ? `${name} is switched off.`
      : `Too much plugged in. Try without ${name}.`;
  }

  map.addEventListener("click", ev => {
    if (state.running) return;
    const p = ev.target.closest("[data-part]");
    if (!p) return;
    toggle(p.dataset.part);
  });
  winHead.addEventListener("click", ev => {
    if (ev.target.closest(".ah-winq")) showWindow();
  });

  hintBtn.addEventListener("click", () => {
    if (state.running) return;
    const J = job();
    const res = simulate(J, wired());
    if (res.ok) {
      const idle = wired().filter(id => !res.used.includes(id));
      note(
        res.tokens <= J.par || !idle.length
          ? "This harness does the job. Run it."
          : `This works. ${PARTS[idle[0]].name} is along for the ride, though.`
      );
      return;
    }
    const a = advise(J, wired(), state.owned, res);
    note(a ? point(a) : "");
  });
  runBtn.addEventListener("click", () => {
    if (state.running) {
      state.fast = true;
      return;
    }
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
    const J = job();
    const id = ++state.runId;
    state.running = true;
    state.fast = false;
    root.classList.add("ah-running");
    runBtn.querySelector("span").textContent = "Skip";
    ask();
    root
      .querySelectorAll(".ah-hinted,.ah-new")
      .forEach(e => e.classList.remove("ah-hinted", "ah-new"));
    const res = simulate(J, wired());
    const nap = ms => (state.fast ? Promise.resolve() : wait(ms));
    botEl.dataset.face = "idle";
    say("");
    blocksEl.innerHTML = "";
    setClock(0);

    for (const e of res.events) {
      if (id !== state.runId) return;
      switch (e.t) {
        case "start":
          renderWin(e.win, false);
          await nap(PACE.start);
          break;
        case "call": {
          botEl.dataset.face = "think";
          winEl.classList.remove("ah-scan");
          void winEl.offsetWidth;
          winEl.classList.add("ah-scan");
          setMeter(e.tokens);
          setClock(e.turns);
          const plus = h("span", "ah-plus", `+${e.cost}`);
          if (e.small || e.cached) plus.classList.add("ah-cached");
          meter.querySelector(".ah-tok").append(plus);
          setTimeout(() => plus.remove(), 900);
          const words = {
            compact: "squash",
            load: "open the guide",
            delegate: "send helpers",
          }[e.what];
          if (words) say(words);
          else if (e.small) say("small model");
          if (e.small) ping("router");
          if (e.cached) ping("cache");
          blip(300 + Math.min(e.fill, 20) * 18, 0.05);
          await nap(words || e.small ? PACE.bubble : PACE.turn);
          break;
        }
        case "signal":
          if (!state.fast) travel(e.from, e.to, PACE.signal);
          ping(e.from === "model" ? e.to : e.from);
          blip(e.from === "model" ? 500 : 420, 0.05, "triangle");
          await nap(PACE.signal);
          break;
        case "drop":
        case "compact":
          renderWin(e.win);
          blip(380, 0.04, "square", 0.02);
          await nap(PACE.drop);
          break;
        case "fresh":
          renderWin(e.win);
          say(
            {
              sleep: "new session",
              loop: "again, clean slate",
              stateless: "new message, blank slate",
            }[e.why]
          );
          await nap(PACE.bubble);
          break;
        case "rewind":
          renderWin(e.win);
          say("rolled back");
          await nap(PACE.bubble);
          break;
        case "sub":
          say(`helper ${e.sub}/${J.window}`);
          await nap(PACE.bubble * 0.7);
          break;
        case "say":
          say(e.text);
          if (e.part) ping(e.part);
          await nap(PACE.bubble);
          break;
        case "ask":
          say("may I?");
          ping("perms");
          [...heartsEl.children].forEach((x, i) =>
            x.classList.toggle("ah-gone", i >= Math.max(e.hearts, 0))
          );
          blip(240, 0.12, "sawtooth", 0.03);
          await nap(PACE.bubble);
          break;
        case "miss":
          botEl.dataset.face = "confused";
          say("where was it?");
          await nap(PACE.bubble);
          break;
        case "skip":
          say("skip that");
          await nap(PACE.bubble);
          break;
        case "end":
          await finish(res);
          break;
      }
    }
    if (id !== state.runId) return;
    state.running = false;
    root.classList.remove("ah-running");
    runBtn.querySelector("span").textContent = "Run";
    save();
  }

  async function finish(res) {
    const J = job();
    setMeter(res.tokens);
    if (res.ok) {
      botEl.dataset.face = "happy";
      blip(660, 0.09);
      setTimeout(() => blip(880, 0.12), 90);
      state.best[J.id] = Math.min(state.best[J.id] ?? Infinity, res.tokens);
      if (state.at === state.top && state.top < LAST) state.top++;
      // solved another way: the part this job introduces still arrives
      const extra = J.gives.filter(id => !owns(id));
      state.owned.push(...extra);
      save();
      await wait(state.fast ? 150 : 600);
      draw();
      renderWin(res.events[res.events.length - 1].win, false);
      setMeter(res.tokens);
      showCard(res, extra);
      return;
    }
    botEl.dataset.face = FACE[res.reason] || "sad";
    blip(160, 0.2, "sawtooth", 0.04);
    if (res.reason === "overflow") {
      winEl.classList.add("ah-shake");
      setTimeout(() => winEl.classList.remove("ah-shake"), 500);
    }
    let msg = FAILS[res.reason].say(res.info);
    const a = advise(J, wired(), state.owned, res);
    // A new part always arrives. Other pointers fade out on later jobs,
    // where the Hint button gives them instead.
    if (a && (a.kind === "new" || J.tier <= 1)) {
      msg += ` ${point(a)}`;
      renderWin(res.events[res.events.length - 1].win, false);
      setMeter(res.tokens);
    }
    note(msg, true);
  }

  function go(i) {
    if (i < 0 || i > state.top) return;
    state.runId++;
    state.running = false;
    root.classList.remove("ah-running");
    runBtn.querySelector("span").textContent = "Run";
    state.at = i;
    blocksEl.innerHTML = "";
    botEl.dataset.face = "idle";
    say("");
    clock = 0;
    save();
    closeOverlay();
    draw();
    ask();
  }

  // ---------- overlays ----------
  function closeOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = "";
  }
  overlay.addEventListener("click", ev => {
    if (ev.target === overlay) closeOverlay();
  });

  function sheet(title) {
    overlay.innerHTML = "";
    overlay.hidden = false;
    const s = h("div", "ah-sheet");
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-label", title);
    const x = h("button", "ah-round ah-close", icon("x"));
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closeOverlay);
    const body = h("div", "ah-sheetbody");
    s.append(x, h("h3", "ah-sheettitle", title), body);
    overlay.append(s);
    x.focus();
    return body;
  }

  function noteCard(id) {
    const P = PARTS[id];
    return `<article class="ah-note ah-c-${P.branch}"><header>${icon(id)}<div><small>${branchOf(id).name}</small><h4>${P.name}</h4></div></header><p>${P.does}</p><p class="ah-wild"><b>Costs</b> ${P.cost}</p><p class="ah-wild"><b>In the wild</b> ${P.wild}</p></article>`;
  }

  function showCard(res, extra) {
    const J = job();
    overlay.innerHTML = "";
    overlay.hidden = false;
    const s = h("div", "ah-sheet ah-clear");
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-label", "Job done");
    const lean = res.tokens <= J.par;
    const idle = wired().filter(id => !res.used.includes(id));
    const did = res.used
      .map(
        id =>
          `<span class="ah-did ah-c-${PARTS[id].branch}">${icon(id)}${PARTS[id].name}</span>`
      )
      .join("");
    const why = lean
      ? "As lean as it gets."
      : idle.length
        ? `Leanest is ${J.par}. ${idle.length > 2 ? `${idle.length} parts` : idle.map(id => PARTS[id].name).join(" and ")} sat idle.`
        : `Leanest is ${J.par}. There's a cheaper way.`;
    s.innerHTML = `<p class="ah-kicker">${J.name}</p><div class="ah-stars ah-big"><span class="${lean ? "ah-on" : ""} ah-pop">${icon(lean ? "star" : "check")}</span></div><p class="ah-score">${res.tokens} tokens</p><p class="ah-why">${why}</p><div class="ah-dids">${did}</div>${extra.length ? `<p class="ah-sub">New part: ${extra.map(id => PARTS[id].name).join(", ")}. It would have done this more cleanly.</p>` : ""}`;
    const row = h("div", "ah-actions");
    const again = h("button", "ah-btn", "<span>Tweak</span>");
    again.type = "button";
    again.addEventListener("click", closeOverlay);
    const more = state.at < LAST;
    const fwd = h(
      "button",
      "ah-btn ah-run",
      `<span>${more ? "Next" : "Try a real model"}</span>`
    );
    fwd.type = "button";
    fwd.addEventListener("click", () =>
      more ? go(state.at + 1) : openBench(sheet("Live bench"))
    );
    row.append(again, fwd);
    s.append(row);
    overlay.append(s);
    fwd.focus();
  }

  function showWindow() {
    const body = sheet("Context window");
    body.innerHTML = `<p class="ah-sub">Everything the model can see right now. It has no other memory.</p><ul class="ah-legend"><li><i class="ah-block ah-k-task"></i>The request.</li><li><i class="ah-block ah-k-def ah-c-action"></i>A connected part's instructions. There every turn.</li><li><i class="ah-block ah-c-action"><span class="ah-gems"><i class="ah-gem"></i></span></i>A result. A dot is a fact the job needs.</li></ul><p class="ah-sub">Each turn the model re-reads the whole strip, so a fuller window costs more tokens. Past the last cell, the job crashes.</p>`;
  }

  function showNotes() {
    const body = sheet("Field notes");
    const done = state.owned.length === ALL.length;
    body.innerHTML =
      `<p class="ah-sub">${done ? "The whole harness." : `${state.owned.length} of ${ALL.length} parts so far.`}</p><div class="ah-notes">` +
      BRANCHES.map(b => ORDER[b.id].filter(owns).map(noteCard).join("")).join(
        ""
      ) +
      `</div>`;
  }

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(drawWires, 120);
  });

  draw();
  ask();
}
