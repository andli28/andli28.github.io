// Values shared by the focus timer page and its pop-out mini window.

export const MIN = 60_000;
export const DIAL_MS = 60 * MIN; // one full turn of the dial

export const FRUIT_IDS = ["tomato", "orange", "apple", "watermelon"];

// The dial's wedge, in the dial SVG's -200..200 box: it ends just inside
// the ticks. The pop-out draws a copy of the same SVG, so it shares this.
export const WEDGE_R = 106;

/** The wedge for `frac` of a full turn, clockwise from 12 o'clock. */
export function wedgePath(frac) {
  const r = WEDGE_R;
  const f = Math.min(1, Math.max(0, frac));
  if (f <= 0) return "";
  if (f >= 0.9999) {
    return `M0,${-r}A${r},${r} 0 1 1 0,${r}A${r},${r} 0 1 1 0,${-r}Z`;
  }
  const a = f * Math.PI * 2;
  const x = (r * Math.sin(a)).toFixed(2);
  const y = (-r * Math.cos(a)).toFixed(2);
  return `M0,0L0,${-r}A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x},${y}Z`;
}

/** Milliseconds as "MM:SS", rounding up so 0.4s left still reads 00:01. */
export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
