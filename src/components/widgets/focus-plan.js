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
 * @param {{focusDone?: number, breakFirst?: "short"|"long"|null}} [opts]
 *   focusDone: focus blocks already finished, so the long-break cadence
 *   carries on; breakFirst: open with this break (re-fitting mid-break).
 * @returns {{id: string, kind: "focus"|"short"|"long"|"wrap", start: number, end: number, label: string}[]}
 */
export function buildPlan(
  start,
  end,
  settings,
  label = "",
  { focusDone = 0, breakFirst = null } = {}
) {
  const blocks = [];
  let t = start;
  let focusCount = focusDone;
  let pendingBreak = breakFirst;
  // A focus length under 10 minutes is its own minimum.
  const minFocus = Math.min(MIN_FOCUS_MS, settings.focus * MIN);
  const push = (kind, ms, text = "") => {
    blocks.push({ id: makeId(), kind, start: t, end: t + ms, label: text });
    t += ms;
  };

  while (end - t > 0) {
    const left = end - t;
    if (pendingBreak) {
      const breakKind = pendingBreak;
      const breakMs = Math.min(settings[breakKind] * MIN, left);
      pendingBreak = null;
      // No room for another focus block after this break: the rest is a
      // wrap-up buffer before whatever comes next.
      if (left - breakMs < minFocus) {
        push("wrap", left);
        break;
      }
      push(breakKind, breakMs);
      continue;
    }
    if (left < minFocus) {
      push("wrap", left);
      break;
    }
    push("focus", Math.min(settings.focus * MIN, left), label);
    focusCount += 1;
    pendingBreak = focusCount % settings.every === 0 ? "long" : "short";
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

/**
 * Rows for the plan panel, e.g. focus "3 × 25m", breaks "2 × 5m + 1 × 15m",
 * wrap up "3m". Blocks of equal length are grouped; empty rows are left out.
 * @returns {{label: string, value: string}[]}
 */
export function summarizePlan(blocks) {
  const minutes = b => Math.round((b.end - b.start) / MIN);
  const groups = list => {
    const counts = new Map();
    for (const b of list) {
      const m = minutes(b);
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts].map(([m, n]) => `${n} × ${m}m`).join(" + ");
  };
  const rows = [];
  const focus = blocks.filter(b => b.kind === "focus");
  const breaks = blocks.filter(b => b.kind === "short" || b.kind === "long");
  const wrap = blocks.find(b => b.kind === "wrap");
  if (focus.length) rows.push({ label: "focus", value: groups(focus) });
  if (breaks.length) rows.push({ label: "breaks", value: groups(breaks) });
  if (wrap && minutes(wrap) > 0) {
    rows.push({ label: "wrap up", value: `${minutes(wrap)}m` });
  }
  return rows;
}

/** Index of the block containing `now`, or -1. */
export function blockAt(blocks, now) {
  return blocks.findIndex(b => now >= b.start && now < b.end);
}
