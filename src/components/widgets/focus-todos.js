// The task list for <FocusTimer />: pure functions only, so they can be
// tested without a page. A todo is
//   { id, text, est, spentMin, doneAt }
// where `est` is the estimate in focus sessions, `spentMin` the focus
// minutes logged to it so far, and `doneAt` when it was checked off.

let nextId = 0;

/** A new open task, estimated at one session. */
export function makeTodo(text, now = Date.now()) {
  return {
    id: `t${now.toString(36)}${(nextId++).toString(36)}`,
    text,
    est: 1,
    spentMin: 0,
    doneAt: null,
  };
}

export const openTodos = todos => todos.filter(t => !t.doneAt);

/** Sessions spent so far, to the nearest half: 0, 0.5, 1, 1.5, … */
export function sessionsSpent(todo, focusMin) {
  return Math.round((todo.spentMin / focusMin) * 2) / 2;
}

/** "1½", "2", "½". */
export function fmtSessions(n) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5 ? "½" : "";
  return whole === 0 && half ? half : `${whole}${half}`;
}

/** Whole sessions still to plan for an open task: at least one, since it
 *  isn't checked off yet. */
export function sessionsLeft(todo, focusMin) {
  return Math.max(1, todo.est - Math.round(todo.spentMin / focusMin));
}

/**
 * Name a plan's focus blocks after the open tasks, in list order (the
 * current task first), each for as many sessions as it has left. Blocks
 * you renamed yourself (`manual`) are left alone, and blocks past the end
 * of the list are left unnamed. With no open tasks nothing changes, so
 * plans without a list keep their labels.
 *
 * @param {{kind: string, label: string, todoId?: string|null, manual?: boolean}[]} blocks
 * @param {number} fromIdx  first block to name
 * @param {object[]} todos
 * @param {{currentId?: string|null, focusMin: number, currentInBlock?: boolean}} opts
 *   currentInBlock: a block before `fromIdx` is already spending a session
 *   on the current task, so it needs one fewer here.
 * @returns {boolean} whether any names were given
 */
export function assignTodos(
  blocks,
  fromIdx,
  todos,
  { currentId = null, focusMin, currentInBlock = false }
) {
  const open = openTodos(todos);
  if (!open.length) return false;
  const current = open.find(t => t.id === currentId);
  const ordered = current
    ? [current, ...open.filter(t => t !== current)]
    : open;
  const queue = [];
  for (const todo of ordered) {
    let n = sessionsLeft(todo, focusMin);
    if (currentInBlock && todo === current) n -= 1;
    for (let i = 0; i < n; i++) queue.push(todo);
  }
  let q = 0;
  for (let i = Math.max(0, fromIdx); i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "focus" || b.manual) continue;
    const todo = queue[q++];
    b.todoId = todo?.id ?? null;
    b.label = todo?.text ?? "";
  }
  return true;
}

const MAX_EST = 20;
const MAX_TEXT = 60;

/**
 * One line of a task list as you might paste it from elsewhere: list
 * markers and empty checkboxes are dropped, and a trailing "x2", "×2",
 * "(2)" or "🍅🍅" is read as the estimate. Ticked lines ("- [x] …") and
 * blank ones give null.
 * @returns {{text: string, est: number | null} | null}
 */
export function parseTaskLine(line) {
  let text = line.trim().replace(/^(?:[-*•+]|\d+[.)])\s+/, "");
  const box = text.match(/^\[([ xX]?)\]\s*/);
  if (box) {
    if (box[1].toLowerCase() === "x") return null;
    text = text.slice(box[0].length);
  }
  let est = null;
  const m = text.match(
    /\s+(?:[x×]\s?(\d{1,2})|\((\d{1,2})\))$|\s*((?:🍅)+)$/iu
  );
  if (m && m.index > 0) {
    est = m[3] ? [...m[3]].length : Number(m[1] ?? m[2]);
    text = text.slice(0, m.index);
  }
  text = text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!text) return null;
  return { text, est: est == null ? null : clampEst(est) };
}

/** Every task in a pasted block of text. */
export function parseTaskLines(text) {
  return text
    .split(/\r?\n/)
    .map(parseTaskLine)
    .filter(t => t != null);
}

export function clampEst(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_EST, Math.max(1, v)) : 1;
}
