// Logic for <FocusTimer />. Everything is looked up inside `root`, and all
// state lives in localStorage under one key, so nothing leaves the browser.
//
// The countdown is driven by a wall-clock end time (not by counting ticks), so
// it stays accurate in background tabs and survives a page reload.

const STORAGE_KEY = "lab-focus-timer-v1";
const MODES = { focus: "Focus", short: "Short break", long: "Long break" };
const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, sound: true };
const HISTORY_DAYS = 30;
const RING_LENGTH = 2 * Math.PI * 90;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") ?? {};
  } catch {
    return {};
  }
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtMinutes(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const fmtTime = ts =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function mountFocusTimer(root) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const $ = name => root.querySelector(`[data-ft="${name}"]`);
  const el = {
    ring: $("ring"),
    time: $("time"),
    sub: $("sub"),
    task: $("task"),
    recent: $("recent"),
    hint: $("hint"),
    start: $("start"),
    reset: $("reset"),
    skip: $("skip"),
    test: $("test"),
    total: $("total"),
    today: $("today"),
    empty: $("empty"),
    earlierWrap: $("earlier-wrap"),
    earlier: $("earlier"),
    clear: $("clear"),
    modes: [...root.querySelectorAll("[data-ft-mode]")],
    settings: [...root.querySelectorAll("[data-ft-set]")],
  };
  el.ring.style.strokeDasharray = String(RING_LENGTH);

  const saved = load();
  const state = {
    settings: { ...DEFAULTS, ...saved.settings },
    log: Array.isArray(saved.log) ? saved.log : [],
    // Timer: running sessions have endAt; paused ones have remaining.
    mode: saved.timer?.mode in MODES ? saved.timer.mode : "focus",
    running: Boolean(saved.timer?.running),
    endAt: saved.timer?.endAt ?? null,
    remaining: saved.timer?.remaining ?? null,
    startedAt: saved.timer?.startedAt ?? null,
    task: saved.timer?.task ?? "",
    done: saved.timer?.done ?? 0, // focus sessions finished in this cycle
  };

  const pageTitle = document.title;
  let interval = null;
  let audio = null;

  const durationMs = mode => state.settings[mode] * 60_000;

  function save() {
    const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
    state.log = state.log.filter(s => s.end >= cutoff);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          settings: state.settings,
          log: state.log,
          timer: {
            mode: state.mode,
            running: state.running,
            endAt: state.endAt,
            remaining: state.remaining,
            startedAt: state.startedAt,
            task: state.task,
            done: state.done,
          },
        })
      );
    } catch {
      // Storage can be unavailable (private mode); the timer still works.
    }
  }

  function remainingMs() {
    if (state.running) return state.endAt - Date.now();
    return state.remaining ?? durationMs(state.mode);
  }

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
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Two soft rising bell tones, played twice.
    [0, 0.22, 0.9, 1.12].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i % 2 ? 1046.5 : 784;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 1.25);
    });
  }

  // ---- Timer -------------------------------------------------------------

  function setMode(mode) {
    state.mode = mode;
    state.running = false;
    state.endAt = null;
    state.remaining = null;
    state.startedAt = null;
    stopTicking();
  }

  function start() {
    if (state.mode === "focus" && !el.task.value.trim()) {
      el.hint.textContent = "Name what you're working on first.";
      el.task.focus();
      return;
    }
    el.hint.textContent = "";
    ensureAudio(); // unlock audio during a user gesture
    if (state.mode === "focus") state.task = el.task.value.trim();
    const left = remainingMs();
    if (state.remaining == null) state.startedAt = Date.now();
    state.endAt = Date.now() + left;
    state.remaining = null;
    state.running = true;
    startTicking();
    save();
    render();
  }

  function pause() {
    state.remaining = Math.max(0, state.endAt - Date.now());
    state.endAt = null;
    state.running = false;
    stopTicking();
    save();
    render();
  }

  function nextMode() {
    if (state.mode !== "focus") return "focus";
    return state.done > 0 && state.done % state.settings.every === 0
      ? "long"
      : "short";
  }

  function complete({ quiet = false } = {}) {
    const end = state.endAt ?? Date.now();
    if (state.mode === "focus") {
      state.log.push({
        task: state.task || "Untitled",
        start: state.startedAt ?? end - durationMs("focus"),
        end,
        minutes: state.settings.focus,
      });
      state.done += 1;
    } else if (state.mode === "long") {
      state.done = 0;
    }
    if (!quiet && state.settings.sound) chime();
    setMode(nextMode());
    save();
    render();
  }

  function skip() {
    if (state.mode === "long") state.done = 0;
    if (state.mode === "focus") {
      // A skipped focus session isn't logged, but it still moves the cycle on.
      state.done += 1;
    }
    setMode(nextMode());
    save();
    render();
  }

  function reset() {
    setMode(state.mode);
    save();
    render();
  }

  function tick() {
    if (state.running && remainingMs() <= 0) {
      complete();
      return;
    }
    renderClock();
  }

  function startTicking() {
    stopTicking();
    interval = setInterval(tick, 250);
  }

  function stopTicking() {
    if (interval) clearInterval(interval);
    interval = null;
  }

  // ---- Rendering ---------------------------------------------------------

  function renderClock() {
    const left = remainingMs();
    const total = durationMs(state.mode);
    const clock = fmtClock(left);
    el.time.textContent = clock;
    const progress = Math.min(1, Math.max(0, 1 - left / total));
    el.ring.style.strokeDashoffset = String(RING_LENGTH * progress);
    document.title = state.running
      ? `${clock} · ${MODES[state.mode]}`
      : pageTitle;
  }

  function renderLog() {
    const today = dayKey(Date.now());
    const todays = state.log.filter(s => dayKey(s.end) === today);
    el.today.replaceChildren(
      ...todays
        .slice()
        .reverse()
        .map(s => {
          const li = document.createElement("li");
          const at = document.createElement("span");
          at.className = "ft-at";
          at.textContent = fmtTime(s.start);
          const name = document.createElement("span");
          name.className = "ft-name";
          name.textContent = s.task;
          const min = document.createElement("span");
          min.className = "ft-min";
          min.textContent = `${s.minutes} min`;
          li.append(at, name, min);
          return li;
        })
    );
    const minutes = todays.reduce((sum, s) => sum + s.minutes, 0);
    el.total.textContent = todays.length
      ? `${todays.length} ${todays.length === 1 ? "session" : "sessions"} · ${fmtMinutes(minutes)}`
      : "";
    el.empty.hidden = todays.length > 0;

    // Earlier days: one line per task per day.
    const byDay = new Map();
    for (const s of state.log) {
      const key = dayKey(s.end);
      if (key === today) continue;
      if (!byDay.has(key)) byDay.set(key, { ts: s.end, tasks: new Map() });
      const tasks = byDay.get(key).tasks;
      tasks.set(s.task, (tasks.get(s.task) ?? 0) + s.minutes);
    }
    const days = [...byDay.values()].sort((a, b) => b.ts - a.ts);
    el.earlier.replaceChildren(
      ...days.map(day => {
        const wrap = document.createElement("div");
        wrap.className = "ft-day";
        const h = document.createElement("h4");
        const total = [...day.tasks.values()].reduce((a, b) => a + b, 0);
        h.textContent = `${new Date(day.ts).toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
        })} · ${fmtMinutes(total)}`;
        const ol = document.createElement("ol");
        for (const [task, min] of day.tasks) {
          const li = document.createElement("li");
          const at = document.createElement("span");
          const name = document.createElement("span");
          name.className = "ft-name";
          name.textContent = task;
          const m = document.createElement("span");
          m.className = "ft-min";
          m.textContent = fmtMinutes(min);
          li.append(at, name, m);
          ol.append(li);
        }
        wrap.append(h, ol);
        return wrap;
      })
    );
    el.earlierWrap.hidden = days.length === 0;
    el.clear.hidden = state.log.length === 0;

    // Recent task names for the input's suggestions.
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
    root.dataset.mode = state.mode;
    for (const b of el.modes) {
      b.setAttribute("aria-pressed", String(b.dataset.ftMode === state.mode));
    }
    const paused = !state.running && state.remaining != null;
    el.start.textContent = state.running
      ? "Pause"
      : paused
        ? "Resume"
        : "Start";

    const position = (state.done % state.settings.every) + 1;
    el.sub.textContent =
      state.mode === "focus"
        ? `Session ${position} of ${state.settings.every}`
        : MODES[state.mode];

    const focusActive =
      state.mode === "focus" && (state.running || state.remaining != null);
    el.task.readOnly = focusActive;
    if (focusActive) el.task.value = state.task;

    for (const input of el.settings) {
      const key = input.dataset.ftSet;
      if (input.type === "checkbox") input.checked = state.settings[key];
      else if (document.activeElement !== input)
        input.value = state.settings[key];
    }
    renderClock();
    renderLog();
  }

  // ---- Events ------------------------------------------------------------

  el.start.addEventListener("click", () => (state.running ? pause() : start()));
  el.reset.addEventListener("click", reset);
  el.skip.addEventListener("click", skip);
  el.test.addEventListener("click", chime);

  for (const b of el.modes) {
    b.addEventListener("click", () => {
      const mode = b.dataset.ftMode;
      if (mode === state.mode) return;
      if (
        state.running &&
        state.mode === "focus" &&
        !window.confirm("Stop the current focus session?")
      ) {
        return;
      }
      setMode(mode);
      save();
      render();
    });
  }

  el.task.addEventListener("input", () => {
    if (el.task.value.trim()) el.hint.textContent = "";
  });
  el.task.addEventListener("keydown", e => {
    if (e.key === "Enter" && !state.running) start();
  });

  for (const input of el.settings) {
    input.addEventListener("change", () => {
      const key = input.dataset.ftSet;
      if (input.type === "checkbox") {
        state.settings[key] = input.checked;
      } else {
        const min = Number(input.min);
        const max = Number(input.max);
        const value = Math.round(Number(input.value));
        state.settings[key] = Number.isFinite(value)
          ? Math.min(max, Math.max(min, value))
          : DEFAULTS[key];
        // A new length applies to an idle timer right away.
        if (!state.running && state.remaining == null) setMode(state.mode);
      }
      save();
      render();
    });
  }

  el.clear.addEventListener("click", () => {
    if (!window.confirm("Delete all logged focus sessions?")) return;
    state.log = [];
    save();
    render();
  });

  const onKey = e => {
    if (e.code !== "Space" || e.repeat) return;
    const t = e.target;
    if (
      t instanceof HTMLElement &&
      t.closest("input, textarea, select, button, summary, [contenteditable]")
    ) {
      return;
    }
    if (!root.isConnected) return;
    e.preventDefault();
    if (state.running) pause();
    else start();
  };
  document.addEventListener("keydown", onKey);

  // Clean up when Astro's router swaps to another page.
  document.addEventListener(
    "astro:before-swap",
    () => {
      stopTicking();
      document.removeEventListener("keydown", onKey);
      document.title = pageTitle;
    },
    { once: true }
  );

  // A session that ended while the page was closed is logged without a chime.
  if (state.running && remainingMs() <= 0) complete({ quiet: true });
  if (state.running) startTicking();
  render();
}
