// The emulated agent. Pure logic, no DOM: given a job and the set of harness
// parts that are connected, play the run out and return the events for the UI
// to animate, plus the score.
//
// The model only ever sees its window. A part changes what is in the window,
// what the model can reach, or what happens around a call. Everything that
// goes wrong follows from those two things.

export const CELL = 10; // tokens per window cell at full price
export const ROT = 0.75; // window share past which dull steps get dropped
export const SQUASH = 0.7; // window share at which Compaction fires
export const BIG = 4; // results larger than this are parked in a file
const HARD_TURNS = 30;

// Cells a connected part keeps in the window for the whole run.
const STANDING = { prompt: 1, tools: 1, shell: 1, mcp: 2, files: 1, skills: 1 };
const CHECKS = [
  { part: "tests", bug: "logic", size: 1 },
  { part: "shots", bug: "ui", size: 2 },
  { part: "logs", bug: "runtime", size: 1 },
];

class End {
  constructor(ok, reason, info = {}) {
    this.ok = ok;
    this.reason = reason;
    this.info = info;
  }
}

export function simulate(job, parts) {
  const on = new Set(parts);
  const has = p => on.has(p);
  const N = job.window;
  const steps = job.steps;
  const lore = job.lore || {};
  const ev = [];
  const used = new Set();

  let win = [];
  let uid = 0;
  let pos = 0;
  let turns = 0;
  let tokens = 0;
  let hearts = job.hearts ?? 1;
  let prevIds = [];
  let bug = null; // { kind, step, corrupt }
  let checkpoint = null;
  let loadedSkill = null;
  let quitRestarts = 0;
  let poisoned = false;
  const checked = new Set();
  const done = []; // facts recorded in the progress file
  const refetch = {};
  const skipped = [];
  const ran = steps.map(() => 0);

  const snap = () => win.map(b => ({ ...b, facts: [...b.facts] }));
  const fill = () => win.reduce((n, b) => n + b.size, 0);
  const emit = (t, d = {}) =>
    ev.push({ t, ...d, win: snap(), tokens, hearts, turns, fill: fill() });
  const block = (kind, size, extra = {}) => ({
    id: ++uid,
    kind,
    size,
    facts: [],
    ...extra,
  });
  const sees = f => win.some(b => b.facts.includes(f));
  const fail = (reason, info) => {
    throw new End(false, reason, info);
  };
  const use = p => {
    used.add(p);
    return p;
  };

  // What sits in the window at the start of every session.
  function standing() {
    const out = [];
    if (has("prompt")) {
      const facts = Object.keys(lore).filter(
        f => lore[f].from.includes("prompt") && !provider(f, true)
      );
      const size =
        STANDING.prompt + facts.reduce((n, f) => n + (lore[f].stuffed ?? 2), 0);
      out.push(block("prompt", size, { part: "prompt", facts }));
    }
    for (const p of ["tools", "shell", "mcp", "files"])
      if (has(p)) out.push(block("def", STANDING[p], { part: p }));
    if (has("memory")) {
      const facts = Object.keys(lore).filter(f =>
        lore[f].from.includes("memory")
      );
      out.push(block("memory", 1, { part: "memory", facts }));
    }
    if (has("skills")) out.push(block("skills", 1, { part: "skills" }));
    if (has("progress") && has("files"))
      out.push(block("progress", 1, { part: "progress", facts: [...done] }));
    return out;
  }
  // The cheaper source of a piece of know-how, if one is connected.
  function provider(f, besidesPrompt) {
    const from = lore[f]?.from || [];
    for (const p of ["memory", "skills"])
      if (from.includes(p) && has(p)) return p;
    if (!besidesPrompt && from.includes("prompt") && has("prompt"))
      return "prompt";
    return null;
  }

  function push(b, why) {
    win.push(b);
    emit("drop", { id: b.id, why });
  }

  function charge(what = "turn", mult = 1) {
    turns++;
    const ids = win.map(b => b.id);
    let cached = 0;
    if (has("cache")) {
      for (let i = 0; i < win.length && ids[i] === prevIds[i]; i++)
        cached += win[i].size;
      if (cached) use("cache");
    }
    const cost = Math.round(((fill() - cached) * CELL + cached) * mult);
    tokens += cost;
    prevIds = ids;
    emit("call", { cost, cached, what, small: mult < 1 });
    if (job.deadline && turns > job.deadline) fail("late");
    if (turns > HARD_TURNS) fail("runaway");
  }

  function heart(why) {
    hearts--;
    use("perms");
    emit("ask", { why });
    if (hearts < 0) fail("annoyed");
  }

  function settle() {
    if (fill() > N) fail("overflow", { fill: fill() });
    if (has("compact") && fill() / N >= SQUASH) {
      const loose = win.filter(b =>
        ["result", "edit", "summary", "check", "err"].includes(b.kind)
      );
      if (loose.reduce((n, b) => n + b.size, 0) > 1) {
        emit("signal", { from: "compact", to: "model" });
        charge("compact");
        use("compact");
        const facts = [...new Set(loose.flatMap(b => b.facts))];
        const sum = block("summary", 1, { facts, part: "compact" });
        win = [...win.filter(b => !loose.includes(b)), sum];
        emit("compact", { id: sum.id });
      }
    }
  }

  function note(fact) {
    if (!fact || !has("progress") || !has("files")) return;
    if (done.includes(fact)) return;
    done.push(fact);
    use("progress");
    const b = win.find(x => x.kind === "progress");
    if (b && !b.facts.includes(fact)) b.facts.push(fact);
    emit("signal", { from: "model", to: "progress" });
  }

  function newSession(why) {
    win = standing();
    win.push(block("task", 1));
    prevIds = [];
    loadedSkill = null;
    emit("fresh", { why });
    if (win.some(b => b.kind === "progress" && b.facts.length))
      emit("signal", { from: "progress", to: "model" });
  }

  // A risky call. Returns "skip" when the call is refused.
  function guard(S) {
    if (!S.risky) return "go";
    if (S.risky === "danger") {
      if (has("sandbox")) {
        use("sandbox");
        emit("say", { text: "contained", part: "sandbox" });
        return "go";
      }
      if (has("perms")) {
        heart("danger");
        emit("say", { text: "denied", part: "perms" });
        return "skip";
      }
      fail("damage", { step: pos });
    }
    // needs the outside world, and a person's say-so
    if (!has("perms")) fail(has("sandbox") ? "boxed" : "unapproved");
    heart("outside");
    return "go";
  }

  function result(S, i) {
    let size = S.size ?? 1;
    const facts = S.fact ? [S.fact] : [];
    let parked = false;
    if (has("files") && size > BIG) {
      // keep the head and the tail, park the rest in a file
      use("files");
      parked = true;
      size = 2;
      if (S.at === "mid") facts.length = 0;
      emit("signal", { from: "model", to: "files" });
    }
    const b = block("result", size, {
      facts,
      step: i,
      part: S.tool,
      parked,
    });
    if (S.hostile) {
      b.hostile = true;
      if (has("shield")) {
        use("shield");
        b.shielded = true;
      } else poisoned = true;
    }
    return b;
  }

  // Exploring, fanned out: one helper per topic, each in its own small
  // window, all at once. One cell comes back from each, and the whole fan-out
  // takes the main agent a single turn.
  function delegate() {
    const tool = steps[pos].tool || "tools";
    if (!has(tool)) {
      charge();
      fail("notool", { part: tool });
    }
    use(tool);
    emit("signal", { from: "model", to: "subs" });
    charge("delegate");
    use("subs");
    while (pos < steps.length && steps[pos].explore) {
      const topic = steps[pos].explore;
      let sub = 2;
      const facts = [];
      for (; steps[pos]?.explore === topic; pos++) {
        tokens += sub * CELL;
        sub += steps[pos].size ?? 1;
        ran[pos]++;
        emit("sub", { step: pos, sub });
        if (sub > N) fail("subflood");
        if (steps[pos].fact) facts.push(steps[pos].fact);
      }
      tokens += sub * CELL;
      emit("signal", { from: "subs", to: "model" });
      push(block("summary", 1, { facts, part: "subs" }), "subs");
      for (const f of facts) note(f);
    }
    settle();
  }

  function act(i, again) {
    const S = steps[i];
    const tool = S.tool || "tools";
    if (!has(tool)) {
      charge();
      fail("notool", { part: tool });
    }
    use(tool);
    const g = guard(S);
    const easy = S.easy && has("router");
    if (easy) use("router");
    emit("signal", { from: "model", to: tool });
    charge("turn", easy ? 0.2 : 1);
    if (g === "skip") {
      push(block("err", 1, { part: "perms" }), "denied");
    } else {
      ran[i]++;
      emit("signal", { from: tool, to: "model" });
      if (again && win.some(b => b.step === i && b.parked)) {
        // a second look at a parked result is a targeted read
        push(block("result", 1, { facts: [S.fact], step: i, part: tool }));
      } else push(result(S, i), "result");
      if (S.edit) {
        if (has("git") && !checkpoint && !again)
          checkpoint = { win: snap(), pos: i, done: [...done] };
        if (S.bad && ran[i] === 1)
          bug = { kind: S.bad, step: i, corrupt: !!S.corrupt };
        else if (bug?.step === i && !bug.corrupt) bug = null;
      }
      note(S.fact);
    }
    if (!again && i === pos) pos++;
    settle();
  }

  // Returns true if it spent the turn fetching something it had lost.
  function need(list) {
    for (const f of list || []) {
      if (sees(f)) continue;
      if (lore[f]) {
        const p = provider(f);
        if (p === "skills" && loadedSkill !== f) {
          emit("signal", { from: "skills", to: "model" });
          charge("load");
          use("skills");
          win = win.filter(b => b.kind !== "skill");
          win.push(block("skill", 2, { facts: [f], part: "skills" }));
          loadedSkill = f;
          emit("drop", { why: "skill" });
          settle();
          return true;
        }
        if (!p) {
          charge();
          fail("unknown", { fact: f, from: lore[f].from });
        }
        continue;
      }
      const src = steps.findIndex(s => s.fact === f);
      if (src < 0 || steps[src].once || src >= pos) {
        charge();
        fail("amnesia", { fact: f });
      }
      refetch[f] = (refetch[f] || 0) + 1;
      if (refetch[f] > 2) {
        charge();
        fail("loop", { fact: f });
      }
      emit("miss", { fact: f });
      act(src, true);
      return true;
    }
    return false;
  }

  function finish() {
    if (need(job.goal)) return;
    // run whatever checks are connected, then fix what they find
    for (const c of CHECKS) {
      if (!has(c.part) || checked.has(c.part)) continue;
      checked.add(c.part);
      emit("signal", { from: "model", to: c.part });
      charge("check");
      emit("signal", { from: c.part, to: "model" });
      const red = bug?.kind === c.bug;
      push(block("check", c.size, { part: c.part, red }), "check");
      emit("say", { text: red ? "that's wrong" : "looks right", part: c.part });
      if (red) {
        use(c.part);
        if (bug.corrupt) {
          if (!checkpoint) fail("stuck", { step: bug.step });
          use("git");
          emit("signal", { from: "git", to: "model" });
          win = checkpoint.win.map(b => ({ ...b, facts: [...b.facts] }));
          win.push(block("err", 1, { part: "git" }));
          pos = checkpoint.pos;
          bug = null;
          checked.delete(c.part);
          emit("rewind");
        } else {
          act(bug.step, true);
          checked.delete(c.part);
        }
      }
      settle();
      return;
    }
    charge("done");
    if (bug) fail("broken", { kind: bug.kind });
    if (skipped.length) fail("skipped", { steps: skipped });
    throw new End(true, "done");
  }

  function step() {
    // an order hiding in something it read
    if (poisoned) {
      poisoned = false;
      charge();
      if (has("sandbox")) {
        use("sandbox");
        emit("say", { text: "contained", part: "sandbox" });
        return;
      }
      if (has("perms")) {
        heart("hostile");
        emit("say", { text: "denied", part: "perms" });
        return;
      }
      fail("injected");
    }
    if (pos >= steps.length) return finish();
    const S = steps[pos];

    if (S.t === "user") {
      if (!has("convo")) {
        // every message arrives on its own
        win = [...standing(), block("task", 1)];
        prevIds = [];
        emit("fresh", { why: "stateless" });
        if ((S.needs || []).some(f => !sees(f))) {
          charge();
          fail("lostthread");
        }
      } else {
        use("convo");
        emit("signal", { from: "convo", to: "model" });
        push(block("task", 1), "user");
      }
      pos++;
      return;
    }
    if (S.t === "sleep") {
      newSession("sleep");
      pos++;
      return;
    }
    if (S.t === "quit") {
      if (!has("loop")) {
        charge("done");
        fail("quit");
      }
      use("loop");
      emit("signal", { from: "loop", to: "model" });
      newSession("loop");
      pos++;
      if (!(has("progress") && has("files"))) {
        pos = 0;
        if (++quitRestarts > 1) fail("lostplace");
      }
      return;
    }
    if (S.dull && fill() / N >= ROT && !(has("progress") && has("files"))) {
      skipped.push(pos);
      emit("skip", { step: pos });
      pos++;
      return;
    }
    if (need(S.needs)) return;
    if (S.t === "write") {
      if (!has("files")) {
        charge();
        fail("nofile");
      }
      use("files");
      charge();
      emit("signal", { from: "model", to: "files" });
      push(block("edit", 1, { part: "files" }), "write");
      pos++;
      return settle();
    }
    if (S.explore && has("subs")) return delegate();
    act(pos, false);
  }
  let end;
  try {
    win = standing();
    win.push(block("task", 1));
    emit("start");
    for (const b of win)
      if (["prompt", "memory"].includes(b.kind) && b.facts.length) use(b.part);
    if (fill() > N) fail("overflow", { fill: fill() });
    for (let guard = 0; guard < 300; guard++) step();
    fail("runaway");
  } catch (e) {
    if (!(e instanceof End)) throw e;
    end = e;
  }

  const lost = (job.hearts ?? 1) - Math.max(hearts, 0);
  const stars = end.ok
    ? 1 + (tokens <= job.par ? 1 : 0) + (lost <= (job.asks || 0) ? 1 : 0)
    : 0;
  emit("end", { ok: end.ok, reason: end.reason, info: end.info, stars });
  return {
    events: ev,
    ok: end.ok,
    reason: end.reason,
    info: end.info,
    tokens,
    turns,
    hearts,
    lost,
    stars,
    used: [...used],
  };
}
