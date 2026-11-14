// Run with: node --test src/components/widgets/focus-todos.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  assignTodos,
  fmtSessions,
  makeTodo,
  parseTaskLine,
  parseTaskLines,
  sessionsLeft,
  sessionsSpent,
} from "./focus-todos.js";

const todo = (text, est, spentMin = 0, doneAt = null) => ({
  ...makeTodo(text),
  est,
  spentMin,
  doneAt,
});
const focus = (label = "", extra = {}) => ({ kind: "focus", label, ...extra });
const brk = () => ({ kind: "short", label: "" });
const labels = blocks =>
  blocks.filter(b => b.kind === "focus").map(b => b.label);

test("spent sessions round to halves", () => {
  assert.equal(sessionsSpent(todo("a", 3, 37), 25), 1.5);
  assert.equal(sessionsSpent(todo("a", 3, 5), 25), 0);
  assert.equal(fmtSessions(1.5), "1½");
  assert.equal(fmtSessions(0.5), "½");
  assert.equal(fmtSessions(2), "2");
});

test("an open task always has at least one session left", () => {
  assert.equal(sessionsLeft(todo("a", 2, 25), 25), 1);
  assert.equal(sessionsLeft(todo("a", 1, 50), 25), 1);
  assert.equal(sessionsLeft(todo("a", 3, 0), 25), 3);
});

test("fills focus blocks in list order by sessions left", () => {
  const blocks = [focus(), brk(), focus(), brk(), focus(), brk(), focus()];
  const todos = [todo("intro", 2), todo("done", 1, 25, 1), todo("bug", 1)];
  assignTodos(blocks, 0, todos, { focusMin: 25 });
  assert.deepEqual(labels(blocks), ["intro", "intro", "bug", ""]);
});

test("the current task goes first, minus the block it's in", () => {
  const blocks = [focus("bug"), brk(), focus(), brk(), focus()];
  const todos = [todo("intro", 1), todo("bug", 2)];
  todos[1].id = "cur";
  assignTodos(blocks, 1, todos, {
    currentId: "cur",
    focusMin: 25,
    currentInBlock: true,
  });
  assert.deepEqual(labels(blocks), ["bug", "bug", "intro"]);
});

test("blocks renamed by hand keep their names", () => {
  const blocks = [focus("email", { manual: true }), brk(), focus()];
  assignTodos(blocks, 0, [todo("intro", 2)], { focusMin: 25 });
  assert.deepEqual(labels(blocks), ["email", "intro"]);
});

test("no open tasks leaves labels alone", () => {
  const blocks = [focus("typed")];
  assert.equal(assignTodos(blocks, 0, [], { focusMin: 25 }), false);
  assert.deepEqual(labels(blocks), ["typed"]);
});

test("reads pasted lists from other apps", () => {
  const pasted = [
    "- [ ] write intro x2",
    "- [x] already done",
    "* fix bug (3)",
    "1. email 🍅🍅",
    "",
    "  plain   line  ",
    "• tidy desk ×1",
    "box 2x4",
  ].join("\n");
  assert.deepEqual(parseTaskLines(pasted), [
    { text: "write intro", est: 2 },
    { text: "fix bug", est: 3 },
    { text: "email", est: 2 },
    { text: "plain line", est: null },
    { text: "tidy desk", est: 1 },
    { text: "box 2x4", est: null },
  ]);
});

test("a line that is only an estimate stays as text", () => {
  assert.deepEqual(parseTaskLine("x2"), { text: "x2", est: null });
  assert.deepEqual(parseTaskLine("(2)"), { text: "(2)", est: null });
});
