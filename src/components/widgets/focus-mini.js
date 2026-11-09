// A small always-on-top timer window ("pop out").
//
// Chrome/Edge: Document Picture-in-Picture, a real mini window with a
// progress ring, the time, the task and a pause button.
// Safari and others with video PiP: the same view drawn on a canvas and
// shown as a picture-in-picture video; its play/pause button drives the
// timer.

import { COLORS, DIAL_MS, fmtClock } from "./focus-shared.js";

const RING = 2 * Math.PI * 30;

const hasDocumentPip = () =>
  typeof window !== "undefined" && "documentPictureInPicture" in window;

const hasVideoPip = () =>
  typeof document !== "undefined" &&
  document.pictureInPictureEnabled === true &&
  typeof HTMLCanvasElement.prototype.captureStream === "function";

export const miniSupported = () => hasDocumentPip() || hasVideoPip();

const MINI_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: #0b0b0d;
    color: #ece8e1;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    user-select: none;
    overflow: hidden;
  }
  /* One glow layer per mode, crossfaded (gradients can't be animated). */
  body::before,
  body::after {
    position: fixed;
    inset: 0;
    content: "";
    pointer-events: none;
    transition: opacity 300ms ease;
  }
  body::before {
    background: radial-gradient(circle at 20% 50%, ${COLORS.focus.glow} 0, transparent 60%);
  }
  body::after {
    background: radial-gradient(circle at 20% 50%, ${COLORS.break.glow} 0, transparent 60%);
    opacity: 0;
  }
  body[data-mode="break"]::before { opacity: 0; }
  body[data-mode="break"]::after { opacity: 1; }
  body > * { position: relative; z-index: 1; }
  svg { width: 64px; height: 64px; transform: rotate(-90deg); }
  .track { fill: none; stroke: rgb(236 232 225 / 0.1); stroke-width: 6; }
  .ring {
    fill: none;
    stroke: var(--color);
    stroke-width: 6;
    stroke-linecap: round;
    stroke-dasharray: ${RING.toFixed(2)};
    transition: stroke 300ms ease;
  }
  .text { min-width: 0; }
  .time {
    font-size: 30px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
    line-height: 1.1;
  }
  body[data-paused] .time { opacity: 0.5; }
  .label {
    overflow: hidden;
    color: rgb(236 232 225 / 0.6);
    font-family: "Iowan Old Style", "New York", ui-serif, Georgia, serif;
    font-size: 14px;
    font-style: italic;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border: 1px solid rgb(236 232 225 / 0.18);
    border-radius: 50%;
    background: transparent;
    color: #ece8e1;
    cursor: pointer;
    transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  /* Pointer presses only, so keyboard activation stays instant. */
  button[data-pressed] { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    button { transition: none; }
    button[data-pressed] { transform: none; }
  }
  button svg { width: 14px; height: 14px; transform: none; }
`;

const ICON_PAUSE =
  '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5Z" fill="currentColor"/></svg>';

/**
 * The mini window keeps its own time: the main page sends the session's
 * end time (or the paused remainder) whenever something changes, and the
 * mini window counts down from that on its own frame loop. A background
 * tab gets throttled or frozen by the browser, but the mini window is on
 * screen, so its countdown keeps going regardless.
 *
 * @param {{ onToggle: () => void, onTick: () => void, onClose: () => void }} hooks
 *   onTick nudges the main page about once a second (and right at 00:00)
 *   so phase changes happen on time even while its own timers are slowed.
 */
export function createMini({ onToggle, onTick, onClose }) {
  let pip = null; // Document PiP window
  let video = null; // video PiP fallback
  let canvas = null;
  let ticker = null;
  let raf = 0;
  let view = null; // latest state from the main page
  let painted = "";
  let lastNudge = 0;
  let opening = false;
  const nodes = {};

  const isOpen = () => Boolean(pip || video);

  // True while the person is interacting with the mini window itself.
  const hasFocus = () => {
    try {
      return Boolean(pip?.document.hasFocus());
    } catch {
      return false;
    }
  };

  // Time left, computed here from the end time rather than sent each second.
  function leftMs() {
    if (!view) return 0;
    return view.endAt != null
      ? Math.max(0, view.endAt - Date.now())
      : view.remaining;
  }

  function nudge(force) {
    const now = Date.now();
    if (force || now - lastNudge >= 1000) {
      lastNudge = now;
      onTick();
    }
  }

  async function open(initial) {
    // `opening` covers the awaits below, so a double click opens one window.
    if (isOpen() || opening) return;
    opening = true;
    try {
      if (hasDocumentPip()) await openDocument(initial);
      else if (hasVideoPip()) await openVideo(initial);
    } catch (err) {
      // Leave nothing half-open (e.g. Safari refusing picture-in-picture).
      const w = pip;
      if (isOpen()) teardown();
      if (w && !w.closed) w.close();
      throw err;
    } finally {
      opening = false;
    }
  }

  async function openDocument(initial) {
    pip = await window.documentPictureInPicture.requestWindow({
      width: 300,
      height: 104,
    });
    const doc = pip.document;
    doc.title = "Pomodoro Timer";
    const style = doc.createElement("style");
    style.textContent = MINI_CSS;
    doc.head.append(style);
    doc.body.innerHTML = `
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle class="track" cx="36" cy="36" r="30"></circle>
        <circle class="ring" cx="36" cy="36" r="30"></circle>
      </svg>
      <div class="text">
        <div class="time" role="timer"></div>
        <div class="label"></div>
      </div>
      <button type="button"></button>`;
    nodes.ring = doc.querySelector(".ring");
    nodes.time = doc.querySelector(".time");
    nodes.label = doc.querySelector(".label");
    nodes.button = doc.querySelector("button");
    nodes.button.addEventListener("click", onToggle);
    nodes.button.addEventListener("pointerdown", () => {
      nodes.button.dataset.pressed = "";
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
      nodes.button.addEventListener(type, () => {
        delete nodes.button.dataset.pressed;
      });
    }
    pip.addEventListener("pagehide", teardown, { once: true });
    update(initial);

    // Frame loop owned by the mini window. A backup interval covers the
    // rare case where frames pause (e.g. the mini window is minimized).
    const frame = () => {
      if (!pip) return;
      paint();
      const done = view?.running && leftMs() <= 0;
      nudge(done);
      raf = pip.requestAnimationFrame(frame);
    };
    raf = pip.requestAnimationFrame(frame);
    ticker = pip.setInterval(() => {
      paint();
      nudge(false);
    }, 1000);
  }

  async function openVideo(initial) {
    canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 208;
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.append(video);
    update(initial);
    video.srcObject = canvas.captureStream();
    await video.play();
    // The video's own play/pause button pauses and resumes the timer.
    video.addEventListener("pause", () => {
      if (video && view?.running) onToggle();
    });
    video.addEventListener("play", () => {
      if (video && view && !view.running) onToggle();
    });
    video.addEventListener("leavepictureinpicture", teardown, { once: true });
    ticker = window.setInterval(() => {
      paint();
      nudge(view?.running && leftMs() <= 0);
    }, 500);
    await video.requestPictureInPicture();
    if (!view?.running) video.pause();
  }

  /** New state from the main page: end time, remainder, label, mode... */
  function update(next) {
    if (!isOpen()) return;
    view = next;
    paint();
  }

  function paint() {
    if (!view) return;
    const left = leftMs();
    const time = fmtClock(left);
    // Same scale as the big dial: a full ring is 60 minutes.
    const frac = Math.min(1, left / DIAL_MS);
    const key = `${time}|${frac.toFixed(3)}|${view.label}|${view.running}|${view.started}|${view.mode}`;
    if (key === painted) return;
    painted = key;
    if (pip) {
      const body = pip.document.body;
      body.style.setProperty("--color", view.color);
      body.dataset.mode = view.mode;
      body.toggleAttribute("data-paused", !view.running && view.started);
      nodes.ring.style.strokeDashoffset = String(RING * (1 - frac));
      nodes.time.textContent = time;
      nodes.label.textContent = view.label;
      nodes.button.innerHTML = view.running ? ICON_PAUSE : ICON_PLAY;
      nodes.button.setAttribute("aria-label", view.running ? "Pause" : "Start");
    } else if (canvas) {
      draw(time, frac);
      // Keep the video's play state in step with the timer.
      if (view.running && video.paused) video.play().catch(() => {});
      else if (!view.running && !video.paused) video.pause();
    }
  }

  function draw(time, frac) {
    const ctx = canvas.getContext("2d");
    const { width: w, height: h } = canvas;
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(120, h / 2, 0, 120, h / 2, 260);
    glow.addColorStop(0, view.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const cx = 104;
    const cy = h / 2;
    const r = 62;
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(236,232,225,0.1)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0) {
      ctx.strokeStyle = view.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle =
      view.running || !view.started ? "#ece8e1" : "rgba(236,232,225,0.5)";
    ctx.font = "600 64px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(time, 200, cy + 8);
    ctx.fillStyle = "rgba(236,232,225,0.6)";
    ctx.font = "italic 28px Georgia, serif";
    const label =
      view.label.length > 26 ? `${view.label.slice(0, 25)}…` : view.label;
    ctx.fillText(label, 202, cy + 52);
  }

  function teardown() {
    if (ticker) {
      (pip ?? window).clearInterval(ticker);
      ticker = null;
    }
    if (raf && pip) pip.cancelAnimationFrame(raf);
    raf = 0;
    if (video) {
      video.srcObject = null;
      video.remove();
    }
    pip = null;
    video = null;
    canvas = null;
    view = null;
    painted = "";
    onClose();
  }

  async function close() {
    if (pip) pip.close();
    else if (video && document.pictureInPictureElement === video) {
      await document.exitPictureInPicture();
    }
  }

  return { open, close, update, isOpen, hasFocus };
}
