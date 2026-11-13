// Values shared by the focus timer page and its pop-out mini window.

export const MIN = 60_000;
export const DIAL_MS = 60 * MIN; // one full turn of the dial

// Each fruit's colors, for the pop-out mini window (the page itself takes
// its colors from CSS). Keep in step with the fruit blocks in
// FocusTimer.astro.
export const FRUITS = {
  tomato: {
    skin: "#e0503c",
    shade: "#b03a2b",
    rind: "#e0503c",
    face: "#ffffff",
    wedge: "#f2a33a",
    leaf: "#2e9a6c",
    stem: "#23774f",
    rest: "#2e9a6c",
  },
  orange: {
    skin: "#f28c28",
    shade: "#c96a12",
    rind: "#ffe3b3",
    face: "#fffaf0",
    wedge: "#f28c28",
    leaf: "#2e9a6c",
    stem: "#6b4226",
    rest: "#2e9a6c",
  },
  apple: {
    skin: "#d9363e",
    shade: "#a8262d",
    rind: "#fff1cf",
    face: "#fffbef",
    wedge: "#d9363e",
    leaf: "#2e9a6c",
    stem: "#6b4226",
    rest: "#2e9a6c",
  },
  watermelon: {
    skin: "#2e9a6c",
    shade: "#1f6e4d",
    rind: "#dff1c6",
    face: "#ffe4e1",
    wedge: "#ef4b5a",
    leaf: "#2e9a6c",
    stem: "#6b4226",
    rest: "#1f8a5e",
  },
};

/** A fruit's colors, with the wedge in the break color during a break. */
export function fruitColors(fruit, focus) {
  const f = FRUITS[fruit] ?? FRUITS.tomato;
  return { ...f, wedge: focus ? f.wedge : f.rest };
}

/** Milliseconds as "MM:SS", rounding up so 0.4s left still reads 00:01. */
export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
