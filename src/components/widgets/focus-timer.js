// Logic for <FocusTimer />. Everything is looked up inside `root`, and all
// state lives in localStorage under one key, so nothing leaves the browser.
//
// The countdown is driven by a wall-clock end time (not by counting ticks), so
// it stays accurate in background tabs and survives a page reload. A plan is
// a list of blocks pinned to clock times; while following one, the timer
// counts down to the current block's planned end.

import {
  blockAt,
  buildPlan,
  describePlan,
  summarizePlan,
} from "./focus-plan.js";
import { createMini, miniSupported } from "./focus-mini.js";
import {
  assignTodos,
  clampEst,
  fmtSessions,
  makeTodo,
  openTodos,
  parseTaskLine,
  parseTaskLines,
  sessionsSpent,
} from "./focus-todos.js";
import {
  DIAL_MS,
  FRUIT_IDS,
  MIN,
  fmtClock,
  wedgePath,
} from "./focus-shared.js";

const STORAGE_KEY = "lab-focus-timer-v2";
const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4 };
const LIMITS = {
  focus: [1, 180],
  short: [1, 60],
  long: [1, 90],
  every: [2, 12],
};
const HISTORY_DAYS = 30;
const SWEEP_PHASE_MS = 600; // a session ending: rare, can take its time
const SWEEP_SWITCH_MS = 260; // clicking a mode tab: a UI response
const TOAST_MS = 5000;
const MIN_PLAN_MS = 10 * MIN;
const MAX_PLAN_MS = 12 * 60 * MIN;
// Shown on the task line during a break, one per break.
const BREAK_PROMPTS = {
  short: [
    "roll your shoulders back",
    "look at something far away",
    "stretch your arms overhead",
    "refill your water",
    "unclench your jaw",
    "roll your wrists and ankles",
    "take three slow breaths",
    "stand up and touch your toes",
  ],
  long: [
    "take a short walk",
    "step outside for some air",
    "get a snack and some water",
    "stretch your back and hips",
    "rest your eyes for a minute",
  ],
};
const NOTE_MAX = 140;

const KIND_NAME = {
  focus: "focus",
  short: "short break",
  long: "long break",
  wrap: "wrap up",
};

// cubic-bezier(0.23, 1, 0.32, 1): the strong ease-out used across the piece.
function easeOut(t) {
  const [x1, y1, x2, y2] = [0.23, 1, 0.32, 1];
  const bez = (a, b, u) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(y1, y2, (lo + hi) / 2);
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") ?? {};
  } catch {
    return {};
  }
}

const dayKey = ts => new Date(ts).toDateString();

