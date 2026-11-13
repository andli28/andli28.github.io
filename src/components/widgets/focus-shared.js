// Values shared by the focus timer page and its pop-out mini window.

export const MIN = 60_000;
export const DIAL_MS = 60 * MIN; // one full turn of the dial

// Accent per fruit theme, for the pop-out mini window (the page itself
// takes its colors from CSS). Keep in step with FocusTimer.astro.
export const FRUITS = {
  tomato: { focus: [216, 67, 47], break: [46, 154, 108] },
  orange: { focus: [224, 112, 26], break: [46, 154, 108] },
  apple: { focus: [201, 47, 55], break: [46, 154, 108] },
  watermelon: { focus: [224, 67, 79], break: [31, 138, 94] },
};

/** Ring and glow colors for the mini window. */
export function modeColors(fruit, focus) {
  const [r, g, b] = (FRUITS[fruit] ?? FRUITS.tomato)[focus ? "focus" : "break"];
  return { color: `rgb(${r},${g},${b})`, glow: `rgba(${r},${g},${b},0.22)` };
}

/** Milliseconds as "MM:SS", rounding up so 0.4s left still reads 00:01. */
export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
