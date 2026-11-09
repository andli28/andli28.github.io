// Logic for <FocusTimer />. Everything is looked up inside `root`, and all
// state lives in localStorage under one key, so nothing leaves the browser.
//
// The countdown is driven by a wall-clock end time (not by counting ticks), so
// it stays accurate in background tabs and survives a page reload.

const STORAGE_KEY = "lab-focus-timer-v2";
const MIN = 60_000;
const DIAL_MS = 60 * MIN; // one full turn of the dial
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

function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtMinutes(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const fmtTime = ts =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
    settingsBtn: $("settings-btn"),
    panel: $("panel"),
    cycle: $("cycle"),
    todayWrap: $("today-wrap"),
    dots: $("dots"),
    total: $("total"),
    glow: { focus: $("glow-focus"), break: $("glow-break") },
    tabs: [...root.querySelectorAll("[data-ft-mode]")],
    fields: [...root.querySelectorAll("[data-ft-set]")],
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
    sound: saved.sound ?? true,
    settings,
    mode: t.mode === "break" ? "break" : "focus",
    breakKind: t.breakKind === "long" ? "long" : "short",
    setMs: t.setMs ?? settings.focus * MIN,
    remaining: t.remaining ?? null,
    running: Boolean(t.running),
    endAt: t.endAt ?? null,
    startedAt: t.startedAt ?? null,
    task: t.task ?? "",
    done: t.done ?? 0,
  };
  if (state.remaining == null) state.remaining = state.setMs;

  const pageTitle = document.title;
  let interval = null;
  let audio = null;
  let dragging = false;
  let dragMinutes = 0;
  let lastFrameKey = "";
  let sweep = null; // { to, from, start, ms, raf } while the wedge animates
  let shiftTimer = null;

  const tabKey = () => (state.mode === "focus" ? "focus" : state.breakKind);
  const lengthFor = key => state.settings[key] * MIN;

  function save() {
    const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
    state.log = state.log.filter(s => s.end >= cutoff);
    const { log, sound, settings, ...timer } = state;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ log, sound, settings, timer })
      );
    } catch {
      // Storage can be unavailable (private mode); the timer still works.
    }
  }

  const remainingMs = () =>
    state.running ? state.endAt - Date.now() : state.remaining;

  const inProgress = () =>
    state.running || (state.startedAt != null && state.remaining > 0);

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

  function needTask() {
    root.classList.add("needs-task");
    el.task.focus();
  }

  function tryStart() {
    if (state.running || remainingMs() <= 0) return;
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
    stopTicking();
    save();
    render();
  }

  const toggle = () => (state.running ? pause() : tryStart());

  function complete({ quiet = false } = {}) {
    const end = state.endAt ?? Date.now();
    if (state.mode === "focus") {
      state.log.push({
        task: state.task || "untitled",
        start: state.startedAt ?? end - state.setMs,
        end,
        minutes: Math.max(1, Math.round(state.setMs / MIN)),
      });
      state.done += 1;
      el.task.value = "";
      goTo(state.done % state.settings.every === 0 ? "long" : "short");
    } else {
      if (state.breakKind === "long") state.done = 0;
      goTo("focus");
    }
    if (!quiet) chime();
    save();
    render();
    if (!quiet) animateWedge(0, state.setMs, SWEEP_PHASE_MS);
  }

  function tick() {
    if (state.running && remainingMs() <= 0) complete();
    else renderClock();
  }

  function startTicking() {
    stopTicking();
    interval = setInterval(tick, 200);
  }

  function stopTicking() {
    if (interval) clearInterval(interval);
    interval = null;
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

  function minutesAt(e) {
    const r = el.dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += Math.PI * 2;
    let m = Math.round((a / (Math.PI * 2)) * 60);
    // Don't wrap around past 0 or 60: hold at the end you came from.
    if (dragMinutes >= 45 && m <= 15) m = 60;
    else if (dragMinutes <= 15 && m >= 45) m = 0;
    return m;
  }

  el.dial.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("[data-ft='hub']") || dragging) {
      return;
    }
    dragging = true;
    cancelSweep();
    closePanel();
    el.dial.setPointerCapture(e.pointerId);
    el.dial.classList.add("is-dragging");
    ensureAudio();
    dragMinutes = Math.min(60, Math.round(remainingMs() / MIN));
    const m = minutesAt(e);
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
      if (
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

  // ---- Settings panel ----------------------------------------------------

  function openPanel() {
    el.panel.dataset.open = "true";
    el.panel.inert = false;
    el.settingsBtn.setAttribute("aria-expanded", "true");
    el.fields[0]?.focus({ preventScroll: true });
  }

  function closePanel({ returnFocus = false } = {}) {
    if (el.panel.dataset.open !== "true") return;
    el.panel.dataset.open = "false";
    el.panel.inert = true;
    el.settingsBtn.setAttribute("aria-expanded", "false");
    if (returnFocus) el.settingsBtn.focus();
  }

  el.settingsBtn.addEventListener("click", () => {
    if (el.panel.dataset.open === "true") closePanel();
    else openPanel();
  });

  el.panel.addEventListener("keydown", e => {
    if (e.key === "Escape") closePanel({ returnFocus: true });
  });

  document.addEventListener("pointerdown", onOutside);
  function onOutside(e) {
    if (
      el.panel.dataset.open === "true" &&
      !el.panel.contains(e.target) &&
      !el.settingsBtn.contains(e.target)
    ) {
      closePanel();
    }
  }

  for (const field of el.fields) {
    field.addEventListener("change", () => {
      const key = field.dataset.ftSet;
      state.settings[key] = clampSetting(key, field.value);
      field.value = String(state.settings[key]);
      // A new length applies right away if that mode is loaded and idle.
      if (key === tabKey() && !inProgress()) {
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

  // ---- Other events ------------------------------------------------------

  el.hub.addEventListener("click", toggle);
  el.hub.addEventListener("pointerdown", () => {
    el.hub.dataset.pressed = "";
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    el.hub.addEventListener(type, () => delete el.hub.dataset.pressed);
  }

  el.sound.addEventListener("click", () => {
    state.sound = !state.sound;
    if (state.sound) ensureAudio();
    save();
    render();
  });

  el.task.addEventListener("input", () => {
    if (el.task.value.trim()) root.classList.remove("needs-task");
  });
  el.task.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.running) el.task.blur();
      else tryStart();
    }
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
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
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
    document.title = state.running
      ? `${clock} · ${state.mode === "focus" ? state.task || "focus" : "break"}`
      : pageTitle;
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

    const recent = [...new Set(state.log.map(s => s.task).reverse())].slice(
      0,
      8
    );
    el.recent.replaceChildren(
      ...recent.map(task => {
        const opt = document.createElement("option");
        opt.value = task;
        return opt;
      })
    );
  }

  function render() {
    const paused = !state.running && inProgress();
    root.dataset.mode = state.mode;
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
    el.sound.textContent = `sound: ${state.sound ? "on" : "off"}`;
    el.sound.setAttribute("aria-pressed", String(state.sound));

    for (const field of el.fields) {
      if (document.activeElement !== field) {
        field.value = String(state.settings[field.dataset.ftSet]);
      }
    }

    const locked = state.mode === "focus" && inProgress();
    el.task.readOnly = locked;
    if (locked || (state.mode === "focus" && !el.task.value)) {
      el.task.value = state.task;
    }
    el.task.placeholder =
      state.mode === "break" ? "take a breath" : "what are you working on?";

    lastFrameKey = "";
    renderClock();
    setGlow(true);
    renderToday();
  }

  // A session that ended while the page was closed is logged without a chime.
  if (state.running && remainingMs() <= 0) complete({ quiet: true });
  if (state.running) startTicking();
  el.panel.inert = true;
  render();
}