function fmtMinutes(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const fmtTime = ts =>
  new Date(ts)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();

function clampSetting(key, value) {
  const [lo, hi] = LIMITS[key];
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULTS[key];
}

// "HH:MM" from an <input type="time"> to a clock time: today, or tomorrow
// if that time is more than 12 hours gone (a late-night plan past midnight).
// A time that passed recently stays in the past, so it can be reported as
// such instead of turning into a 23-hour plan.
function nextClockTime(value, now) {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (now - d.getTime() > 12 * 60 * MIN) d.setDate(d.getDate() + 1);
  return d.getTime();
}

const toTimeValue = ts => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function mountFocusTimer(root) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const $ = name => root.querySelector(`[data-ft="${name}"]`);
  const el = {
    dial: $("dial"),
    wedge: $("wedge"),
    hand: $("hand"),
    hub: $("hub"),
    time: $("time"),
    task: $("task"),
    recent: $("recent"),
    sound: $("sound"),
    mini: $("mini-btn"),
    notify: $("notify"),
    cycle: $("cycle"),
    todayWrap: $("today-wrap"),
    dots: $("dots"),
    total: $("total"),
    toast: $("toast"),
    glow: { focus: $("glow-focus"), break: $("glow-break") },
    tabs: [...root.querySelectorAll("[data-ft-mode]")],
    fields: [...root.querySelectorAll("[data-ft-set]")],
    resetToday: $("reset-today"),
    clearHistory: $("clear-history"),
    fruitBtn: $("fruit-btn"),
    fruitIcon: $("fruit-icon"),
    fruits: [...root.querySelectorAll("[data-ft-fruit]")],
    panels: {
      fruit: { btn: $("fruit-btn"), panel: $("fruit-panel") },
      settings: { btn: $("settings-btn"), panel: $("panel") },
      tasks: { btn: $("tasks-btn"), panel: $("tasks-panel") },
      plan: { btn: $("plan-btn"), panel: $("plan-panel") },
    },
    todoList: $("todo-list"),
    notesWrap: $("notes-wrap"),
    notes: $("notes"),
    todoDoneWrap: $("todo-done-wrap"),
    todoDone: $("todo-done"),
    planEnd: $("plan-end"),
    planQuick: [...root.querySelectorAll("[data-plan-add]")],
    planSummary: $("plan-summary"),
    planGo: $("plan-go"),
    planClear: $("plan-clear"),
    strip: $("strip"),
    stripStart: $("strip-start"),
    stripEnd: $("strip-end"),
    track: $("track"),
    stripActions: $("strip-actions"),
    now: $("now"),
    replan: $("replan"),
    editor: $("label-editor"),
    editorTime: $("label-time"),
    editorInput: $("label-input"),
  };

  const saved = load();
  const t = saved.timer ?? {};
  const settings = { ...DEFAULTS, ...saved.settings };
  // Older saves kept only the last focus length.
  if (!saved.settings && saved.lastFocus) settings.focus = saved.lastFocus;
  for (const key of Object.keys(DEFAULTS)) {
    settings[key] = clampSetting(key, settings[key]);
  }

  const state = {
    log: Array.isArray(saved.log) ? saved.log : [],
    sound: saved.sound ?? false,
    fruit: FRUIT_IDS.includes(saved.fruit) ? saved.fruit : "tomato",
    notify: saved.notify ?? false,
    settings,
    plan: saved.plan?.blocks?.length ? saved.plan : null,
    todos: Array.isArray(saved.todos) ? saved.todos : [],
    notes: Array.isArray(saved.notes) ? saved.notes : [],
    notesSeenAt: saved.notesSeenAt ?? 0,
    mode: t.mode === "break" ? "break" : "focus",
    breakKind: ["long", "wrap"].includes(t.breakKind) ? t.breakKind : "short",
    setMs: t.setMs ?? settings.focus * MIN,
    remaining: t.remaining ?? null,
    running: Boolean(t.running),
    endAt: t.endAt ?? null,
    startedAt: t.startedAt ?? null,
    task: t.task ?? "",
    done: t.done ?? 0,
    cycleDay: t.cycleDay ?? null, // the day `done` was last counted
    planIdx: t.planIdx ?? null, // block the timer is following
    planPaused: Boolean(t.planPaused),
    todoId: t.todoId ?? null, // the list task being worked on, if any
    // Checking off a task mid-session hands the rest of the session to the
    // next one: `credited` is the focus time already logged to earlier
    // tasks, and `segAt` when the current one took over.
    credited: t.credited ?? 0,
    segAt: t.segAt ?? null,
  };
  if (state.remaining == null) state.remaining = state.setMs;
  // A new day starts a new cycle toward the long break.
  if (state.cycleDay !== dayKey(Date.now())) state.done = 0;

  const pageTitle = document.title;
  let interval = null;
  let audio = null;
  let dragging = false;
  let dragMinutes = 0;
  let lastFrameKey = "";
  let sweep = null; // { to, from, start, ms, raf } while the wedge animates
  let shiftTimer = null;
  let toastTimer = null;
  let editingId = null;
  let stripKey = "";
  let stripSecond = -1;

  const mini = createMini({
    onToggle: () => toggle(),
    onTick: () => tick(),
    onClose: () => render(),
  });

  // The pop-out and the fruit icons draw the same fruit as the dial: a copy
  // of the dial's SVG without the ticks, numerals, hand and the other
  // fruits' parts, carrying that fruit's colors as resolved from the page's
  // CSS (read off a hidden probe, so any fruit can be drawn, not only the
  // current one).
  const ART_VARS = [
    "--fruit-skin",
    "--fruit-shade",
    "--fruit-rind",
    "--fruit-face",
    "--fruit-face-shade",
    "--fruit-leaf",
    "--fruit-stem",
    "--fruit-seed",
    "--ft-wedge",
  ];
  const artCache = new Map();
  function fruitSvg(fruit, mode, { icon = false } = {}) {
    const key = `${fruit}|${mode}|${icon}`;
    if (artCache.has(key)) return artCache.get(key);
    const probe = document.createElement("div");
    probe.className = "ft";
    probe.dataset.fruit = fruit;
    probe.dataset.mode = mode;
    probe.style.display = "none";
    root.append(probe);
    const css = getComputedStyle(probe);
    const vars = ART_VARS.map(
      v => `${v}:${css.getPropertyValue(v).trim()}`
    ).join(";");
    probe.remove();

    const svg = el.dial.querySelector("svg").cloneNode(true);
    for (const n of svg.querySelectorAll(".ft-tick, .ft-num, .ft-hand")) {
      n.remove();
    }
    for (const n of svg.querySelectorAll("[data-fruit-only]")) {
      if (n.dataset.fruitOnly === fruit) n.removeAttribute("data-fruit-only");
      else n.remove();
    }
    const wedge = svg.querySelector(".ft-wedge");
    wedge.removeAttribute("d");
    wedge.removeAttribute("data-ft");
    // Icons show 25 minutes set, like the Lab thumbnail.
    if (icon) wedge.setAttribute("d", wedgePath(25 / 60));
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Room for the stem and leaves above the body.
    svg.setAttribute("viewBox", "-180 -212 360 394");
    svg.setAttribute("style", vars);
    artCache.set(key, svg.outerHTML);
    return artCache.get(key);
  }

  // An icon sits in the page beside the dial, so its clip-path ids get a
  // suffix of their own instead of repeating the dial's.
  let iconSeq = 0;
  function fruitIcon(fruit) {
    const n = ++iconSeq;
    return fruitSvg(fruit, "focus", { icon: true }).replace(
      /ft-(body-clip|wedge-clip|wedge-path)/g,
      `$&-icon${n}`
    );
  }
  for (const btn of el.fruits) {
    btn.querySelector(".ft-fruit-art").innerHTML = fruitIcon(
      btn.dataset.ftFruit
    );
  }

  function miniView() {
    const left = Math.max(0, remainingMs());
    const focus = state.mode === "focus";
    // Before a session starts, show what's typed in the task line so far.
    const task = inProgress() ? state.task : el.task.value.trim();
    const label = focus ? task || "focus" : KIND_NAME[state.breakKind];
    return {
      // The mini window counts down from these itself.
      endAt: state.running ? state.endAt : null,
      remaining: left,
      setMs: state.setMs,
      label,
      mode: state.mode,
      running: state.running,
      started: inProgress(),
      art: fruitSvg(state.fruit, state.mode),
      artKey: `${state.fruit}|${state.mode}`,
      dark: document.documentElement.dataset.theme === "dark",
    };
  }

  const tabKey = () => (state.mode === "focus" ? "focus" : state.breakKind);
  const lengthFor = key => state.settings[key] * MIN;

  function save() {
    const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
    state.log = state.log.filter(s => s.end >= cutoff);
    state.todos = state.todos.filter(t => !t.doneAt || t.doneAt >= cutoff);
    const {
      log,
      sound,
      fruit,
      notify,
      settings,
      plan,
      todos,
      notes,
      notesSeenAt,
      ...timer
    } = state;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          log,
          sound,
          fruit,
          notify,
          settings,
          plan,
          todos,
          notes,
          notesSeenAt,
          timer,
        })
      );
    } catch {
      // Storage can be unavailable (private mode); the timer still works.
    }
  }

  const remainingMs = () =>
    state.running ? state.endAt - Date.now() : state.remaining;

  const inProgress = () =>
    state.running || (state.startedAt != null && state.remaining > 0);

  const following = () => state.plan != null && !state.planPaused;

  // ---- Sound -------------------------------------------------------------

  function ensureAudio() {
    if (!audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audio = new Ctx();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  // A different sound for each turn of the cycle, so you can tell them
  // apart without looking: a soft, falling pair as a break begins (three
  // notes for a long one), a brighter rising pair back to focus, and the
  // full four-note chime when a plan is done.
  const CHIMES = {
    short: { notes: [659.25, 523.25], gap: 0.38, peak: 0.12, decay: 1.8 },
    long: { notes: [659.25, 523.25, 392], gap: 0.42, peak: 0.12, decay: 2 },
    wrap: { notes: [523.25, 392], gap: 0.4, peak: 0.1, decay: 1.8 },
    focus: { notes: [523.25, 783.99], gap: 0.16, peak: 0.18, decay: 1.1 },
    done: {
      notes: [784, 1046.5, 784, 1046.5],
      offsets: [0, 0.22, 0.9, 1.12],
      peak: 0.22,
      decay: 1.2,
    },
  };

  function chime(kind = "done") {
    if (!state.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const c = CHIMES[kind] ?? CHIMES.done;
    const now = ctx.currentTime;
    c.notes.forEach((freq, i) => {
      const at = now + (c.offsets?.[i] ?? i * c.gap);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      // Breaks fade in a little slower, so they don't startle.
      gain.gain.exponentialRampToValueAtTime(
        c.peak,
        at + (kind === "focus" || kind === "done" ? 0.02 : 0.05)
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, at + c.decay);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + c.decay + 0.05);
    });
  }

  // A single soft click per minute while dragging, like a mechanical dial.
  function tickSound() {
    if (!state.sound || !audio || audio.state !== "running") return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = 2200;
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  // ---- Gentle notices ----------------------------------------------------

  // A soft note at the top of the page, and (if allowed, and you're not
  // looking at the page) a silent system notification with the same words.
  // `action` adds a button to the note, e.g. { label: "undo", run }.
  function notice(text, action = null) {
    el.toast.textContent = text;
    delete el.toast.dataset.action;
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        el.toast.dataset.show = "false";
        delete el.toast.dataset.action;
        action.run();
      });
      el.toast.append(btn);
      el.toast.dataset.action = "";
    }
    el.toast.dataset.show = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.dataset.show = "false";
      delete el.toast.dataset.action;
    }, TOAST_MS);

    if (
      state.notify &&
      // Hidden tab, minimized window, or another app in front (but not
      // while you're using the mini window, which shows the change itself).
      (document.hidden || !document.hasFocus()) &&
      !mini.hasFocus() &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        const n = new Notification(text, {
          silent: true,
          tag: "focus-timer",
          icon: "/favicon.ico",
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
  }

  function phaseNotice(nextKind, nextLabel) {
    const text = phaseText(nextKind, nextLabel);
    // A break is when to look at what you jotted down.
    const n = unseenNotes();
    if (nextKind === "focus" || !n) return text;
    return `${text} · ${n} ${n === 1 ? "note" : "notes"} in tasks`;
  }

  function phaseText(nextKind, nextLabel) {
    if (nextKind === "focus") {
      return nextLabel
        ? `back to it ✿ next up: ${nextLabel}`
        : "break's over ✿ back to it";
    }
    if (nextKind === "long") return "lovely streak ✿ enjoy a long break";
    if (nextKind === "wrap") return "nice work ✿ a few minutes to wrap up";
    return "nice work ✿ time for a short break";
  }

  // ---- Timer -------------------------------------------------------------

  function setLength(ms) {
    state.setMs = ms;
    state.remaining = ms;
    state.running = false;
    state.endAt = null;
    state.startedAt = null;
    state.credited = 0;
    state.segAt = null;
    stopTicking();
  }

  // Switch to a tab's mode and load its length (not started).
  function goTo(key) {
    if (key === "focus") {
      state.mode = "focus";
    } else {
      state.mode = "break";
      state.breakKind = key;
    }
    setLength(lengthFor(key));
  }

  // `ms` is the focus time itself (the session or block length), so time
  // spent paused isn't counted.
  // Returns whether the session counted toward the long break.
  function logFocus(task, start, end, ms, todoId = state.todoId) {
    // Part of the session may already be logged to tasks checked off
    // during it; this logs the rest.
    const split = state.credited > 0;
    const from = state.segAt ?? start;
    const minutes = Math.round((ms - state.credited) / MIN);
    state.credited = 0;
    state.segAt = null;
    if (minutes >= 1) {
      pushLog({ task: task || "untitled", start: from, end, minutes, todoId });
    } else if (split) {
      // Too little left to log: the last part stands for the session.
      const last = state.log.at(-1);
      if (last) delete last.part;
    } else {
      return false;
    }
    state.done += 1;
    state.cycleDay = dayKey(end);
    return true;
  }

  // Every log entry adds its minutes to its list task.
  function pushLog(entry) {
    if (!entry.todoId) delete entry.todoId;
    state.log.push(entry);
    const todo = state.todos.find(t => t.id === entry.todoId);
    if (todo) todo.spentMin += entry.minutes;
  }

  // Log the focus time so far to the current task, so the rest of the
  // session can go to another one. A part isn't a session of its own: the
  // day's dots and the long-break count skip it.
  function splitSession() {
    const elapsed = state.setMs - Math.max(0, remainingMs());
    const minutes = Math.round((elapsed - state.credited) / MIN);
    if (minutes < 1) return;
    const now = Date.now();
    pushLog({
      task: state.task || "untitled",
      start: state.segAt ?? state.startedAt ?? now - minutes * MIN,
      end: now,
      minutes,
      todoId: state.todoId,
      part: true,
    });
    state.credited = elapsed;
    state.segAt = now;
  }

  function tryStart() {
    if (state.running) return;
    if (state.plan && state.planPaused) {
      // Rejoin the plan at whatever block the clock is in now.
      state.planPaused = false;
      syncPlan({ resume: true });
      return;
    }
    if (remainingMs() <= 0) return;
    cancelSweep();
    ensureAudio(); // unlock audio during a user gesture
    if (state.mode === "focus" && state.startedAt == null) {
      state.task = el.task.value.trim();
      linkTodo();
    }
    if (state.startedAt == null) state.startedAt = Date.now();
    state.endAt = Date.now() + state.remaining;
    state.running = true;
    el.task.blur();
    startTicking();
    save();
    render();
  }

  function pause() {
    if (!state.running) return;
    state.remaining = Math.max(0, state.endAt - Date.now());
    state.endAt = null;
    state.running = false;
    if (state.plan) {
      // Keep ticking so the strip's now marker moves while paused.
      state.planPaused = true;
    } else {
      stopTicking();
    }
    save();
    render();
  }

  const toggle = () => (state.running ? pause() : tryStart());

  // `early`: skipped before its time was up, so only the time spent counts.
  function complete({ quiet = false, early = false } = {}) {
    const end = early ? Date.now() : (state.endAt ?? Date.now());
    const ms = early ? state.setMs - Math.max(0, remainingMs()) : state.setMs;
    let next;
    if (state.mode === "focus") {
      const counted = logFocus(
        state.task,
        state.startedAt ?? end - ms,
        end,
        ms
      );
      el.task.value = "";
      next =
        counted && state.done % state.settings.every === 0 ? "long" : "short";
    } else {
      if (state.breakKind === "long") state.done = 0;
      next = "focus";
      // Offer the last task again; it's still editable before starting.
      el.task.value = state.task;
    }
    goTo(next);
    if (!quiet) {
      chime(next);
      notice(phaseNotice(next, next === "focus" ? state.task : ""));
    }
    save();
    render();
    if (!quiet) animateWedge(0, state.setMs, SWEEP_PHASE_MS);
  }

  function tick() {
    if (following()) {
      syncPlan();
      return;
    }
    if (state.plan && Date.now() >= state.plan.end) {
      // A paused plan whose time is up just ends, quietly.
      syncPlan({ resume: true });
      return;
    }
    if (state.running && remainingMs() <= 0) complete();
    else renderClock();
    if (state.plan) renderStripNow();
  }

  function startTicking() {
    stopTicking();
    interval = setInterval(tick, 200);
  }

  function stopTicking() {
    if (interval) clearInterval(interval);
    interval = null;
  }

  // ---- Plans -------------------------------------------------------------

  // Point the timer at the block the clock is in. Called every tick while
  // following a plan; does real work only when the block changes.
  function syncPlan({ fromLoad = false, resume = false } = {}) {
    const plan = state.plan;
    if (!plan) return;
    const now = Date.now();
    const blocks = plan.blocks;
    const prev = state.planIdx != null ? blocks[state.planIdx] : null;

    if (now >= plan.end) {
      if (prev?.kind === "focus" && !resume) {
        logFocus(
          prev.label,
          prev.start,
          prev.end,
          prev.end - prev.start,
          prev.todoId ?? null
        );
      }
      state.plan = null;
      state.planIdx = null;
      state.planPaused = false;
      goTo("focus");
      if (!fromLoad) {
        chime("done");
        notice(`all done ✿ that's your plan until ${fmtTime(plan.end)}`);
      }
      save();
      render();
      return;
    }

    const idx = blockAt(blocks, now);
    if (idx < 0) return;
    if (idx === state.planIdx && state.running) {
      renderClock();
      renderStripNow();
      return;
    }

    const changed = idx !== state.planIdx;
    if (changed && prev?.kind === "focus" && !resume && prev.end <= now) {
      logFocus(
        prev.label,
        prev.start,
        prev.end,
        prev.end - prev.start,
        prev.todoId ?? null
      );
    }
    if (changed) {
      state.credited = 0;
      state.segAt = null;
    }

    const block = blocks[idx];
    state.planIdx = idx;
    if (block.kind === "focus") {
      state.mode = "focus";
      state.task = block.label;
      state.todoId = block.todoId ?? null;
      el.task.value = block.label;
    } else {
      state.mode = "break";
      state.breakKind = block.kind;
      el.task.value = "";
    }
    state.setMs = block.end - block.start;
    state.startedAt = block.start;
    state.endAt = block.end;
    state.remaining = null;
    state.running = true;
    startTicking();
    save();
    render();

    if (changed && prev && !fromLoad && !resume) {
      chime(block.kind);
      notice(phaseNotice(block.kind, block.label));
      animateWedge(0, block.end - now, SWEEP_PHASE_MS);
    }
  }

  function startPlan(end) {
    const now = Date.now();
    const label = el.task.value.trim() || state.task;
    cancelSweep();
    if (!inProgress()) {
      state.task = label;
      linkTodo();
    }
    state.plan = {
      start: now,
      end,
      blocks: buildPlan(now, end, state.settings, label),
    };
    // With a task list, the blocks are named after its tasks.
    assignTodos(state.plan.blocks, 0, state.todos, {
      currentId: state.todoId,
      focusMin: state.settings.focus,
    });
    state.planIdx = null;
    state.planPaused = false;
    ensureAudio();
    closePanels();
    syncPlan({ fromLoad: true });
    const from = 0;
    animateWedge(from, Math.max(0, remainingMs()), SWEEP_PHASE_MS);
    notice(
      `planned until ${fmtTime(end)} ✿ ${describePlan(state.plan.blocks)}`
    );
  }

  function clearPlan() {
    state.plan = null;
    state.planIdx = null;
    state.planPaused = false;
    closeEditor();
    goTo("focus");
    save();
    render();
  }

  // Re-fit what's left of the plan into the time from now to its end,
  // keeping the labels in order.
  function replan() {
    const plan = state.plan;
    if (!plan) return;
    const now = Date.now();
    if (plan.end - now < MIN_PLAN_MS) {
      clearPlan();
      notice("not enough time left to replan ✿ plan cleared");
      return;
    }
    const fresh = buildPlan(now, plan.end, state.settings, "");
    carryLabels(
      plan.blocks.filter(b => b.end > now),
      fresh
    );
    // Keep finished blocks so the strip still shows the morning so far.
    plan.blocks = [...plan.blocks.filter(b => b.end <= now), ...fresh];
    relabelPlan();
    state.planIdx = null;
    state.planPaused = false;
    syncPlan({ fromLoad: true });
  }

  // Give the new focus blocks the old ones' labels, in order.
  function carryLabels(oldBlocks, fresh) {
    const old = oldBlocks.filter(b => b.kind === "focus");
    let i = 0;
    for (const b of fresh) {
      if (b.kind !== "focus") continue;
      const from = old[i++] ?? old.at(-1);
      b.label = from?.label ?? "";
      b.todoId = from?.todoId ?? null;
      if (from?.manual) b.manual = true;
    }
  }

  // Re-name the plan's upcoming focus blocks after the task list.
  function relabelPlan() {
    const plan = state.plan;
    if (!plan) return;
    const idx = blockAt(plan.blocks, Date.now());
    if (idx < 0) return;
    const cur = plan.blocks[idx];
    assignTodos(plan.blocks, idx + 1, state.todos, {
      currentId: state.todoId,
      focusMin: state.settings.focus,
      currentInBlock:
        cur.kind === "focus" &&
        state.todoId != null &&
        cur.todoId === state.todoId,
    });
  }

  // New settings mid-plan: rebuild from the start of the current block, so
  // a longer focus length stretches the block you're in, and a shorter one
  // past the time already spent ends it now. Finished blocks stay as they
  // were, and the long-break cadence carries on.
  function refitPlan() {
    const plan = state.plan;
    if (!plan) return;
    const now = Date.now();
    const idx = blockAt(plan.blocks, now);
    if (idx < 0) return;
    const cur = plan.blocks[idx];
    if (cur.kind === "wrap") {
      notice("wrapping up ✿ new lengths apply to your next plan");
      return;
    }
    const kept = plan.blocks.slice(0, idx);
    const fresh = buildPlan(cur.start, plan.end, state.settings, "", {
      focusDone: kept.filter(b => b.kind === "focus").length,
      breakFirst: cur.kind === "focus" ? null : cur.kind,
    });
    carryLabels(plan.blocks.slice(idx), fresh);
    fresh[0].id = cur.id;
    plan.blocks = [...kept, ...fresh];
    relabelPlan();

    const block = fresh[0];
    // A paused plan keeps its frozen countdown, moved by the same amount.
    if (!state.running && state.remaining != null) {
      state.remaining = Math.max(0, state.remaining + block.end - cur.end);
    }
    if (block.end > now) {
      // Still in the same block, now longer or shorter.
      state.setMs = block.end - block.start;
      if (state.running) state.endAt = block.end;
      if (state.mode === "break") state.breakKind = block.kind;
    } else if (following()) {
      // The new length is already used up: move on as if it just ended.
      syncPlan();
      return;
    }
    save();
    render();
    notice("plan updated ✿ new lengths from this block on");
  }

  // Leaving the plan (dragging the dial, switching tabs) asks first.
  function leavePlanOk() {
    if (!state.plan) return true;
    if (
      !window.confirm("Leave your plan? The planned blocks will be cleared.")
    ) {
      return false;
    }
    state.plan = null;
    state.planIdx = null;
    state.planPaused = false;
    // "wrap up" only exists inside a plan.
    if (state.mode === "break" && state.breakKind === "wrap") {
      state.breakKind = "short";
    }
    closeEditor();
    return true;
  }

  function planMessage(text) {
    const p = document.createElement("p");
    p.textContent = text;
    el.planSummary.replaceChildren(p);
    el.planGo.disabled = true;
  }

  // The end time the panel shows, or null if the field is empty.
  const planEndValue = now => nextClockTime(el.planEnd.value, now);

  function planPreview() {
    const now = Date.now();
    const end = planEndValue(now);
    // The quick buttons move the shown time; grey out any that would push
    // it outside 10 minutes to 12 hours from now.
    const base = end != null && end > now ? end : now;
    for (const quick of el.planQuick) {
      const next = base + Number(quick.dataset.planAdd) * MIN;
      quick.disabled = next - now < MIN_PLAN_MS || next - now > MAX_PLAN_MS;
    }
    if (end && end <= now) {
      planMessage("that time has already passed");
      return null;
    }
    if (!end || end - now < MIN_PLAN_MS) {
      planMessage("pick a time at least 10 minutes away");
      return null;
    }
    if (end - now > MAX_PLAN_MS) {
      planMessage("plans can be up to 12 hours");
      return null;
    }
    const total = document.createElement("p");
    total.className = "ft-plan-total";
    total.textContent = `${fmtMinutes(Math.round((end - now) / MIN))} from now`;
    const list = document.createElement("dl");
    for (const row of summarizePlan(buildPlan(now, end, state.settings))) {
      const dt = document.createElement("dt");
      dt.textContent = row.label;
      const dd = document.createElement("dd");
      dd.textContent = row.value;
      list.append(dt, dd);
    }
    el.planSummary.replaceChildren(total, list);
    el.planGo.disabled = false;
    return end;
  }

  // ---- Wedge animation ---------------------------------------------------

  function animateWedge(from, to, ms) {
    cancelSweep();
    if (prefersReducedMotion() || from === to) return;
    sweep = { from, to, ms, start: performance.now(), raf: 0 };
    const frame = now => {
      if (!sweep) return;
      const p = Math.min(1, (now - sweep.start) / sweep.ms);
      drawDial(sweep.from + (sweep.to - sweep.from) * easeOut(p));
      if (p < 1) {
        sweep.raf = requestAnimationFrame(frame);
      } else {
        sweep = null;
        lastFrameKey = "";
        renderClock();
      }
    };
    drawDial(from);
    sweep.raf = requestAnimationFrame(frame);
  }

  function cancelSweep() {
    if (!sweep) return;
    cancelAnimationFrame(sweep.raf);
    sweep = null;
    lastFrameKey = "";
  }

  // ---- Dial dragging -----------------------------------------------------

  function minutesAt(e, { guard = true } = {}) {
    const r = el.dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += Math.PI * 2;
    let m = Math.round((a / (Math.PI * 2)) * 60);
    // While dragging, don't wrap around past 0 or 60: hold at the end you
    // came from. (Not on the first press, which goes where you pressed.)
    if (guard && dragMinutes >= 45 && m <= 15) m = 60;
    else if (guard && dragMinutes <= 15 && m >= 45) m = 0;
    return m;
  }

  el.dial.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("[data-ft='hub']") || dragging) {
      return;
    }
    if (state.plan) {
      // The confirm dialog swallows this press, so don't start a drag from
      // it; once the plan is gone, the next press sets the time.
      if (leavePlanOk()) {
        save();
        render();
      }
      return;
    }
    dragging = true;
    cancelSweep();
    closePanels();
    el.dial.setPointerCapture(e.pointerId);
    el.dial.classList.add("is-dragging");
    ensureAudio();
    const m = minutesAt(e, { guard: false });
    dragMinutes = m;
    setLength(m * MIN);
    render();
  });

  el.dial.addEventListener("pointermove", e => {
    if (!dragging) return;
    const m = minutesAt(e);
    if (m === dragMinutes) return;
    dragMinutes = m;
    setLength(m * MIN);
    tickSound();
    renderClock();
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    el.dial.classList.remove("is-dragging");
    // The dialed length becomes this mode's length from now on.
    if (state.setMs > 0) state.settings[tabKey()] = dragMinutes;
    save();
    if (state.setMs > 0) tryStart();
    else render();
  };
  el.dial.addEventListener("pointerup", endDrag);
  el.dial.addEventListener("pointercancel", endDrag);

  // ---- Mode tabs ---------------------------------------------------------

  for (const tab of el.tabs) {
    tab.addEventListener("click", () => {
      const key = tab.dataset.ftMode;
      if (key === tabKey() && !inProgress()) return;
      if (state.plan) {
        if (!leavePlanOk()) return;
      } else if (
        inProgress() &&
        !window.confirm("Switch modes? The current timer will be reset.")
      ) {
        return;
      }
      const from = Math.max(0, remainingMs());
      goTo(key);
      save();
      render();
      animateWedge(from, state.setMs, SWEEP_SWITCH_MS);
    });
  }

  // ---- Tasks -------------------------------------------------------------

  // Tie the session to the open task with the same name, if there is one.
  function linkTodo() {
    state.todoId =
      openTodos(state.todos).find(t => t.text === state.task)?.id ?? null;
  }

  // The task the list marks as "now": the session's, or before one starts,
  // the one named in the task line.
  function currentTodoId() {
    if (state.mode === "focus" && !inProgress()) {
      const text = el.task.value.trim();
      return openTodos(state.todos).find(t => t.text === text)?.id ?? null;
    }
    return state.todoId;
  }

  // Point the current plan block at a task (or at nothing).
  function setCurrentBlock(todo) {
    const block = state.plan?.blocks[state.planIdx];
    if (block?.kind !== "focus") return;
    block.label = todo?.text ?? "";
    block.todoId = todo?.id ?? null;
    delete block.manual;
  }

  function selectTodo(todo) {
    if (state.mode === "focus" && inProgress()) {
      if (todo.id === state.todoId) return;
      // Mid-session: the time so far stays with the old task.
      splitSession();
      state.task = todo.text;
      state.todoId = todo.id;
      el.task.value = todo.text;
      setCurrentBlock(todo);
      notice(`now: ${todo.text}`);
    } else if (state.mode === "break") {
      state.task = todo.text;
      state.todoId = todo.id;
      notice(`next up: ${todo.text}`);
    } else {
      state.task = todo.text;
      state.todoId = todo.id;
      el.task.value = todo.text;
      closePanels();
    }
    relabelPlan();
    save();
    render();
  }

  function toggleDone(todo) {
    if (todo.doneAt) {
      todo.doneAt = null;
      relabelPlan();
      save();
      render();
      return;
    }
    const focusing = state.mode === "focus" && inProgress();
    const isCurrent = todo.id === currentTodoId();
    if (isCurrent && focusing) splitSession();
    todo.doneAt = Date.now();
    let text = `✓ ${todo.text}`;
    if (isCurrent) {
      // Move on to the next task, in the same session if one is running.
      const next = openTodos(state.todos)[0] ?? null;
      state.todoId = next?.id ?? null;
      state.task = next?.text ?? "";
      if (state.mode === "focus") el.task.value = state.task;
      if (focusing) {
        setCurrentBlock(next);
        text += next
          ? ` ✿ now: ${next.text}`
          : " ✿ list's clear: skip to a break, or name what's next";
      } else if (next) {
        text += ` ✿ next up: ${next.text}`;
      }
    }
    relabelPlan();
    save();
    render();
    notice(text);
  }

  // Drop a task's links to the session and the plan.
  function forgetTodo(todo) {
    if (state.todoId === todo.id) state.todoId = null;
    for (const b of state.plan?.blocks ?? []) {
      if (b.todoId === todo.id) b.todoId = null;
    }
  }

  function removeTodo(todo) {
    state.todos = state.todos.filter(t => t !== todo);
    forgetTodo(todo);
    relabelPlan();
    save();
    render();
  }

  function renameTodo(todo, text) {
    const before = todo.text;
    todo.text = text;
    if (state.todoId === todo.id) state.task = text;
    if (
      state.mode === "focus" &&
      (state.todoId === todo.id || el.task.value.trim() === before)
    ) {
      el.task.value = text;
    }
    for (const b of state.plan?.blocks ?? []) {
      if (b.todoId === todo.id) b.label = text;
    }
  }

  // ---- Tasks panel: a notepad of lines ----------------------------------
  //
  // Each open task is a line you can type in. Edits stay in the panel and
  // are saved when it closes (or before a checkbox, remove or "work on
  // this" acts on a line), so typing never fights a re-render.

  const tasksOpen = () => el.panels.tasks.panel.dataset.open === "true";
  const lineText = li => li.querySelector(".ft-todo-text");
  const lineEst = li => li.querySelector(".ft-todo-est input");

  function sessionsWord(spent) {
    return ["½", "1"].includes(spent) ? "session" : "sessions";
  }

  function lineRow(
    todo,
    { text = todo?.text ?? "", est = todo?.est ?? 1 } = {}
  ) {
    const li = document.createElement("li");
    li.className = "ft-todo";
    if (todo) li.dataset.id = todo.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "ft-todo-check";
    check.setAttribute("aria-label", "Done");

    const main = document.createElement("div");
    main.className = "ft-todo-main";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ft-todo-text";
    input.maxLength = 60;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = text;
    input.placeholder = "type or paste a task…";
    input.setAttribute("aria-label", "Task");
    const meta = document.createElement("small");
    meta.className = "ft-todo-meta";
    const metaText = document.createElement("span");
    const work = document.createElement("button");
    work.type = "button";
    work.className = "ft-todo-work";
    work.textContent = "work on this";
    meta.append(metaText, work);
    main.append(input, meta);

    const estWrap = document.createElement("div");
    estWrap.className = "ft-todo-est";
    const step = (d, text, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ft-todo-step";
      b.dataset.step = String(d);
      b.textContent = text;
      b.setAttribute("aria-label", label);
      return b;
    };
    const estInput = document.createElement("input");
    estInput.type = "number";
    estInput.inputMode = "numeric";
    estInput.min = "1";
    estInput.max = "20";
    estInput.value = String(est);
    estInput.setAttribute("aria-label", "Estimated sessions");
    estWrap.append(
      step(-1, "−", "Fewer sessions"),
      estInput,
      step(1, "+", "More sessions")
    );
    syncSteps(estWrap);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ft-todo-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove");

    li.append(check, main, estWrap, remove);
    markBlank(li);
    return li;
  }

  // − stops at 1 session and + at 20.
  function syncSteps(estWrap) {
    const n = clampEst(estWrap.querySelector("input").value);
    const [minus, plus] = estWrap.querySelectorAll(".ft-todo-step");
    minus.disabled = n <= 1;
    plus.disabled = n >= 20;
  }

  // A line with nothing in it yet shows only its text field.
  function markBlank(li) {
    li.classList.toggle(
      "is-blank",
      !li.dataset.id && !lineText(li).value.trim()
    );
  }

  // There's always an empty line at the end to type into.
  function ensureBlank() {
    const last = el.todoList.lastElementChild;
    if (!last || !last.classList.contains("is-blank")) {
      el.todoList.append(lineRow(null));
    }
  }

  function doneRow(todo) {
    const li = document.createElement("li");
    li.className = "ft-todo is-done";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    check.setAttribute("aria-label", `Mark ${todo.text} not done`);
    check.addEventListener("change", () => {
      commitDraft();
      toggleDone(todo);
      renderTodos(true);
    });
    const main = document.createElement("div");
    main.className = "ft-todo-main";
    const name = document.createElement("span");
    name.className = "ft-todo-name";
    name.textContent = todo.text;
    name.title = todo.text;
    const meta = document.createElement("small");
    meta.className = "ft-todo-meta";
    const spent = fmtSessions(sessionsSpent(todo, state.settings.focus));
    meta.textContent = `${fmtTime(todo.doneAt)} · ${spent} ${sessionsWord(spent)}`;
    main.append(name, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ft-todo-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${todo.text}`);
    remove.addEventListener("click", () => {
      commitDraft();
      removeTodo(todo);
      renderTodos(true);
    });
    li.append(check, main, remove);
    return li;
  }

  // Progress, "now" and labels for the saved lines, without touching what
  // you've typed.
  function updateLines() {
    const currentId = currentTodoId();
    for (const li of el.todoList.children) {
      const todo = state.todos.find(t => t.id === li.dataset.id);
      const current = todo != null && todo.id === currentId;
      li.setAttribute("aria-current", String(current));
      const [metaText, work] = li.querySelector(".ft-todo-meta").children;
      if (!todo) {
        metaText.textContent = "";
        work.hidden = true;
        continue;
      }
      const spent = fmtSessions(sessionsSpent(todo, state.settings.focus));
      metaText.textContent = `${current ? "now · " : ""}${spent} of ${todo.est}`;
      work.hidden = current;
      const name = lineText(li).value.trim() || todo.text;
      li.querySelector(".ft-todo-check").setAttribute(
        "aria-label",
        `Mark ${name} done`
      );
      li.querySelector(".ft-todo-remove").setAttribute(
        "aria-label",
        `Remove ${name}`
      );
      work.setAttribute("aria-label", `Work on ${name}`);
    }
  }

  // Save the panel's lines: new lines become tasks, edited ones are renamed
  // or re-estimated, emptied ones are removed, and the order is kept. A
  // trailing "x2" on a line sets its estimate.
  function commitDraft() {
    const byId = new Map(state.todos.map(t => [t.id, t]));
    const before = openTodos(state.todos);
    const open = [];
    let changed = false;
    for (const li of [...el.todoList.children]) {
      const parsed = parseTaskLine(lineText(li).value);
      const old = byId.get(li.dataset.id);
      if (!parsed) {
        if (old) changed = true;
        continue;
      }
      const est = clampEst(parsed.est ?? lineEst(li).value);
      let todo = old;
      if (todo && !todo.doneAt) {
        if (todo.text !== parsed.text) {
          renameTodo(todo, parsed.text);
          changed = true;
        }
        if (todo.est !== est) {
          todo.est = est;
          changed = true;
        }
      } else {
        todo = { ...makeTodo(parsed.text), est };
        li.dataset.id = todo.id;
        changed = true;
      }
      open.push(todo);
      lineText(li).value = todo.text;
      lineEst(li).value = String(todo.est);
      markBlank(li);
    }
    const dropped = before.filter(t => !open.includes(t));
    for (const t of dropped) forgetTodo(t);
    if (
      !changed &&
      !dropped.length &&
      open.map(t => t.id).join() === before.map(t => t.id).join()
    ) {
      return;
    }
    state.todos = [...open, ...state.todos.filter(t => t.doneAt)];
    relabelPlan();
    save();
    render();
  }

  // Save the lines, then act on the task this line now stands for.
  function lineAction(li, fn) {
    commitDraft();
    const todo = state.todos.find(t => t.id === li.dataset.id);
    if (todo) fn(todo);
    if (tasksOpen()) renderTodos(true);
  }

  function focusLine(li, at = "end") {
    const input = lineText(li);
    input.focus({ preventScroll: false });
    const pos = at === "end" ? input.value.length : 0;
    input.setSelectionRange(pos, pos);
  }

  el.todoList.addEventListener("input", e => {
    const li = e.target.closest(".ft-todo");
    if (!li) return;
    if (e.target.closest(".ft-todo-est")) {
      syncSteps(e.target.closest(".ft-todo-est"));
      return;
    }
    if (!e.target.classList.contains("ft-todo-text")) return;
    markBlank(li);
    ensureBlank();
  });

  el.todoList.addEventListener("keydown", e => {
    const input = e.target;
    if (!input.classList?.contains("ft-todo-text")) return;
    const li = input.closest(".ft-todo");
    if (e.key === "Enter") {
      e.preventDefault();
      if (!input.value.trim()) return;
      // Like a notepad: Enter breaks the line at the caret.
      const pos = input.selectionStart ?? input.value.length;
      const after = input.value.slice(input.selectionEnd ?? pos);
      input.value = input.value.slice(0, pos);
      markBlank(li);
      const next = li.nextElementSibling;
      if (!after && next && !lineText(next).value) {
        focusLine(next, "start");
        return;
      }
      const row = lineRow(null, { text: after });
      li.after(row);
      ensureBlank();
      focusLine(row, "start");
    } else if (e.key === "Backspace" && !input.value) {
      const prev = li.previousElementSibling;
      if (!prev) return;
      e.preventDefault();
      // The trailing empty line stays; any other empty line goes.
      if (li.nextElementSibling) li.remove();
      focusLine(prev);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const to =
        e.key === "ArrowUp" ? li.previousElementSibling : li.nextElementSibling;
      if (!to) return;
      e.preventDefault();
      focusLine(to);
    }
  });

  // Pasting several lines makes a line for each.
  el.todoList.addEventListener("paste", e => {
    const input = e.target;
    if (!input.classList?.contains("ft-todo-text")) return;
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text.trim().includes("\n")) return;
    e.preventDefault();
    const items = parseTaskLines(text);
    if (!items.length) return;
    const li = input.closest(".ft-todo");
    const pos = input.selectionStart ?? input.value.length;
    const head = input.value.slice(0, pos);
    const tail = input.value.slice(input.selectionEnd ?? pos);
    const [first, ...rest] = items;
    input.value = `${head}${first.text}${tail}`.slice(0, 60);
    if (!head.trim() && !tail.trim() && first.est) {
      lineEst(li).value = String(first.est);
    }
    markBlank(li);
    let prev = li;
    for (const item of rest) {
      const row = lineRow(null, { text: item.text, est: item.est ?? 1 });
      prev.after(row);
      prev = row;
    }
    ensureBlank();
    focusLine(prev);
  });

  el.todoList.addEventListener("change", e => {
    if (!e.target.classList?.contains("ft-todo-check")) return;
    const li = e.target.closest(".ft-todo");
    lineAction(li, toggleDone);
  });

  el.todoList.addEventListener("click", e => {
    const btn = e.target.closest?.("button");
    if (!btn) return;
    const li = btn.closest(".ft-todo");
    if (btn.classList.contains("ft-todo-step")) {
      // Like typing the number: saved with the rest when the panel closes.
      const input = lineEst(li);
      input.value = String(
        clampEst(Number(input.value) + Number(btn.dataset.step))
      );
      syncSteps(btn.parentElement);
    } else if (btn.classList.contains("ft-todo-remove")) {
      if (li.dataset.id) {
        lineAction(li, removeTodo);
      } else {
        const next = li.nextElementSibling;
        li.remove();
        if (next) focusLine(next);
      }
    } else if (btn.classList.contains("ft-todo-work")) {
      lineAction(li, selectTodo);
    }
  });

  // Don't lose lines typed in an open panel when the page goes away.
  window.addEventListener("pagehide", () => {
    if (tasksOpen()) commitDraft();
  });

  function renderTodos(force = false) {
    const today = dayKey(Date.now());
    const doneToday = state.todos
      .filter(t => t.doneAt && dayKey(t.doneAt) === today)
      .sort((a, b) => a.doneAt - b.doneAt);
    el.todoDone.replaceChildren(...doneToday.map(doneRow));
    el.todoDoneWrap.hidden = doneToday.length === 0;
    renderNotes();
    // While the panel is open the lines are yours: only refresh their notes.
    if (tasksOpen() && !force) {
      updateLines();
      return;
    }
    const active = document.activeElement;
    const activeLi = el.todoList.contains(active)
      ? active.closest(".ft-todo")
      : null;
    const keep = activeLi && {
      id: activeLi.dataset.id,
      index: [...el.todoList.children].indexOf(activeLi),
      cls: active.className,
    };
    el.todoList.replaceChildren(...openTodos(state.todos).map(t => lineRow(t)));
    ensureBlank();
    updateLines();
    if (keep) {
      const rows = [...el.todoList.children];
      const li =
        rows.find(r => keep.id && r.dataset.id === keep.id) ??
        rows[Math.min(keep.index, rows.length - 1)];
      const target =
        (keep.cls && li?.querySelector(`.${keep.cls.split(" ")[0]}`)) ??
        lineText(li);
      target?.focus({ preventScroll: true });
    }
  }

  // ---- Breaks and notes --------------------------------------------------

  // The same prompt for the whole of a break, a different one next time.
  function breakPrompt() {
    const list = BREAK_PROMPTS[state.breakKind === "long" ? "long" : "short"];
    const seed = Math.floor((state.startedAt ?? state.log.length) / 1000);
    return list[seed % list.length];
  }

  const unseenNotes = () =>
    state.notes.filter(n => n.at > state.notesSeenAt).length;

  // Jot a stray thought down without leaving what you're doing: a small
  // notepad that floats from the note button (above it beside the plan's
  // timeline, below it under the task line), so nothing on the page moves.
  // Enter keeps the note, Shift+Enter starts a new line, Escape drops it,
  // and clicking away keeps it. Notes wait in the tasks panel, where each
  // can become a task.
  let noteOpen = false;
  const noteWrap = document.createElement("span");
  noteWrap.className = "ft-note-wrap";

  const noteBtn = document.createElement("button");
  noteBtn.type = "button";
  noteBtn.className = "ft-skip ft-note-btn";
  noteBtn.textContent = "✎ note";
  noteBtn.title = "Jot down a stray thought (n)";
  noteBtn.setAttribute("aria-expanded", "false");
  noteBtn.addEventListener("click", () => (noteOpen ? saveNote() : openNote()));

  const notePop = document.createElement("div");
  notePop.className = "ft-note-pop";
  notePop.setAttribute("role", "dialog");
  notePop.setAttribute("aria-label", "Quick note");
  notePop.dataset.open = "false";
  notePop.inert = true;
  const noteInput = document.createElement("textarea");
  noteInput.className = "ft-note-input";
  noteInput.maxLength = NOTE_MAX;
  noteInput.rows = 3;
  noteInput.placeholder = "a stray thought…";
  noteInput.setAttribute("aria-label", "Quick note");
  const noteFoot = document.createElement("div");
  noteFoot.className = "ft-note-foot";
  const noteKeep = document.createElement("button");
  noteKeep.type = "button";
  noteKeep.textContent = "keep";
  noteKeep.addEventListener("click", () => saveNote());
  noteFoot.append(noteKeep);
  notePop.append(noteInput, noteFoot);
  noteWrap.append(noteBtn, notePop);

  function openNote() {
    closePanels();
    noteOpen = true;
    noteInput.value = "";
    // Below the button when there's room for it, otherwise above.
    if (!state.plan) {
      const below = window.innerHeight - noteBtn.getBoundingClientRect().bottom;
      noteWrap.dataset.dir = below > notePop.offsetHeight + 24 ? "down" : "up";
    }
    notePop.dataset.open = "true";
    notePop.inert = false;
    noteBtn.setAttribute("aria-expanded", "true");
    noteInput.focus({ preventScroll: true });
  }

  function closeNote() {
    if (!noteOpen) return;
    noteOpen = false;
    notePop.dataset.open = "false";
    notePop.inert = true;
    noteBtn.setAttribute("aria-expanded", "false");
  }

  function saveNote() {
    // Line breaks stay; runs of spaces and blank lines go.
    const text = noteInput.value
      .split("\n")
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    closeNote();
    if (!text) return;
    state.notes.push({
      id: `n${Date.now().toString(36)}`,
      text,
      at: Date.now(),
    });
    save();
    render();
    notice("noted ✿ it'll wait in tasks");
  }

  noteInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNote();
      noteBtn.focus();
    }
  });

  function removeNote(note) {
    state.notes = state.notes.filter(n => n !== note);
    save();
    renderTodos(true);
  }

  function noteToTask(note) {
    commitDraft();
    // A note of several lines becomes a task per line.
    const added = parseTaskLines(note.text).map(t => ({
      ...makeTodo(t.text),
      est: t.est ?? 1,
    }));
    state.todos.splice(openTodos(state.todos).length, 0, ...added);
    state.notes = state.notes.filter(n => n !== note);
    relabelPlan();
    save();
    render();
    renderTodos(true);
  }

  function renderNotes() {
    el.notesWrap.hidden = state.notes.length === 0;
    el.notes.replaceChildren(
      ...state.notes.map(note => {
        const li = document.createElement("li");
        li.className = "ft-note";
        const text = document.createElement("p");
        text.textContent = note.text;
        const meta = document.createElement("small");
        meta.textContent = fmtTime(note.at);
        const toTask = document.createElement("button");
        toTask.type = "button";
        toTask.className = "ft-note-task";
        toTask.textContent = "→ task";
        toTask.setAttribute("aria-label", `Add "${note.text}" to tasks`);
        toTask.addEventListener("click", () => noteToTask(note));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ft-todo-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Delete note "${note.text}"`);
        remove.addEventListener("click", () => removeNote(note));
        const body = document.createElement("div");
        body.append(text, meta);
        li.append(body, toTask, remove);
        return li;
      })
    );
  }

  // ---- Skip --------------------------------------------------------------

  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "ft-skip";
  skipBtn.addEventListener("click", skip);

  function skipLabel() {
    const cur = state.plan?.blocks[blockAt(state.plan.blocks, Date.now())];
    const kind = cur?.kind ?? (state.mode === "focus" ? "focus" : "break");
    if (kind === "wrap") return ["end plan", "End the plan now"];
    return kind === "focus"
      ? ["skip", "Skip to your break"]
      : ["skip", "Skip the rest of this break"];
  }

  // Jump to the next block now: cut a break short, or take the break early.
  // Undo puts everything back as it was.
  function skip() {
    const snapshot = JSON.stringify(state);
    const undo = { label: "undo", run: () => restore(snapshot) };
    cancelSweep();
    closeEditor();
    if (state.plan) {
      skipPlanBlock(undo);
      return;
    }
    complete({ quiet: true, early: true });
    tryStart();
    notice(phaseNotice(tabKey(), state.task), undo);
  }

  function skipPlanBlock(undo) {
    const plan = state.plan;
    const now = Date.now();
    const idx = blockAt(plan.blocks, now);
    if (idx < 0) return;
    const cur = plan.blocks[idx];
    if (cur.kind === "wrap" || plan.end - now < MIN) {
      clearPlan();
      notice("plan finished early ✿ nice work", undo);
      return;
    }
    // The block ends now; the rest of the plan is rebuilt from here.
    // A block skipped in its first minute leaves nothing behind (too
    // short to log, and only a sliver on the timeline).
    const keepCut = now - cur.start >= MIN;
    const kept = plan.blocks.slice(0, idx);
    if (keepCut) kept.push({ ...cur, end: now });
    const focusDone =
      plan.blocks.slice(0, idx).filter(b => b.kind === "focus").length +
      (cur.kind === "focus" ? 1 : 0);
    const fresh = buildPlan(now, plan.end, state.settings, "", {
      focusDone,
      breakFirst:
        cur.kind === "focus"
          ? focusDone % state.settings.every === 0
            ? "long"
            : "short"
          : null,
    });
    carryLabels(plan.blocks.slice(idx + 1), fresh);
    plan.blocks = [...kept, ...fresh];
    state.planIdx = keepCut ? idx : null;
    state.planPaused = false;
    // Logs the cut-short focus block and moves on to the next one.
    syncPlan({ fromLoad: true });
    relabelPlan();
    const block = state.plan?.blocks[state.planIdx];
    if (block?.kind === "focus") {
      state.task = block.label;
      state.todoId = block.todoId ?? null;
      el.task.value = block.label;
    }
    save();
    render();
    if (block) {
      notice(phaseNotice(block.kind, block.label), undo);
      animateWedge(0, block.end - now, SWEEP_PHASE_MS);
    }
  }

  function restore(snapshot) {
    cancelSweep();
    Object.assign(state, JSON.parse(snapshot));
    el.task.value = state.mode === "focus" ? state.task : "";
    if (state.running || state.plan) startTicking();
    else stopTicking();
    save();
    render();
  }

  // ---- Panels (settings, plan) -------------------------------------------

  function openPanel(name) {
    closePanels();
    const { btn, panel } = el.panels[name];
    // Grow out of the pill that opened it. offsetLeft is the panel's layout
    // position, unaffected by its closed-state scale.
    const b = btn.getBoundingClientRect();
    const panelLeft = root.getBoundingClientRect().left + panel.offsetLeft;
    // A pill in the bottom half (the fruit button on phones) opens upward.
    const fromBelow = b.top > window.innerHeight / 2;
    panel.style.transformOrigin = `${Math.round(b.left + b.width / 2 - panelLeft)}px ${fromBelow ? "100%" : "0"}`;
    panel.dataset.open = "true";
    panel.inert = false;
    btn.setAttribute("aria-expanded", "true");
    if (name === "plan") {
      if (!el.planEnd.value) {
        // Default: an hour from now, rounded up to a half hour.
        const d = new Date(Date.now() + 60 * MIN);
        const m = d.getMinutes();
        if (m > 0) d.setMinutes(m <= 30 ? 30 : 60);
        d.setSeconds(0, 0);
        el.planEnd.value = toTimeValue(d.getTime());
      }
      planPreview();
      el.planClear.hidden = !state.plan;
      el.planEnd.focus({ preventScroll: true });
    } else if (name === "tasks") {
      state.notesSeenAt = Date.now();
      save();
      render();
      renderTodos(true);
      focusLine(el.todoList.lastElementChild);
    } else if (name === "fruit") {
      const current = el.fruits.find(b => b.dataset.ftFruit === state.fruit);
      current?.focus({ preventScroll: true });
    } else {
      el.fields[0]?.focus({ preventScroll: true });
    }
  }

  function closePanels({ returnFocus = false } = {}) {
    // Lines typed in the tasks panel are saved as it closes.
    if (tasksOpen()) commitDraft();
    for (const { btn, panel } of Object.values(el.panels)) {
      if (panel.dataset.open !== "true") continue;
      panel.dataset.open = "false";
      panel.inert = true;
      btn.setAttribute("aria-expanded", "false");
      if (returnFocus) btn.focus();
    }
  }

  for (const [name, { btn, panel }] of Object.entries(el.panels)) {
    btn.addEventListener("click", () => {
      if (panel.dataset.open === "true") closePanels();
      else openPanel(name);
    });
    panel.addEventListener("keydown", e => {
      if (e.key === "Escape") closePanels({ returnFocus: true });
    });
  }

  function onOutside(e) {
    if (noteOpen && !noteWrap.contains(e.target)) saveNote();
    for (const { btn, panel } of Object.values(el.panels)) {
      if (
        panel.dataset.open === "true" &&
        !panel.contains(e.target) &&
        !btn.contains(e.target)
      ) {
        closePanels();
      }
    }
    if (
      editingId &&
      !el.editor.contains(e.target) &&
      !e.target.closest(".ft-block")
    ) {
      commitLabel();
    }
  }
  document.addEventListener("pointerdown", onOutside);

  // Settings fields
  for (const field of el.fields) {
    field.addEventListener("change", () => {
      const key = field.dataset.ftSet;
      state.settings[key] = clampSetting(key, field.value);
      field.value = String(state.settings[key]);
      if (state.plan) {
        // Re-fit the plan around the new lengths.
        refitPlan();
      } else if (key === tabKey() && !inProgress()) {
        // A new length applies right away if that mode is loaded and idle.
        const from = state.remaining;
        setLength(lengthFor(key));
        animateWedge(Math.min(from, DIAL_MS), state.setMs, SWEEP_SWITCH_MS);
      }
      save();
      render();
    });
    field.addEventListener("keydown", e => {
      if (e.key === "Enter") field.blur();
    });
  }

  // Plan panel
  el.planEnd.addEventListener("input", planPreview);
  for (const quick of el.planQuick) {
    quick.addEventListener("click", () => {
      // Move the time shown (or now, if it's empty or already passed).
      const now = Date.now();
      const end = planEndValue(now);
      const base = end != null && end > now ? end : now;
      el.planEnd.value = toTimeValue(
        base + Number(quick.dataset.planAdd) * MIN
      );
      planPreview();
    });
  }
  el.planGo.addEventListener("click", () => {
    const end = planPreview();
    if (!end) return;
    if (
      !state.plan &&
      inProgress() &&
      !window.confirm("Start a plan? The current timer will be replaced.")
    ) {
      return;
    }
    startPlan(end);
  });
  el.planEnd.addEventListener("keydown", e => {
    if (e.key === "Enter" && !el.planGo.disabled) el.planGo.click();
  });
  el.planClear.addEventListener("click", () => {
    closePanels();
    clearPlan();
  });
  el.replan.addEventListener("click", replan);

  // Fresh start: back to an idle focus timer with an empty cycle.
  function freshStart() {
    cancelSweep();
    state.done = 0;
    state.task = "";
    state.plan = null;
    state.planIdx = null;
    state.planPaused = false;
    el.task.value = "";
    const from = Math.max(0, remainingMs());
    goTo("focus");
    save();
    render();
    animateWedge(Math.min(from, DIAL_MS), state.setMs, SWEEP_SWITCH_MS);
  }

  el.resetToday.addEventListener("click", () => {
    if (
      !window.confirm(
        "Reset today? This clears today's sessions, any plan, the cycle and the timer. Settings stay."
      )
    ) {
      return;
    }
    const today = dayKey(Date.now());
    state.log = state.log.filter(s => dayKey(s.end) !== today);
    freshStart();
  });

  el.clearHistory.addEventListener("click", () => {
    if (
      !window.confirm(
        "Clear all history? This deletes every saved session and resets the timer. Settings stay."
      )
    ) {
      return;
    }
    state.log = [];
    freshStart();
  });

  // ---- Block labels ------------------------------------------------------

  function openEditor(block) {
    if (editingId && editingId !== block.id) commitLabel();
    editingId = block.id;
    el.editorTime.textContent = `${fmtTime(block.start)} – ${fmtTime(block.end)}`;
    el.editorInput.value = block.label;
    el.editor.hidden = false;
    const mid =
      ((block.start + block.end) / 2 - state.plan.start) /
      (state.plan.end - state.plan.start);
    el.editor.style.setProperty("--x", `${(mid * 100).toFixed(2)}%`);
    el.editorInput.focus();
    el.editorInput.select();
  }

  function closeEditor() {
    editingId = null;
    el.editor.hidden = true;
  }

  function commitLabel() {
    if (!editingId || !state.plan) return closeEditor();
    const block = state.plan.blocks.find(b => b.id === editingId);
    if (block) {
      block.label = el.editorInput.value.trim();
      const todo = openTodos(state.todos).find(t => t.text === block.label);
      block.todoId = todo?.id ?? null;
      // Named by hand: the task list leaves it alone from now on.
      block.manual = true;
      const idx = state.plan.blocks.indexOf(block);
      if (idx === state.planIdx) {
        state.task = block.label;
        state.todoId = block.todoId;
        el.task.value = block.label;
      }
    }
    closeEditor();
    save();
    render();
  }

  el.editorInput.addEventListener("keydown", e => {
    if (e.key === "Enter") commitLabel();
    else if (e.key === "Escape") closeEditor();
  });
  // Tabbing or clicking away keeps what was typed.
  el.editorInput.addEventListener("blur", () => {
    if (editingId) commitLabel();
  });

  // ---- Other events ------------------------------------------------------

  el.hub.addEventListener("click", toggle);

  // Press feedback (a small scale) is set on pointer presses only, so
  // keyboard activation stays instant.
  const PRESSABLE =
    "[data-ft='hub'], .ft-recent .ft-chip, .ft-plan-quick button, .ft-plan-go, .ft-fruit-grid button";
  root.addEventListener("pointerdown", e => {
    const target = e.target.closest(PRESSABLE);
    if (target) target.dataset.pressed = "";
  });
  const release = () => {
    for (const node of root.querySelectorAll("[data-pressed]")) {
      delete node.dataset.pressed;
    }
  };
  for (const type of ["pointerup", "pointercancel"]) {
    document.addEventListener(type, release);
  }
  root.addEventListener("pointerout", e => {
    const target = e.target.closest?.("[data-pressed]");
    if (target && !target.contains(e.relatedTarget)) {
      delete target.dataset.pressed;
    }
  });

  el.mini.hidden = !miniSupported();
  el.mini.addEventListener("click", async () => {
    if (mini.isOpen()) {
      await mini.close();
      return;
    }
    try {
      await mini.open(miniView());
    } catch {
      notice("couldn't open the mini timer in this browser");
    }
    render();
  });

  for (const btn of el.fruits) {
    btn.addEventListener("click", () => {
      state.fruit = btn.dataset.ftFruit;
      save();
      render();
      mini.update(miniView());
    });
  }

  el.sound.addEventListener("click", () => {
    state.sound = !state.sound;
    if (state.sound) ensureAudio();
    save();
    render();
  });

  el.notify.addEventListener("change", async () => {
    if (!el.notify.checked) {
      state.notify = false;
    } else if (!("Notification" in window)) {
      state.notify = false;
      notice("this browser doesn't support notifications");
    } else {
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      state.notify = permission === "granted";
      if (!state.notify) {
        notice("notifications are blocked for this site in your browser");
      }
    }
    save();
    render();
  });

  el.task.addEventListener("input", () => {
    renderRecent();
    if (!inProgress()) renderTodos();
    mini.update(miniView());
  });
  // Renaming mid-session: the task line stays editable while a focus
  // session runs or is paused. The new name is saved on Enter or when you
  // click away, and in a plan it renames the current block too.
  const renaming = () => state.mode === "focus" && inProgress();

  function commitTask() {
    const name = el.task.value.trim();
    if (!name || name === state.task) {
      // An empty name mid-session isn't allowed; keep the old one.
      el.task.value = state.task;
      return;
    }
    state.task = name;
    el.task.value = name;
    linkTodo();
    const block = state.plan?.blocks[state.planIdx];
    if (block?.kind === "focus") {
      block.label = name;
      block.todoId = state.todoId;
      block.manual = !state.todoId;
    }
    relabelPlan();
    save();
    render();
  }

  el.task.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (renaming())
        el.task.blur(); // saves via the blur handler
      else tryStart();
    } else if (e.key === "Escape" && renaming()) {
      el.task.value = state.task;
      el.task.blur();
    }
  });
  el.task.addEventListener("blur", () => {
    if (renaming()) commitTask();
  });

  const onKey = e => {
    if (e.repeat || !root.isConnected) return;
    const target = e.target;
    const typing =
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable]");
    // "n" jots a note from anywhere on the page but a text field.
    if (e.key === "n" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openNote();
      return;
    }
    if (e.code !== "Space") return;
    if (typing || target.closest?.("button")) return;
    e.preventDefault();
    toggle();
  };
  document.addEventListener("keydown", onKey);

  document.addEventListener(
    "astro:before-swap",
    () => {
      stopTicking();
      cancelSweep();
      clearTimeout(shiftTimer);
      clearTimeout(toastTimer);
      mini.close();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      document.title = pageTitle;
    },
    { once: true }
  );

  // ---- Rendering ---------------------------------------------------------

  function drawDial(ms) {
    el.wedge.setAttribute("d", wedgePath(ms / DIAL_MS));
    const deg = (Math.min(ms, DIAL_MS) / DIAL_MS) * 360;
    el.hand.setAttribute("transform", `rotate(${deg.toFixed(2)})`);
  }

  function setGlow(shift) {
    const left = Math.max(0, remainingMs());
    const frac = state.setMs > 0 ? left / state.setMs : 0;
    const value = state.running ? 0.2 + 0.8 * frac : 0.6;
    const active = state.mode === "break" ? "break" : "focus";
    for (const [mode, layer] of Object.entries(el.glow)) {
      if (shift) layer.classList.add("is-shifting");
      layer.style.opacity = mode === active ? value.toFixed(3) : "0";
    }
    if (shift) {
      clearTimeout(shiftTimer);
      shiftTimer = setTimeout(() => {
        for (const layer of Object.values(el.glow)) {
          layer.classList.remove("is-shifting");
        }
      }, 320);
    }
  }

  // Ticks run 5x a second to catch the end promptly, but the dial and text
  // only change when the displayed second does.
  function renderClock() {
    const left = Math.max(0, remainingMs());
    const secs = Math.ceil(left / 1000);
    const key = `${secs}|${state.mode}|${state.running}`;
    if (key === lastFrameKey) return;
    lastFrameKey = key;
    const clock = fmtClock(left);
    el.time.textContent = clock;
    if (!sweep) drawDial(left);
    setGlow(false);
    renderStripNow();
    mini.update(miniView());
    document.title = state.running
      ? `${clock} · ${state.mode === "focus" ? state.task || "focus" : KIND_NAME[state.breakKind]}`
      : pageTitle;
  }

  function renderStrip() {
    const plan = state.plan;
    root.classList.toggle("has-plan", Boolean(plan));
    el.strip.hidden = !plan;
    if (!plan) {
      stripKey = "";
      closeEditor();
      return;
    }
    el.replan.hidden = !state.planPaused;
    // Keep the existing block nodes unless the blocks themselves changed:
    // the past/current fades can play, and a click that lands while a label
    // is being saved still finds its block.
    const key = `${plan.start}|${plan.end}|${plan.blocks.map(b => b.id).join(",")}`;
    if (key === stripKey) {
      for (const node of el.track.querySelectorAll(".ft-block-focus")) {
        const b = plan.blocks.find(x => x.id === node.dataset.id);
        if (b) labelBlock(node, b);
      }
      renderStripNow(true);
      return;
    }
    stripKey = key;
    const span = plan.end - plan.start;
    el.stripStart.textContent = fmtTime(plan.start);
    el.stripEnd.textContent = fmtTime(plan.end);
    const blocks = plan.blocks.map(b => {
      const node = document.createElement(
        b.kind === "focus" ? "button" : "div"
      );
      node.className = `ft-block ft-block-${b.kind}`;
      node.dataset.id = b.id;
      node.style.left = `${(((b.start - plan.start) / span) * 100).toFixed(3)}%`;
      node.style.width = `${(((b.end - b.start) / span) * 100).toFixed(3)}%`;
      if (b.kind === "focus") {
        node.type = "button";
        labelBlock(node, b);
        node.addEventListener("click", () => openEditor(b));
      } else {
        node.title = `${fmtTime(b.start)} – ${fmtTime(b.end)} · ${KIND_NAME[b.kind]}`;
        node.setAttribute("aria-hidden", "true");
      }
      return node;
    });
    el.track.replaceChildren(...blocks, el.now);
    renderStripNow(true);
  }

  function labelBlock(node, b) {
    const when = `${fmtTime(b.start)} – ${fmtTime(b.end)}`;
    // The label is a child so a block too narrow for it can hide it.
    let text = node.firstElementChild;
    if (!text) {
      text = document.createElement("span");
      node.append(text);
    }
    if (text.textContent !== b.label) text.textContent = b.label;
    node.title = `${when} · ${b.label || "focus"} · click to label`;
    node.setAttribute(
      "aria-label",
      `${when}, ${b.label || "unlabeled focus block"}. Edit label`
    );
  }

  // Per-second strip update: the now marker and which block is current.
  function renderStripNow(force = false) {
    const plan = state.plan;
    if (!plan) return;
    const now = Date.now();
    // At most once a second: one second is a fraction of a pixel here.
    const second = Math.floor(now / 1000);
    if (!force && second === stripSecond) return;
    stripSecond = second;
    const p = Math.min(
      1,
      Math.max(0, (now - plan.start) / (plan.end - plan.start))
    );
    el.now.style.transform = `translateX(${(p * 100).toFixed(3)}%)`;
    for (const node of el.track.querySelectorAll(".ft-block")) {
      const b = plan.blocks.find(x => x.id === node.dataset.id);
      if (!b) continue;
      node.classList.toggle("is-past", b.end <= now);
      node.classList.toggle("is-current", b.start <= now && now < b.end);
    }
  }

  function renderToday() {
    const today = dayKey(Date.now());
    const sessions = state.log.filter(s => dayKey(s.end) === today);
    el.todayWrap.hidden = sessions.length === 0;
    el.dots.replaceChildren(
      ...sessions
        .filter(s => !s.part)
        .map(s => {
          const dot = document.createElement("i");
          dot.title = `${s.task} · ${s.minutes} min · ${fmtTime(s.start)}`;
          return dot;
        })
    );
    const minutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
    el.total.textContent = sessions.length
      ? `today · ${fmtMinutes(minutes)}`
      : "";
    el.todayWrap.setAttribute(
      "aria-label",
      `Today: ${sessions.filter(s => !s.part).length} focus sessions, ${minutes} minutes`
    );
    renderRecent();
  }

  // Up to three recent tasks as chips, only while the task line is empty
  // and ready to be filled in.
  function renderRecent() {
    const show =
      state.mode === "focus" &&
      !inProgress() &&
      !state.plan &&
      !el.task.value.trim();
    // The next tasks on the list, or without a list, recent ones.
    const open = openTodos(state.todos).map(t => t.text);
    const recent = !show
      ? []
      : open.length
        ? open.slice(0, 3)
        : [...new Set(state.log.map(s => s.task).reverse())]
            .filter(task => task !== "untitled")
            .slice(0, 3);
    el.recent.setAttribute(
      "aria-label",
      open.length ? "Tasks" : "Recent tasks"
    );
    for (const chip of el.recent.querySelectorAll(".ft-chip")) chip.remove();
    el.recent.prepend(
      ...recent.map(task => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ft-chip";
        chip.textContent = task;
        chip.title = task;
        chip.addEventListener("click", () => {
          el.task.value = task;
          el.task.focus();
          renderRecent();
          renderTodos();
        });
        return chip;
      })
    );

    // During a plan, skip and note sit at the end of the timeline;
    // otherwise under the task line. They're only moved when that changes,
    // so an open notepad keeps its focus.
    const box = state.plan ? el.stripActions : el.recent;
    if (noteWrap.parentElement !== box) box.append(noteWrap);
    noteWrap.dataset.align = state.plan ? "end" : "center";
    if (state.plan) noteWrap.dataset.dir = "up";
    if (inProgress() || state.plan) {
      const [label, title] = skipLabel();
      skipBtn.textContent = label;
      skipBtn.title = title;
      if (skipBtn.nextElementSibling !== noteWrap) {
        box.insertBefore(skipBtn, noteWrap);
      }
    } else {
      skipBtn.remove();
    }
  }

  function render() {
    const paused = !state.running && inProgress();
    root.dataset.mode = state.mode;
    root.dataset.fruit = state.fruit;
    for (const btn of el.fruits) {
      btn.setAttribute(
        "aria-pressed",
        String(btn.dataset.ftFruit === state.fruit)
      );
    }
    el.fruitBtn.setAttribute("aria-label", `Fruit: ${state.fruit}`);
    if (el.fruitIcon.dataset.fruit !== state.fruit) {
      el.fruitIcon.dataset.fruit = state.fruit;
      el.fruitIcon.innerHTML = fruitIcon(state.fruit);
    }
    root.dataset.state = state.running ? "running" : paused ? "paused" : "idle";

    const active = tabKey();
    for (const tab of el.tabs) {
      tab.setAttribute("aria-pressed", String(tab.dataset.ftMode === active));
    }

    // One dot per focus session in the current cycle, filled when done.
    const every = state.settings.every;
    const inCycle = state.done % every;
    const filled =
      state.mode === "break" && state.breakKind === "long" ? every : inCycle;
    el.cycle.replaceChildren(
      ...Array.from({ length: every }, (_, i) => {
        const dot = document.createElement("i");
        if (i < filled) dot.className = "is-done";
        return dot;
      })
    );
    el.cycle.setAttribute(
      "aria-label",
      `${filled} of ${every} focus sessions before a long break`
    );

    el.hub.setAttribute("aria-label", state.running ? "Pause" : "Start");
    el.mini.textContent = mini.isOpen() ? "close mini" : "pop out";
    el.mini.setAttribute("aria-pressed", String(mini.isOpen()));
    el.sound.textContent = `sound: ${state.sound ? "on" : "off"}`;
    el.sound.setAttribute("aria-pressed", String(state.sound));
    el.notify.checked = state.notify;

    for (const field of el.fields) {
      if (document.activeElement !== field) {
        field.value = String(state.settings[field.dataset.ftSet]);
      }
    }

    // Mid-session the line shows the session's name, unless you're in the
    // middle of renaming it.
    if (
      state.mode === "focus" &&
      inProgress() &&
      document.activeElement !== el.task
    ) {
      el.task.value = state.task;
    }
    el.task.placeholder =
      state.mode === "break"
        ? state.breakKind === "wrap"
          ? "wrap up"
          : breakPrompt()
        : "what are you working on?";
    el.panels.tasks.btn.toggleAttribute("data-badge", unseenNotes() > 0);

    renderStrip();
    lastFrameKey = "";
    renderClock();
    setGlow(true);
    renderToday();
    renderTodos();
  }

  // ---- Start up ----------------------------------------------------------

  for (const { panel } of Object.values(el.panels)) panel.inert = true;

  if (state.plan && Date.now() >= state.plan.end) {
    // The plan ended while the page was closed: wrap it up quietly.
    syncPlan({ fromLoad: true, resume: state.planPaused });
  } else if (following()) {
    syncPlan({ fromLoad: true });
  } else if (state.running && remainingMs() <= 0) {
    // A session that ended while the page was closed is logged quietly.
    complete({ quiet: true });
  }
  if (state.running || state.plan) startTicking();
  render();

  // On a desktop, put the caret in an empty task line so it's clearly the
  // place to type. On touch screens this would pop the keyboard, so wait.
  if (state.mode === "focus" && !inProgress()) el.task.value = state.task;
  if (
    state.mode === "focus" &&
    !inProgress() &&
    !state.plan &&
    !el.task.value &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ) {
    el.task.focus({ preventScroll: true });
  }
}
