// Run with: node --test src/components/widgets/harness/agent.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseReply, rawMessages, runTask, TASKS } from "./agent.js";
import { standIn } from "./llm.js";

test("reads the harness's own call format", () => {
  assert.deepEqual(
    parseReply('{"tool": "read_file", "args": {"path": "config.json"}}'),
    { call: { tool: "read_file", args: { path: "config.json" } } }
  );
});

test("reads Qwen's native tool_call wrapper", () => {
  assert.deepEqual(
    parseReply(
      '<tool_call>\n{"name": "read_file", "arguments": {"path": "a.txt"}}\n</tool_call>'
    ),
    { call: { tool: "read_file", args: { path: "a.txt" } } }
  );
});

test("reads name/arguments without the wrapper", () => {
  assert.deepEqual(
    parseReply('{"name": "calc", "arguments": {"expr": "1+1"}}'),
    {
      call: { tool: "calc", args: { expr: "1+1" } },
    }
  );
});

test("takes an answer in either format", () => {
  assert.deepEqual(parseReply('{"tool": "answer", "args": {"text": "42"}}'), {
    answer: "42",
  });
  assert.deepEqual(
    parseReply(
      '<tool_call>{"name": "answer", "arguments": {"text": "42"}}</tool_call>'
    ),
    { answer: "42" }
  );
  assert.deepEqual(parseReply("ANSWER: 42"), { answer: "42" });
});

test("leaves invalid JSON for the feedback part", () => {
  assert.deepEqual(parseReply('{"tool": "answer", "args": {"oops"}}'), {
    bad: "invalid JSON",
  });
  assert.deepEqual(
    parseReply('<tool_call>{"name": "read_file", "arguments": {</tool_call>'),
    { bad: "invalid JSON" }
  );
});

test("every task fails without its part and passes with it", async () => {
  const model = standIn();
  let carried = [];
  for (const T of TASKS) {
    const without = await runTask(
      T,
      T.sol.filter(p => p !== T.gives),
      model
    );
    carried = [...new Set([...carried, ...T.sol])];
    const alone = await runTask(T, T.sol, model);
    const all = await runTask(T, carried, model);
    assert.equal(without.pass, false, `${T.id} without ${T.gives}`);
    assert.equal(alone.pass, true, `${T.id} with its parts`);
    assert.equal(all.pass, true, `${T.id} with everything so far`);
  }
});

test("the raw view pairs calls with their results", async () => {
  const r = await runTask(TASKS[0], ["tools"], standIn());
  const raw = rawMessages(r.messages);
  assert.equal(raw[0].role, "system");
  const call = raw.find(m => m.tool_calls);
  const result = raw.find(m => m.role === "tool");
  assert.equal(call.content, null);
  assert.equal(call.tool_calls[0].name, "read_file");
  assert.equal(result.tool_call_id, call.tool_calls[0].id);
});
