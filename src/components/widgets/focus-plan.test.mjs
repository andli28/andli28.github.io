// Run with: node --test src/components/widgets/focus-plan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, summarizePlan } from "./focus-plan.js";

const MIN = 60_000;
const S = { focus: 25, short: 5, long: 15, every: 4 };
const shape = blocks =>
  blocks.map(b => `${b.kind}:${Math.round((b.end - b.start) / MIN)}`);

test("fills an hour with focus, breaks and a wrap-up", () => {
  assert.deepEqual(shape(buildPlan(0, 58 * MIN, S)), [
    "focus:25",
    "short:5",
    "focus:25",
    "wrap:3",
  ]);
});

test("focusDone carries the long-break cadence on", () => {
  const plan = buildPlan(0, 120 * MIN, S, "", { focusDone: 3 });
  assert.equal(plan[1].kind, "long");
});

test("breakFirst opens with that break", () => {
  assert.deepEqual(
    shape(buildPlan(0, 60 * MIN, S, "", { breakFirst: "long" })).slice(0, 2),
    ["long:15", "focus:25"]
  );
});

test("breakFirst with no room for focus after it becomes a wrap-up", () => {
  assert.deepEqual(
    shape(buildPlan(0, 12 * MIN, S, "", { breakFirst: "short" })),
    ["wrap:12"]
  );
});

test("summary groups equal lengths", () => {
  const rows = summarizePlan(buildPlan(0, 58 * MIN, S));
  assert.deepEqual(rows, [
    { label: "focus", value: "2 × 25m" },
    { label: "breaks", value: "1 × 5m" },
    { label: "wrap up", value: "3m" },
  ]);
});

test("summary lists mixed lengths separately", () => {
  // Four focus blocks earn a long break; the window cuts the last focus short.
  const rows = summarizePlan(buildPlan(0, 150 * MIN, S));
  assert.deepEqual(rows, [
    { label: "focus", value: "4 × 25m + 1 × 20m" },
    { label: "breaks", value: "3 × 5m + 1 × 15m" },
  ]);
});
