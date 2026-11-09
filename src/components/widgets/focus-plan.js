// Splits a window of free time into focus and break blocks.
// Pure functions only, so the same code can later fit blocks around
// calendar events.

const MIN = 60_000;
// Less time than this left at the end isn't worth a focus block, so it
// becomes a "wrap up" buffer instead.
const MIN_FOCUS_MS = 10 * MIN;

let nextId = 0;
const makeId = () => `b${Date.now().toString(36)}${(nextId++).toString(36)}`;

/**
 * @param {number} start  window start (ms since epoch)
 * @param {number} end    window end (ms since epoch)
 * @param {{focus: number, short: number, long: number, every: number}} settings  minutes
 * @param {string} [label] label for the focus blocks
 * @returns {{id: string, kind: "focus"|"short"|"long"|"wrap", start: number, end: number, label: string}[]}
 */
export function buildPlan(start, end, settings, label = "") {
  const blocks = [];
  let t = start;
  let focusCount = 0;
  const push = (kind, ms, text = "") => {
    blocks.push({ id: makeId(), kind, start: t, end: t + ms, label: text });
    t += ms;
  };

  while (end - t > 0) {
    const left = end - t;
    if (left < MIN_FOCUS_MS) {
      push("wrap", left);
      break;
    }
    push("focus", Math.min(settings.focus * MIN, left), label);
    focusCount += 1;

    const afterFocus = end - t;
    if (afterFocus <= 0) break;
    const kind = focusCount % settings.every === 0 ? "long" : "short";
    const breakMs = Math.min(settings[kind] * MIN, afterFocus);
    // No room for another focus block after this break: the rest is a
    // wrap-up buffer before whatever comes next.
    if (afterFocus - breakMs < MIN_FOCUS_MS) {
      push("wrap", afterFocus);
      break;
    }
    push(kind, breakMs);
  }
  return blocks;
}

/** Short summary like "4 focus · 3 breaks · 5m wrap up". */
export function describePlan(blocks) {
  const focus = blocks.filter(b => b.kind === "focus").length;
  const breaks = blocks.filter(b => b.kind === "short" || b.kind === "long");
  const wrap = blocks.find(b => b.kind === "wrap");
  const parts = [`${focus} focus`];
  if (breaks.length) {
    parts.push(`${breaks.length} ${breaks.length === 1 ? "break" : "breaks"}`);
  }
  if (wrap) parts.push(`${Math.round((wrap.end - wrap.start) / MIN)}m wrap up`);
  return parts.join(" · ");
}

/** Index of the block containing `now`, or -1. */
export function blockAt(blocks, now) {
  return blocks.findIndex(b => now >= b.start && now < b.end);
}
