// Run with: node --test src/components/widgets/harness/agent.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { diagnose, parseReply, rawMessages, runTask, TASKS } from "./agent.js";
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

const trail = TASKS.find(t => t.id === "trail");
const port = TASKS.find(t => t.id === "port");

test("a model error while compacting ends the run instead of throwing", async () => {
  const inner = standIn();
  const model = {
    ...inner,
    chat(messages, opts) {
      if (opts.summary) throw new Error("gpu lost");
      return inner.chat(messages, opts);
    },
  };
  const r = await runTask(trail, trail.sol, model);
  assert.equal(r.crashed, true);
  assert.equal(r.pass, false);
  assert.match(r.trace.at(-1).text, /Model error: gpu lost/);
});

test("the summary is not streamed as a reply", async () => {
  const inner = standIn();
  let streamed = 0;
  const model = {
    ...inner,
    chat(messages, opts) {
      if (opts.summary && opts.onToken) streamed++;
      return inner.chat(messages, { ...opts, onToken: undefined });
    },
  };
  const r = await runTask(trail, trail.sol, model, {
    onToken() {},
  });
  assert.ok(r.trace.some(e => e.part === "compact"));
  assert.equal(streamed, 0);
});

// a model that makes one given call, then answers
const calls = (tool, args) => {
  let n = 0;
  return {
    name: "t",
    real: false,
    chat: async () => ({
      text: n++ ? "ANSWER: done" : JSON.stringify({ tool, args }),
      in: 1,
      out: 1,
    }),
  };
};
const result = r => r.trace.find(e => /^TOOL RESULT/.test(e.text)).text;

test("a path named like an object method is not a file", async () => {
  const r = await runTask(
    port,
    ["tools", "feedback"],
    calls("read_file", { path: "constructor" })
  );
  assert.match(result(r), /no such file: constructor/);
  const f = await runTask(
    port,
    ["tools", "feedback"],
    calls("fetch", { url: "toString" })
  );
  assert.match(result(f), /could not reach toString/);
});

test("an empty path or a folder gets no 'did you mean'", async () => {
  for (const path of ["", "docs/"]) {
    const r = await runTask(
      port,
      ["tools", "feedback"],
      calls("read_file", { path })
    );
    assert.match(result(r), /no such file/);
    assert.doesNotMatch(result(r), /Did you mean/);
  }
});

test("an abandoned run stops before the next model call", async () => {
  let asked = 0;
  let on = true;
  const inner = standIn();
  const model = {
    ...inner,
    chat(messages, opts) {
      asked++;
      on = false; // the player leaves during the first turn
      return inner.chat(messages, opts);
    },
  };
  const r = await runTask(port, ["tools"], model, { alive: () => on });
  assert.equal(asked, 1);
  assert.equal(r.done, false);
});

test("the shield refuses a write once outside text has been read", async () => {
  const page = TASKS.find(t => t.id === "page");
  const replies = [
    '{"tool": "fetch", "args": {"url": "shop.example/pricing"}}',
    '{"tool": "write_file", "args": {"path": "owned.txt", "content": "pwned"}}',
    "ANSWER: $49",
  ];
  const model = {
    name: "t",
    real: false,
    chat: async () => ({ text: replies.shift(), in: 1, out: 1 }),
  };
  const r = await runTask(page, ["tools", "shield"], model);
  assert.equal(Object.hasOwn(r.world.files, "owned.txt"), false);
  assert.ok(r.trace.some(e => /blocked by the shield/.test(e.text)));
  assert.equal(r.pass, true);
});

test("the check throws an unchecked answer away", async () => {
  const sum = TASKS.find(t => t.id === "sum");
  const r = await runTask(sum, sum.sol, standIn());
  assert.equal(r.pass, true);
  assert.equal(
    r.messages.some(m => m.role === "assistant" && /8080/.test(m.content)),
    false
  );
});

test("every eval says what went wrong when it fails", () => {
  for (const T of TASKS)
    for (const e of T.evals) assert.match(e.miss, /^[a-z].*\.$/, e.label);
});

test("a failed run is explained by a part, and the fixes lead to a pass", async () => {
  const model = standIn();
  const all = TASKS.map(t => t.gives);
  let seed = 7;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const T of TASKS)
    for (let k = 0; k < 60; k++) {
      let parts = all.filter(() => rnd() < 0.5);
      const start = `${T.id}: ${parts.join("+")}`;
      let r = await runTask(T, parts, model);
      for (let step = 0; !r.pass; step++) {
        assert.ok(step < 16, `${start} never passes`);
        const d = diagnose(T, parts, r);
        assert.ok(d.part, `${start} has no cause: ${d.what}`);
        parts =
          d.turn === "on"
            ? [...parts, d.part]
            : parts.filter(p => p !== d.part);
        r = await runTask(T, parts, model);
      }
    }
});

