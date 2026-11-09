// Values shared by the focus timer page and its pop-out mini window.

export const MIN = 60_000;
export const DIAL_MS = 60 * MIN; // one full turn of the dial

export const COLORS = {
  focus: { stroke: "#e8542e", glow: "rgba(232,84,46,0.22)" },
  break: { stroke: "#1e9e8f", glow: "rgba(30,158,143,0.22)" },
};

/** Milliseconds as "MM:SS", rounding up so 0.4s left still reads 00:01. */
export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
