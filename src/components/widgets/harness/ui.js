// The board: draws a level, lets the player place chips, and plays back the
// engine's event list. Progress lives in localStorage under one key.

import { simulate, TOOLS } from "./engine.js";
import { LEVELS, CHAPTERS } from "./levels.js";
import { CHIPS, FAILS, NOTES, LAZY_SETS } from "./plugins.js";
import { icon } from "./icons.js";
import { openBench } from "./bench-ui.js";
import { openDrill } from "./drill.js";
import { makeDraggable } from "./drag.js";

const KEY = "ah:v1";
const GEMS = { a: 0, b: 1, c: 2, d: 3, e: 4 };
const FAMILY = {
  gate: "safe",
  wall: "safe",
  sandbox: "safe",
  rewind: "safe",
  shield: "safe",
  stop: "safe",
  trim: "ctx",
  compact: "ctx",
  pin: "ctx",
  note: "ctx",
  scout: "ctx",
  fan: "scale",
  cache: "scale",
  router: "scale",
};
const FACE = {
  noloop: "confused",
  notool: "confused",
  loop: "confused",
  amnesia: "confused",
  forgot: "dizzy",
  skipped: "dizzy",
  runaway: "dizzy",
  injected: "alarm",
  damage: "alarm",
};

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// How long each kind of step holds during a run, in ms. Steps that put words
// in the bot's bubble hold long enough to read them.
const PACE = {
  start: 350,
  turn: 360,
  hop: 380,
  fan: 260,
  drop: 320,
  squash: 500,
  bubble: 900,
  bubbleStays: 1700,
};
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
  const state = {
    stars: saved.stars || [],
    seen: saved.seen || {},
    placed: saved.placed || {},
    sound: !!saved.sound,
    at: 0,
    stage: 1,
    armed: null,
    running: false,
    fast: false,
    hints: 3,
    pick: null,
    runId: 0,
  };
  const unlockAll = new URLSearchParams(location.search).has("all");
  const save = () => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          stars: state.stars,
          seen: state.seen,
          placed: state.placed,
          sound: state.sound,
        })
      );
    } catch {
      // private mode: play on without saving
    }
  };
  const unlocked = i => unlockAll || i === 0 || state.stars[i - 1] > 0;
  const firstOpen = () => {
    let i = 0;
    while (i < LEVELS.length - 1 && state.stars[i] > 0) i++;
    return i;
  };

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
  const levelsEl = h("nav", "ah-levels");
  levelsEl.setAttribute("aria-label", "Levels");
  const head = h("div", "ah-head");
  const nameEl = h("h2", "ah-name");
  const starsEl = h("div", "ah-stars");
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
  head.append(nameEl, starsEl, tools);

  const board = h("div", "ah-board");
  const tipEl = h("p", "ah-tip");
  tipEl.setAttribute("aria-live", "polite");
  const heartsEl = h("div", "ah-hearts");
  const track = h("div", "ah-track");
  const botEl = h(
    "div",
    "ah-bot",
    `<span class="ah-ant"></span><span class="ah-body"><span class="ah-visor"><i></i><i></i></span></span><span class="ah-bubble"></span>`
  );
  botEl.dataset.face = "idle";
  const rack = h("button", "ah-rack");
  rack.type = "button";
  rack.dataset.sock = "bot";
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
  board.append(tipEl, heartsEl, track, rack, winHead, winEl, meter);

  const tray = h("div", "ah-tray");
  const actions = h("div", "ah-actions");
  const mkBtn = (cls, ic, label) => {
    const b = h("button", `ah-btn ${cls}`, `${icon(ic)}<span>${label}</span>`);
    b.type = "button";
    actions.append(b);
    return b;
  };
  const hintBtn = mkBtn("", "bulb", "Hint");
  const clearBtn = mkBtn("", "x", "Clear");
  const runBtn = mkBtn("ah-run", "play", "Run");

  const overlay = h("div", "ah-overlay");
  overlay.hidden = true;
  wrap.append(levelsEl, head, board, tray, actions);
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

  // ---------- helpers on the current level ----------
  const L = () => LEVELS[state.at];
  const mine = () => (state.placed[state.at] ||= []);
  const all = () => [...L().pre, ...mine()];
  const seenOf = i => ((state.seen[state.at] ||= {})[i] ||= {});
  const setsOf = chip =>
    TOOLS.includes(chip) && L().lazy ? LAZY_SETS : CHIPS[chip].sets;
  const sockType = at =>
    at === "bot" || at === "flag" || at === "start" || at === "trap"
      ? at
      : at[0] === "c"
        ? "cell"
        : "tile";
  const left = chip =>
    (L().tray[chip] || 0) - mine().filter(p => p.chip === chip).length;
  const canPlace = (chip, at) => {
    if (!CHIPS[chip].where.includes(sockType(at))) return false;
    if (
      at[0] === "t" &&
      at !== "trap" &&
      L().tiles[+at.slice(1)].tool === "sleep"
    )
      return false;
    return !all().some(p => p.chip === chip && p.at === at);
  };
  const full = () => L().slots && mine().length >= L().slots;

  function place(chip, at, from) {
    if (state.running || state.stage === 0) return false;
    if (!canPlace(chip, at)) return false;
    if (from) {
      from.at = at;
      state.settle = from;
    } else {
      if (left(chip) <= 0 || full()) return false;
      if (chip === "compact")
        state.placed[state.at] = mine().filter(p => p.chip !== "compact");
      state.settle = { chip, at, set: 0 };
      mine().push(state.settle);
    }
    state.armed = null;
    blip(520, 0.05, "triangle");
    save();
    draw();
    return true;
  }
  function tapPlaced(p) {
    if (state.running || p.lock || state.stage === 0) return;
    const sets = setsOf(p.chip);
    if (p.set < sets.length - 1) p.set++;
    else state.placed[state.at] = mine().filter(x => x !== p);
    blip(440, 0.04, "triangle");
    save();
    draw();
  }

  // ---------- drawing ----------
  function chipEl(p, mini) {
    const fam = TOOLS.includes(p.chip) ? "tool" : FAMILY[p.chip] || "core";
    const sets = setsOf(p.chip);
    const label = sets[p.set || 0];
    const b = h(
      p.lock ? "span" : "button",
      `ah-chip ah-${fam}${mini ? " ah-mini" : ""}${p.lock ? " ah-lock" : ""}`,
      `${icon(p.chip)}${label ? `<em>${label}</em>` : ""}`
    );
    if (!p.lock) b.type = "button";
    const name = CHIPS[p.chip].name;
    b.title = name + (label ? ` (${label})` : "");
    b.setAttribute(
      "aria-label",
      `${name}${label ? `, ${label}` : ""}${p.lock ? ", fixed" : ""}`
    );
    b.dataset.chip = p.chip;
    return b;
  }

  // A chip the player has put down: tap to change its setting or take it
  // back, drag to move it.
  function placedChip(p, mini) {
    const e = chipEl(p, mini);
    if (p.lock) return e;
    if (state.settle === p) e.classList.add("ah-settle");
    e.addEventListener("click", ev => {
      if (state.armed) return;
      ev.stopPropagation();
      tapPlaced(p);
    });
    draggable(e, p.chip, p);
    return e;
  }

  function draggable(el, chip, placedRef) {
    makeDraggable(el, {
      host: root,
      canStart: () => !state.running && state.stage !== 0 && !el.disabled,
      onStart: () => {
        state.armed = chip;
        syncArmed();
        el.classList.remove("ah-armed");
      },
      onDrop: under => {
        const sock = under?.closest("[data-sock]");
        state.armed = null;
        if (sock && place(chip, sock.dataset.sock, placedRef)) return true;
        if (placedRef && !sock) {
          // dropped off the board: back to the tray
          state.placed[state.at] = mine().filter(x => x !== placedRef);
          save();
          draw();
          return true;
        }
        syncArmed();
        return false;
      },
    });
  }

  function gemEl(g, exact, cls = "") {
    const e = h(
      "i",
      `ah-gem ah-g${GEMS[g] ?? 0}${exact ? " ah-exact" : ""} ${cls}`
    );
    return e;
  }

  function tileEl(i) {
    const T = L().tiles[i];
    const seen = seenOf(i);
    const b = h("button", "ah-tile");
    b.type = "button";
    b.dataset.sock = "t" + i;
    const known = k => !T.hide || seen[k];
    const marks = [];
    if (T.danger && known("danger")) b.classList.add("ah-danger");
    if (T.amber) b.classList.add("ah-amber");
    if (T.dull) b.classList.add("ah-dull");
    if (T.spiky && known("spiky")) b.classList.add("ah-spiky");
    if (T.err && known("err")) marks.push("!");
    if ((T.bad || T.corrupt) && seen.bad) marks.push("✗");
    if (T.dull) marks.push("z");
    const needs = (T.needs || [])
      .map(g => gemEl(g, false, "ah-need").outerHTML)
      .join("");
    // pips: one per cell, with the gem sitting where it will land
    let pips = "";
    const at = T.at || "head";
    const gi =
      !T.gem || !known("at")
        ? -1
        : at === "head"
          ? 0
          : at === "tail"
            ? T.size - 1
            : Math.floor(T.size / 2);
    for (let k = 0; k < T.size; k++)
      pips +=
        k === gi ? gemEl(T.gem, T.exact).outerHTML : `<i class="ah-pip"></i>`;
    const mystery =
      T.gem && gi < 0 ? gemEl(T.gem, T.exact, "ah-float").outerHTML : "";
    b.innerHTML = `<span class="ah-needs">${needs}</span>${icon(T.tool)}<span class="ah-marks">${marks.join("")}</span>${mystery}<span class="ah-pips">${pips}</span>`;
    const bits = [CHIPS[T.tool]?.name || "New session"];
    if (T.size) bits.push(`${T.size} cells`);
    if (T.needs?.length)
      bits.push(`needs ${T.needs.length} fact${T.needs.length > 1 ? "s" : ""}`);
    b.setAttribute("aria-label", `Tile ${i + 1}: ${bits.join(", ")}`);
    return b;
  }

  function col(sock, tile, extra) {
    const c = h("div", "ah-col");
    const slot = h("div", "ah-slot");
    for (const p of all().filter(p => p.at === sock))
      slot.append(placedChip(p, true));
    c.append(tile, slot);
    if (extra) c.append(extra);
    return c;
  }

  function draw() {
    const lv = L();
    // level chips
    levelsEl.innerHTML = "";
    LEVELS.forEach((x, i) => {
      const b = h("button", "ah-lv", String(i + 1));
      b.type = "button";
      if (i === state.at) b.setAttribute("aria-current", "true");
      if (state.stars[i]) b.dataset.stars = state.stars[i];
      if (!unlocked(i)) b.disabled = true;
      if (i > 0 && x.chapter !== LEVELS[i - 1].chapter)
        b.classList.add("ah-gap");
      b.setAttribute(
        "aria-label",
        `Level ${i + 1}, ${x.name}${state.stars[i] ? `, ${state.stars[i]} stars` : ""}`
      );
      b.addEventListener("click", () => go(i));
      levelsEl.append(b);
    });
    nameEl.innerHTML = `<small>${CHAPTERS[lv.chapter]}</small>${lv.name}`;
    drawStars(state.stars[state.at] || 0);
    notesBtn.dataset.count = state.stars.filter(Boolean).length || "";

    // track
    track.querySelectorAll(".ah-col").forEach(e => e.remove());
    const start = h("button", "ah-tile ah-start", icon("task"));
    start.type = "button";
    start.dataset.sock = "start";
    start.setAttribute("aria-label", "The task");
    track.append(col("start", start));
    lv.tiles.forEach((T, i) => {
      let extra;
      if (lv.trap === i) {
        const trap = h("button", "ah-tile ah-trap", icon("trap"));
        trap.type = "button";
        trap.dataset.sock = "trap";
        trap.setAttribute("aria-label", "Somewhere it should never go");
        const s = h("div", "ah-slot");
        for (const p of all().filter(p => p.at === "trap"))
          s.append(placedChip(p, true));
        extra = h("div", "ah-trapwrap");
        extra.append(trap, s);
      }
      track.append(col("t" + i, tileEl(i), extra));
    });
    const flag = h("button", "ah-tile ah-flag", icon("flag"));
    flag.type = "button";
    flag.dataset.sock = "flag";
    flag.setAttribute("aria-label", "Done");
    track.append(col("flag", flag));
    if (!botEl.isConnected) track.append(botEl);

    // rack
    rack.innerHTML = `<span class="ah-racklabel">harness</span>`;
    for (const p of all().filter(p => p.at === "bot"))
      rack.append(placedChip(p));

    // window
    cellsEl.innerHTML = "";
    cellsEl.style.setProperty("--n", lv.window);
    blocksEl.style.setProperty("--n", lv.window);
    const cAt = all().find(p => p.chip === "compact");
    for (let k = 1; k <= lv.window; k++) {
      const c = h("button", "ah-cell");
      c.type = "button";
      c.dataset.sock = "c" + k;
      c.setAttribute("aria-label", `Window cell ${k}`);
      if (cAt && cAt.at === "c" + k) {
        c.classList.add("ah-compact-here");
        c.innerHTML = icon("compact");
        c.addEventListener("click", ev => {
          if (state.armed) return;
          ev.stopPropagation();
          tapPlaced(cAt);
        });
      }
      cellsEl.append(c);
    }

    // hearts
    const hp = lv.hearts ?? 2;
    const showHearts =
      lv.tiles.some(t => t.danger || t.amber) || lv.trap != null;
    heartsEl.hidden = !showHearts;
    heartsEl.innerHTML = Array.from({ length: hp }, () => icon("heart")).join(
      ""
    );

    // tray
    tray.innerHTML = "";
    const kinds = Object.keys(lv.tray);
    tray.hidden = !kinds.length;
    kinds.forEach((chip, n) => {
      const cnt = left(chip);
      const e = chipEl({ chip, set: 0 });
      e.classList.add("ah-traychip");
      e.innerHTML += `<b>${CHIPS[chip].name}</b>${lv.tray[chip] > 1 ? `<u>${cnt}</u>` : ""}`;
      e.dataset.key = n + 1;
      if (cnt <= 0 || state.stage === 0) e.disabled = true;
      if (state.armed === chip) e.classList.add("ah-armed");
      e.addEventListener("click", () => {
        state.armed = state.armed === chip ? null : chip;
        syncArmed();
      });
      draggable(e, chip, null);
      tray.append(e);
    });
    if (lv.slots) {
      const s = h("span", "ah-slots", `${mine().length}/${lv.slots}`);
      tray.append(s);
    }

    tipEl.textContent = state.stage === 0 ? lv.tip : lv.tip2 || lv.tip || "";
    tipEl.classList.remove("ah-bad", "ah-good");
    hintBtn.disabled = state.stage === 0 || !lv.sol || state.hints <= 0;
    hintBtn.querySelector("span").textContent =
      state.hints < 3 ? `Hint ${state.hints}` : "Hint";
    clearBtn.disabled = state.stage === 0 || !mine().length;
    runBtn.disabled = state.stage === 0 && lv.predict && !state.pick;

    state.settle = null;
    restWindow();
    syncArmed();
    requestAnimationFrame(() => moveBot("start", true));
  }

  // What a spot on the board is, in one line. Shown when it's tapped.
  function describe(sock) {
    if (sock === "start")
      return "The task. It sits in the window from the first turn.";
    if (sock === "flag")
      return "Done. The bot gets here by answering instead of calling a tool.";
    if (sock === "trap") return "Somewhere the bot should never go.";
    const i = +sock.slice(1);
    const T = L().tiles[i];
    if (T.tool === "sleep")
      return "End of the session. The window starts over; the task is given again.";
    const seen = seenOf(i);
    const known = k => !T.hide || seen[k];
    const cells = n => `${n} cell${n === 1 ? "" : "s"}`;
    let out = `${CHIPS[T.tool].name}: the result takes ${cells(T.size)}`;
    if (T.gem) {
      out += T.exact ? " and holds an exact detail" : " and holds a fact";
      if (known("at") && T.size > 2)
        out += ` ${{ head: "at the start", tail: "at the end", mid: "in the middle" }[T.at || "head"]}`;
    }
    out += ".";
    const n = T.needs?.length;
    if (n)
      out += ` Needs ${n === 1 ? "one fact" : `${n} facts`} in the window first.`;
    if (T.danger && known("danger")) out += " Destructive.";
    if (T.amber) out += " Needs a person's say-so.";
    if (T.dull) out += " Dull, so easy to skip.";
    if (T.spiky && known("spiky")) out += " This one carries orders.";
    if (T.err && known("err")) out += " It fails before it works.";
    if ((T.bad || T.corrupt) && seen.bad) out += " This edit went wrong.";
    return out;
  }

  function drawStars(n, pop) {
    starsEl.innerHTML = [0, 1, 2]
      .map(
        i =>
          `<span class="${i < n ? "ah-on" : ""}${pop ? " ah-pop" : ""}" style="--d:${i * 90}ms">${icon("star")}</span>`
      )
      .join("");
    starsEl.setAttribute("aria-label", `${n} of 3 stars`);
  }

  // The window as it would be before the first turn.
  function restWindow() {
    const r = simulate(L(), all());
    const first = r.events[0];
    renderWin(first.win, false);
    setMeter(0);
    winHead.innerHTML = `<span>window</span><span>${first.fill}/${L().window}</span>`;
  }

  function renderWin(win, animate = true) {
    const N = L().window;
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
      e.className = `ah-block ah-k-${b.kind}${e.classList.contains("ah-in") ? " ah-in" : ""}`;
      if (b.pinned) e.classList.add("ah-pinned");
      if (b.spiky) e.classList.add("ah-spiked");
      if (b.shielded) e.classList.add("ah-shielded");
      if (b.red) e.classList.add("ah-red");
      if (b.lazy) e.classList.add("ah-lazy");
      if (x + b.size > N) e.classList.add("ah-over");
      e.style.setProperty("--x", x);
      e.style.setProperty("--w", b.size);
      let inner = "";
      if (b.kind === "def") inner = icon(b.tool);
      else if (b.kind === "task") inner = icon("task");
      else if (b.kind === "todo") inner = icon("todo");
      else if (b.kind === "notes") inner = icon("note");
      else if (b.kind === "test") inner = icon(b.red ? "x" : "check");
      else if (b.kind === "err")
        inner = `<span class="ah-errmark">${b.count > 1 ? "×" + b.count : "!"}</span>`;
      if (b.pinned) inner += icon("pin", "ah-pinmark");
      const gems = b.gems
        .map(
          g =>
            gemEl(
              g.g,
              g.exact,
              b.kind === "result" ? `ah-at-${g.at}` : "ah-loose"
            ).outerHTML
        )
        .join("");
      e.innerHTML = `${inner}<span class="ah-gems">${gems}</span>`;
      x += b.size;
    }
    for (const e of have.values()) e.remove();
    const fill = win.reduce((n, b) => n + b.size, 0);
    winHead.innerHTML = `<span>window</span><span class="${fill > N ? "ah-bad" : ""}">${fill}/${N}</span>`;
  }

  function setMeter(tok) {
    const par = L().par;
    const pct = Math.min(100, (tok / (par * 1.5)) * 100);
    meter.querySelector(".ah-fillbar").style.transform = `scaleX(${pct / 100})`;
    meter.classList.toggle("ah-overpar", tok > par);
    meter.querySelector(".ah-tok").firstChild.textContent = `${tok} tokens`;
    meter.querySelector(".ah-par").textContent = `par ${par}`;
  }

  function sockEl(at) {
    return root.querySelector(`[data-sock="${at}"]`);
  }

  function moveBot(to, instant) {
    const key = typeof to === "number" ? "t" + to : to;
    const el = sockEl(key);
    if (!el) return;
    const a = el.getBoundingClientRect();
    const b = track.getBoundingClientRect();
    const x = a.left - b.left + a.width / 2;
    const y = a.top - b.top;
    if (instant) botEl.classList.add("ah-snap");
    botEl.style.transform = `translate(${x}px, ${y}px)`;
    if (instant) {
      void botEl.offsetWidth;
      botEl.classList.remove("ah-snap");
    } else {
      botEl.classList.remove("ah-hop");
      void botEl.offsetWidth;
      botEl.classList.add("ah-hop");
    }
  }

  let sayTimer;
  function say(text) {
    const b = botEl.querySelector(".ah-bubble");
    clearTimeout(sayTimer);
    b.textContent = text;
    b.classList.toggle("ah-show", !!text);
    if (text)
      sayTimer = setTimeout(
        () => b.classList.remove("ah-show"),
        PACE.bubbleStays
      );
  }

  function syncArmed() {
    root.querySelectorAll(".ah-can").forEach(e => e.classList.remove("ah-can"));
    tray
      .querySelectorAll(".ah-traychip")
      .forEach(e =>
        e.classList.toggle("ah-armed", e.dataset.chip === state.armed)
      );
    root.classList.toggle("ah-arming", !!state.armed);
    if (!state.armed) return;
    root.querySelectorAll("[data-sock]").forEach(e => {
      if (canPlace(state.armed, e.dataset.sock)) e.classList.add("ah-can");
    });
  }

  // ---------- input ----------
  root.addEventListener("click", ev => {
    const s = ev.target.closest("[data-sock]");
    if (state.running) return;
    if (state.awaitNext) return;
    if (state.stage === 0 && L().predict && s && s.dataset.sock !== "bot") {
      state.pick = s.dataset.sock;
      root
        .querySelectorAll(".ah-pick")
        .forEach(e => e.classList.remove("ah-pick"));
      s.classList.add("ah-pick");
      runBtn.disabled = false;
      blip(600, 0.05);
      return;
    }
    if (!state.armed) {
      const tile = ev.target.closest(".ah-tile");
      if (tile) {
        tipEl.textContent = describe(tile.dataset.sock);
        tipEl.classList.remove("ah-bad");
      }
      return;
    }
    if (s && place(state.armed, s.dataset.sock)) return;
    if (!ev.target.closest(".ah-traychip")) {
      state.armed = null;
      syncArmed();
    }
  });

  const onKey = ev => {
    if (!root.isConnected)
      return document.removeEventListener("keydown", onKey);
    if (!overlay.hidden) {
      if (ev.key === "Escape") closeOverlay();
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (/^[1-9]$/.test(ev.key)) {
      const e = tray.querySelector(`[data-key="${ev.key}"]`);
      if (e && !e.disabled) {
        state.armed = e.dataset.chip;
        syncArmed();
        (root.querySelector(".ah-can") || e).focus();
      }
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const list = [
        ...root.querySelectorAll(state.armed ? ".ah-can" : "[data-sock]"),
      ];
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const n = ev.key === "ArrowRight" ? i + 1 : i - 1;
      list[(n + list.length) % list.length].focus();
      ev.preventDefault();
    } else if (ev.key === "Escape") {
      state.armed = null;
      syncArmed();
    } else if (ev.key === "r" || ev.key === "R") runBtn.click();
  };
  document.addEventListener("keydown", onKey);

  hintBtn.addEventListener("click", () => {
    const lv = L();
    if (!lv.sol || state.running) return;
    const want = lv.sol.find(
      s =>
        !mine().some(
          p =>
            p.chip === s.chip && p.at === s.at && (p.set || 0) === (s.set || 0)
        )
    );
    if (!want) {
      tipEl.textContent = "That's the layout. Run it.";
      return;
    }
    state.hints--;
    draw();
    const here = mine().find(p => p.chip === want.chip && p.at === want.at);
    const sets = setsOf(want.chip);
    tipEl.textContent = here
      ? `${CHIPS[want.chip].name}: try "${sets[want.set || 0] || "plain"}".`
      : `${CHIPS[want.chip].name} goes where it's glowing${sets[want.set || 0] ? `, set to "${sets[want.set]}"` : ""}.`;
    sockEl(want.at)?.classList.add("ah-hinted");
    tray
      .querySelector(`[data-chip="${want.chip}"]`)
      ?.classList.add("ah-hinted");
  });
  clearBtn.addEventListener("click", () => {
    if (state.running) return;
    state.placed[state.at] = [];
    save();
    draw();
  });
  runBtn.addEventListener("click", () => {
    if (state.awaitNext) return nextStage();
    if (state.running) {
      state.fast = true;
      return;
    }
    run();
  });

  // ---------- running ----------
  async function run() {
    const lv = L();
    const id = ++state.runId;
    state.running = true;
    state.fast = false;
    state.armed = null;
    syncArmed();
    root.classList.add("ah-running");
    runBtn.querySelector("span").textContent = "Skip";
    tipEl.classList.remove("ah-bad", "ah-good");
    root
      .querySelectorAll(".ah-hinted,.ah-shake")
      .forEach(e => e.classList.remove("ah-hinted", "ah-shake"));
    const res = simulate(lv, all());
    const nap = ms => (state.fast ? Promise.resolve() : wait(ms));
    let hearts = lv.hearts ?? 2;
    botEl.dataset.face = "idle";
    say("");
    moveBot("start", true);
    blocksEl.innerHTML = "";

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
          const plus = h("span", "ah-plus", `+${e.cost}`);
          if (e.small) plus.classList.add("ah-small");
          if (e.cached) plus.classList.add("ah-cached");
          meter.querySelector(".ah-tok").append(plus);
          setTimeout(() => plus.remove(), 900);
          if (e.what === "compact") say("squash");
          else if (e.what === "load") say("open manual");
          else if (e.what === "delegate") say("send scout");
          else if (e.small) say("small model");
          blip(300 + Math.min(e.fill, 20) * 18, 0.05);
          await nap(e.what === "turn" && !e.small ? PACE.turn : PACE.bubble);
          break;
        }
        case "hop":
          botEl.dataset.face = e.back
            ? "confused"
            : e.to === "trap"
              ? "alarm"
              : "idle";
          moveBot(e.to);
          blip(e.to === "trap" ? 180 : 500, 0.06, "triangle");
          await nap(e.fan ? PACE.fan : PACE.hop);
          break;
        case "reach":
          botEl.dataset.face = "confused";
          await nap(PACE.bubble);
          break;
        case "drop":
        case "note":
        case "load":
          renderWin(e.win);
          blip(380, 0.04, "square", 0.02);
          await nap(PACE.drop);
          break;
        case "compact":
          renderWin(e.win);
          if (e.lost.length || e.lostTask) say("lost detail");
          await nap(e.lost.length || e.lostTask ? PACE.bubble : PACE.squash);
          break;
        case "rewind":
          renderWin(e.win);
          say("rewind");
          moveBot(e.to > 0 ? e.to - 1 : "start");
          await nap(PACE.bubble);
          break;
        case "sleep":
          renderWin(e.win);
          say("new session");
          await nap(PACE.bubble);
          break;
        case "scout":
          say(`scout ${e.sub}/${lv.window}`);
          moveBot(e.tile);
          await nap(PACE.bubble);
          break;
        case "check":
          say(e.red ? "tests fail" : "tests pass");
          await nap(PACE.bubble);
          break;
        case "say":
          say(e.text);
          await nap(PACE.bubble);
          break;
        case "alt":
          say("plan B");
          await nap(PACE.bubble);
          break;
        case "skip":
          say("skip");
          sockEl("t" + e.tile)?.classList.add("ah-skipped");
          await nap(PACE.bubble);
          break;
        case "miss":
          botEl.dataset.face = "confused";
          say("where was it?");
          await nap(PACE.bubble);
          break;
        case "ask":
          hearts = e.hearts;
          say("may I?");
          [...heartsEl.children].forEach((x, i) =>
            x.classList.toggle("ah-gone", i >= Math.max(hearts, 0))
          );
          blip(240, 0.12, "sawtooth", 0.03);
          await nap(PACE.bubble);
          break;
        case "reveal": {
          const s = seenOf(e.tile);
          if (!s[e.what]) {
            s[e.what] = true;
            const old = sockEl("t" + e.tile);
            const fresh = tileEl(e.tile);
            old.replaceWith(fresh);
          }
          break;
        }
        case "end":
          await finish(res, e);
          break;
      }
    }
    if (id !== state.runId) return;
    state.running = false;
    root.classList.remove("ah-running");
    runBtn.querySelector("span").textContent = state.awaitNext ? "Next" : "Run";
    save();
  }

  async function finish(res, e) {
    const lv = L();
    setMeter(res.tokens);
    if (res.ok) {
      botEl.dataset.face = "happy";
      blip(660, 0.09);
      setTimeout(() => blip(880, 0.12), 90);
      const worked = lv.mode === "worked" && state.stage === 0;
      if (worked) {
        tipEl.textContent = `It gets there: ${res.tokens} tokens in ${res.turns} turns.`;
        state.awaitNext = true;
        return;
      }
      const best = Math.max(state.stars[state.at] || 0, res.stars);
      state.stars[state.at] = best;
      save();
      notesBtn.dataset.count = state.stars.filter(Boolean).length;
      const chip = levelsEl.children[state.at];
      if (chip) chip.dataset.stars = best;
      drawStars(res.stars, true);
      await wait(state.fast ? 150 : 600);
      showCard(res);
    } else {
      botEl.dataset.face = FACE[res.reason] || "sad";
      blip(160, 0.2, "sawtooth", 0.04);
      const where = res.info.tile;
      if (where != null && where >= 0)
        sockEl("t" + where)?.classList.add("ah-shake");
      if (res.reason === "injected") sockEl("trap")?.classList.add("ah-shake");
      if (res.reason === "overflow") winEl.classList.add("ah-shake");
      setTimeout(() => winEl.classList.remove("ah-shake"), 500);
      let msg = FAILS[res.reason]?.(res.info) || "That didn't work.";
      if (state.stage === 0) {
        if (lv.predict) {
          const hit = lv.predict.includes(state.pick);
          msg = (hit ? "Called it. " : "Not there. ") + msg;
        }
        tipEl.textContent = msg;
        tipEl.classList.add("ah-bad");
        state.awaitNext = true;
        return;
      }
      tipEl.textContent = msg;
      tipEl.classList.add("ah-bad");
    }
  }

  // Worked examples: after the bare run, the level's own chips drop in.
  function nextStage() {
    const lv = L();
    state.awaitNext = false;
    say("");
    botEl.dataset.face = "idle";
    state.stage = 1;
    state.pick = null;
    state.placed[state.at] = (lv.demo || []).map(d => ({ set: 0, ...d }));
    state.running = false;
    root.classList.remove("ah-running");
    runBtn.querySelector("span").textContent = "Run";
    draw();
    root
      .querySelectorAll(
        ".ah-slot .ah-chip:not(.ah-lock), .ah-rack .ah-chip:not(.ah-lock)"
      )
      .forEach(e => e.classList.add("ah-dropin"));
  }

  function go(i) {
    if (!unlocked(i)) return;
    state.runId++;
    state.running = false;
    root.classList.remove("ah-running");
    runBtn.querySelector("span").textContent = "Run";
    state.at = i;
    state.hints = 3;
    state.pick = null;
    state.armed = null;
    state.awaitNext = false;
    say("");
    const lv = LEVELS[i];
    state.stage = lv.mode === "worked" && !state.stars[i] ? 0 : 1;
    if (state.stage === 0) state.placed[i] = [];
    else if (lv.mode === "worked" && !state.placed[i]?.length)
      state.placed[i] = (lv.demo || []).map(d => ({ set: 0, ...d }));
    blocksEl.innerHTML = "";
    botEl.dataset.face = "idle";
    closeOverlay();
    draw();
    levelsEl
      .querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
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

  function noteCard(i) {
    const n = NOTES[i];
    return `<article class="ah-note"><header>${icon(n.chip)}<div><small>${String(i + 1).padStart(2, "0")}</small><h4>${n.title}</h4></div></header><p>${n.idea}</p><p class="ah-wild"><b>In the wild</b> ${n.wild}</p></article>`;
  }

  function showCard(res) {
    const i = state.at;
    overlay.innerHTML = "";
    overlay.hidden = false;
    const s = h("div", "ah-sheet ah-clear");
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-label", "Level cleared");
    const stars = [0, 1, 2]
      .map(
        k =>
          `<span class="${k < res.stars ? "ah-on" : ""} ah-pop" style="--d:${k * 110}ms">${icon("star")}</span>`
      )
      .join("");
    const why = [];
    if (res.tokens > L().par)
      why.push(`${res.tokens - L().par} tokens over par`);
    if (res.lostHearts > (L().heartPar || 0))
      why.push("asked the user more than needed");
    s.innerHTML = `<p class="ah-kicker">Level ${String(i + 1).padStart(2, "0")} cleared</p><div class="ah-stars ah-big">${stars}</div><p class="ah-why">${why.length ? why.join(" · ") : `${res.tokens} tokens, ${res.turns} turns`}</p>${noteCard(i)}`;
    const row = h("div", "ah-actions");
    const tweak = h("button", "ah-btn", "<span>Tweak</span>");
    tweak.type = "button";
    tweak.addEventListener("click", closeOverlay);
    const last = i === LEVELS.length - 1;
    const next = h(
      "button",
      "ah-btn ah-run",
      `<span>${last ? "Field notes" : "Next level"}</span>`
    );
    next.type = "button";
    next.addEventListener("click", () => (last ? showNotes() : go(i + 1)));
    row.append(tweak, next);
    s.append(row);
    overlay.append(s);
    next.focus();
  }

  function showNotes() {
    const body = sheet("Field notes");
    const got = state.stars.filter(Boolean).length;
    body.innerHTML =
      `<p class="ah-sub">${got} of ${NOTES.length} collected. Clear a level to keep its note.</p><div class="ah-notes">` +
      NOTES.map((n, i) =>
        state.stars[i]
          ? noteCard(i)
          : `<article class="ah-note ah-locked"><header>${icon("lock")}<div><small>${String(i + 1).padStart(2, "0")}</small><h4>${CHAPTERS[LEVELS[i].chapter]}</h4></div></header></article>`
      ).join("") +
      `</div>`;
  }

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => !state.running && moveBot("start", true), 120);
  });

  go(firstOpen());
}