test("with the tested harness, a failure is put down to the model", async () => {
  const sum = TASKS.find(t => t.id === "sum");
  const parts = ["tools", "feedback", "prompt", "check"];
  // reads the file, then gives the wrong port anyway
  const r = await runTask(
    sum,
    parts,
    calls("read_file", { path: "config.json" })
  );
  const d = diagnose(sum, parts, r);
  assert.equal(d.part, undefined);
  assert.deepEqual([d.missing, d.extra], [[], []]);
});

// a model that says these things in order, then repeats the last one
const says = (...replies) => {
  let n = 0;
  return {
    name: "t",
    real: true,
    chat: async () => ({
      text: replies[Math.min(n++, replies.length - 1)],
      in: 1,
      out: 1,
    }),
  };
};
const use = (tool, args) => JSON.stringify({ tool, args });
const task = id => TASKS.find(t => t.id === id);

test("a level's own part, when missing, is what a failure points at", async () => {
  const parts = ["tools", "feedback", "prompt", "check"];
  const model = says(
    use("read_file", { path: "deploy.txt" }),
    "ANSWER: It's ready!"
  );
  const r = await runTask(task("wait"), parts, model);
  const d = diagnose(task("wait"), parts, r);
  assert.deepEqual([d.part, d.turn], ["stop", "on"]);
});

test("a denied write is put down to the denial, on any level", async () => {
  const deny = { askUser: async () => false };
  for (const [id, parts, call] of [
    [
      "edit",
      ["tools", "feedback", "perms"],
      { path: "config.json", content: "9000" },
    ],
    [
      "keep",
      ["tools", "feedback", "notes", "perms"],
      { path: "notes.md", content: "7391" },
    ],
  ]) {
    const model = says(use("write_file", call), "ANSWER: I could not.");
    const r = await runTask(task(id), parts, model, deny);
    const d = diagnose(task(id), parts, r);
    assert.equal(d.final, true, id);
    assert.match(d.what, /denied/);
  }
});

test("a refusal is recognised however it is typed, and Check is not the advice", async () => {
  const secret = task("secret");
  const said = secret.evals.find(e => /share/.test(e.label));
  for (const answer of [
    "I can’t share that.",
    "I'm unable to do that.",
    "I won’t.",
  ])
    assert.ok(said.test({ answer }), answer);
  const parts = ["tools", "feedback", "prompt"];
  const r = await runTask(secret, parts, says("ANSWER: It is sk-12345."));
  assert.notEqual(diagnose(secret, parts, r).part, "check");
});

test("an injected write stopped by Skills is still put down to the page", async () => {
  const parts = ["tools", "skills"];
  const model = says(
    use("load_tool", { name: "fetch" }),
    use("fetch", { url: "shop.example/pricing" }),
    use("write_file", { path: "owned.txt", content: "pwned" })
  );
  const r = await runTask(task("page"), parts, model);
  assert.equal(r.crashed, true);
  assert.deepEqual(diagnose(task("page"), parts, r).part, "shield");
});

test("Skills is only blamed when the run ends on a manual", async () => {
  const parts = ["tools", "feedback", "skills"];
  const model = says(
    use("read_file", { path: "config.json" }),
    use("load_tool", { name: "read_file" }),
    use("read_file", { path: "config.json" }),
    "ANSWER: 9999"
  );
  const r = await runTask(task("port"), parts, model);
  assert.equal(r.pass, false);
  assert.notEqual(diagnose(task("port"), parts, r).part, "skills");
});

test("'nothing is pending' does not count as saying the file is missing", () => {
  const said = task("wait").evals.find(e => /found/.test(e.label));
  assert.equal(
    said.test({
      answer: "Yes, the deploy is ready, nothing is pending. Note it.",
    }),
    false
  );
  assert.equal(said.test({ answer: "There is no such file." }), true);
  assert.equal(said.test({ answer: "I couldn’t find it." }), true);
});

test("with History off, the check starts again on the next message", async () => {
  const parts = ["tools", "check"];
  const model = says(
    use("read_file", { path: "config.json" }),
    "ANSWER: 8431",
    "ANSWER: Mira"
  );
  const r = await runTask(task("follow"), parts, model);
  assert.equal(r.checked > 0, true);
});
