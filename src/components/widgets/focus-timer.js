// Logic for <FocusTimer />. Everything is looked up inside `root`, and all
// state lives in localStorage under one key, so nothing leaves the browser.
//
// The countdown is driven by a wall-clock end time (not by counting ticks), so
// it stays accurate in background tabs and survives a page reload. A plan is
// a list of blocks pinned to clock times; while following one, the timer
// counts down to the current block's planned end.

import { blockAt, buildPlan, describePlan } from "./focus-plan.js";
import { createMini, miniSupported } from "./focus-mini.js";
import { DIAL_MS, FRUITS, MIN, fmtClock, modeColors } from "./focus-shared.js";

const STORAGE_KEY = "lab-focus-timer-v2";
const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4 };
const LIMITS = {
  focus: [1, 180],
  short: [1, 60],
  long: [1, 90],
  every: [2, 12],
};
const HISTORY_DAYS = 30;
const WEDGE_R = 132;
const SWEEP_PHASE_MS = 600; // a session ending: rare, can take its time
const SWEEP_SWITCH_MS = 260; // clicking a mode tab: a UI response
const TOAST_MS = 5000;
const MIN_PLAN_MS = 10 * MIN;
const MAX_PLAN_MS = 12 * 60 * MIN;
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

function wedgePath(ms) {
  const frac = Math.min(1, Math.max(0, ms / DIAL_MS));
  if (frac <= 0) return "";
  if (frac >= 0.9999) {
    return `M0,${-WEDGE_R}A${WEDGE_R},${WEDGE_R} 0 1 1 0,${WEDGE_R}A${WEDGE_R},${WEDGE_R} 0 1 1 0,${-WEDGE_R}Z`;
  }
  const a = frac * Math.PI * 2;
  const x = (WEDGE_R * Math.sin(a)).toFixed(2);
  const y = (-WEDGE_R * Math.cos(a)).toFixed(2);
  return `M0,0L0,${-WEDGE_R}A${WEDGE_R},${WEDGE_R} 0 ${a > Math.PI ? 1 : 0} 1 ${x},${y}Z`;
}

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
    fruits: [...root.querySelectorAll("[data-ft-fruit]")],
    panels: {
      fruit: { btn: $("fruit-btn"), panel: $("fruit-panel") },
      settings: { btn: $("settings-btn"), panel: $("panel") },
      plan: { btn: $("plan-btn"), panel: $("plan-panel") },
    },
    planEnd: $("plan-end"),
    planQuick: [...root.querySelectorAll("[data-plan-add]")],
    planSummary: $("plan-summary"),
    planGo: $("plan-go"),
    planClear: $("plan-clear"),
    strip: $("strip"),
    stripStart: $("strip-start"),
    stripEnd: $("strip-end"),
    track: $("track"),
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
    fruit: FRUITS[saved.fruit] ? saved.fruit : "tomato",
    notify: saved.notify ?? false,
    settings,
    plan: saved.plan?.blocks?.length ? saved.plan : null,
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

  function miniView() {
    const left = Math.max(0, remainingMs());
    const focus = state.mode === "focus";
    let label = focus ? state.task || "focus" : KIND_NAME[state.breakKind];
    if (focus && !inProgress() && root.classList.contains("needs-task")) {
      label = "name a task first";
    }
    return {
      // The mini window counts down from these itself.
      endAt: state.running ? state.endAt : null,
      remaining: left,
      setMs: state.setMs,
      label,
      mode: state.mode,
      running: state.running,
      started: inProgress(),
      ...modeColors(state.fruit, focus),
      glowFocus: modeColors(state.fruit, true).glow,
      glowBreak: modeColors(state.fruit, false).glow,
    };
  }

  const tabKey = () => (state.mode === "focus" ? "focus" : state.breakKind);
  const lengthFor = key => state.settings[key] * MIN;

  function save() {
    const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
    state.log = state.log.filter(s => s.end >= cutoff);
    const { log, sound, fruit, notify, settings, plan, ...timer } = state;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ log, sound, fruit, notify, settings, plan, timer })
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

  function chime() {
    if (!state.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.22, 0.9, 1.12].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i % 2 ? 1046.5 : 784;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 1.25);
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
  function notice(text) {
    el.toast.textContent = text;
    el.toast.dataset.show = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.dataset.show = "false";
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
  function logFocus(task, start, end, ms) {
    const minutes = Math.round(ms / MIN);
    if (minutes < 1) return;
    state.log.push({ task: task || "untitled", start, end, minutes });
    state.done += 1;
    state.cycleDay = dayKey(end);
  }

  function needTask() {
    root.classList.add("needs-task");
    el.task.focus();
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
    if (state.mode === "focus" && !el.task.value.trim()) {
      needTask();
      render();
      return;
    }
    ensureAudio(); // unlock audio during a user gesture
    if (state.mode === "focus") state.task = el.task.value.trim();
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

  function complete({ quiet = false } = {}) {
    const end = state.endAt ?? Date.now();
    let next;
    if (state.mode === "focus") {
      logFocus(
        state.task,
        state.startedAt ?? end - state.setMs,
        end,
        state.setMs
      );
      el.task.value = "";
      next = state.done % state.settings.every === 0 ? "long" : "short";
    } else {
      if (state.breakKind === "long") state.done = 0;
      next = "focus";
      // Offer the last task again; it's still editable before starting.
      el.task.value = state.task;
    }
    goTo(next);
    if (!quiet) {
      chime();
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
        logFocus(prev.label, prev.start, prev.end, prev.end - prev.start);
      }
      state.plan = null;
      state.planIdx = null;
      state.planPaused = false;
      goTo("focus");
      if (!fromLoad) {
        chime();
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
      logFocus(prev.label, prev.start, prev.end, prev.end - prev.start);
    }

    const block = blocks[idx];
    state.planIdx = idx;
    if (block.kind === "focus") {
      state.mode = "focus";
      state.task = block.label;
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
      chime();
      notice(phaseNotice(block.kind, block.label));
      animateWedge(0, block.end - now, SWEEP_PHASE_MS);
    }
  }

  function startPlan(end) {
    const now = Date.now();
    const label = el.task.value.trim() || state.task;
    cancelSweep();
    state.plan = {
      start: now,
      end,
      blocks: buildPlan(now, end, state.settings, label),
    };
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
    const labels = plan.blocks
      .filter(b => b.kind === "focus" && b.end > now)
      .map(b => b.label);
    const fresh = buildPlan(now, plan.end, state.settings, "");
    let i = 0;
    for (const b of fresh) {
      if (b.kind === "focus") b.label = labels[i++] ?? labels.at(-1) ?? "";
    }
    // Keep finished blocks so the strip still shows the morning so far.
    plan.blocks = [...plan.blocks.filter(b => b.end <= now), ...fresh];
    state.planIdx = null;
    state.planPaused = false;
    syncPlan({ fromLoad: true });
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

  function planPreview() {
    const now = Date.now();
    const end = nextClockTime(el.planEnd.value, now);
    if (end && end <= now) {
      el.planSummary.textContent = "that time has already passed";
      el.planGo.disabled = true;
      return null;
    }
    if (!end || end - now < MIN_PLAN_MS) {
      el.planSummary.textContent = "pick a time at least 10 minutes away";
      el.planGo.disabled = true;
      return null;
    }
    if (end - now > MAX_PLAN_MS) {
      el.planSummary.textContent = "plans can be up to 12 hours";
      el.planGo.disabled = true;
      return null;
    }
    const blocks = buildPlan(now, end, state.settings);
    el.planSummary.textContent = `${fmtMinutes(Math.round((end - now) / MIN))} · ${describePlan(blocks)}`;
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
    root.classList.remove("needs-task");
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
      root.classList.remove("needs-task");
      save();
      render();
      animateWedge(from, state.setMs, SWEEP_SWITCH_MS);
    });
  }

  // ---- Panels (settings, plan) -------------------------------------------

  function openPanel(name) {
    closePanels();
    const { btn, panel } = el.panels[name];
    // Grow out of the pill that opened it. offsetLeft is the panel's layout
    // position, unaffected by its closed-state scale.
    const b = btn.getBoundingClientRect();
    const panelLeft = root.getBoundingClientRect().left + panel.offsetLeft;
    panel.style.transformOrigin = `${Math.round(b.left + b.width / 2 - panelLeft)}px 0`;
    panel.dataset.open = "true";
    panel.inert = false;
    btn.setAttribute("aria-expanded", "true");
    if (name === "plan") {
      if (!el.planEnd.value) {
        // Default: two hours from now, rounded up to a half hour.
        const d = new Date(Date.now() + 2 * 60 * MIN);
        const m = d.getMinutes();
        if (m > 0) d.setMinutes(m <= 30 ? 30 : 60);
        d.setSeconds(0, 0);
        el.planEnd.value = toTimeValue(d.getTime());
      }
      planPreview();
      el.planClear.hidden = !state.plan;
      el.planEnd.focus({ preventScroll: true });
    } else if (name === "fruit") {
      const current = el.fruits.find(b => b.dataset.ftFruit === state.fruit);
      current?.focus({ preventScroll: true });
    } else {
      el.fields[0]?.focus({ preventScroll: true });
    }
  }

  function closePanels({ returnFocus = false } = {}) {
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
      // A new length applies right away if that mode is loaded and idle.
      if (key === tabKey() && !inProgress() && !state.plan) {
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
      const end = Date.now() + Number(quick.dataset.planAdd) * MIN;
      el.planEnd.value = toTimeValue(end);
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
    root.classList.remove("needs-task");
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
      const idx = state.plan.blocks.indexOf(block);
      if (idx === state.planIdx) {
        state.task = block.label;
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
    "[data-ft='hub'], .ft-recent button, .ft-plan-quick button, .ft-plan-go, .ft-fruit-grid button";
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
    if (el.task.value.trim()) root.classList.remove("needs-task");
    renderRecent();
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
    const block = state.plan?.blocks[state.planIdx];
    if (block?.kind === "focus") block.label = name;
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
    if (e.code !== "Space" || e.repeat || !root.isConnected) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, button, [contenteditable]")
    ) {
      return;
    }
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
    el.wedge.setAttribute("d", wedgePath(ms));
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
    if (node.textContent !== b.label) node.textContent = b.label;
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
      ...sessions.map(s => {
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
      `Today: ${sessions.length} focus sessions, ${minutes} minutes`
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
    const recent = show
      ? [...new Set(state.log.map(s => s.task).reverse())]
          .filter(task => task !== "untitled")
          .slice(0, 3)
      : [];
    el.recent.replaceChildren(
      ...recent.map(task => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.textContent = task;
        chip.title = task;
        chip.addEventListener("click", () => {
          el.task.value = task;
          root.classList.remove("needs-task");
          el.task.focus();
          renderRecent();
        });
        return chip;
      })
    );
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
          : "take a breath"
        : "what are you working on?";

    renderStrip();
    lastFrameKey = "";
    renderClock();
    setGlow(true);
    renderToday();
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
