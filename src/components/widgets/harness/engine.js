// The campaign's emulated agent. Pure logic, no DOM: given a level and where
// the player put their chips, play the run out and return a list of events
// for the UI to animate, plus the score.
//
// The model only ever looks at its window. Everything that goes wrong (or
// right) follows from what is in there when it is called.

export const CELL = 10; // tokens per window cell at full price
export const FOCUS = 6; // cells past the task before dull steps get skipped
const HARD_TURNS = 24;
export const TOOLS = [
  "read",
  "search",
  "edit",
  "bash",
  "web",
  "push",
  "chat",
  "db",
  "cloud",
];

const DEF_SIZE = { db: 3, cloud: 3 };
const TRIM_KEEP = [
  { size: 2, ends: ["head"] },
  { size: 2, ends: ["tail"] },
  { size: 4, ends: ["head", "tail"] },
];

class End {
  constructor(ok, reason, info) {
    this.ok = ok;
    this.reason = reason;
    this.info = info || {};
  }
}

export function simulate(level, placed) {
  const N = level.window;
  const tiles = level.tiles;
  const ev = [];

  // --- where the chips are ---
  const bot = new Map();
  const onTile = tiles.map(() => new Map());
  const onFlag = new Map();
  const onStart = new Map();
  const onTrap = new Map();
  let compactAt = 0;
  for (const p of placed) {
    const set = p.set || 0;
    if (p.at === "bot") bot.set(p.chip, set);
    else if (p.at === "flag") onFlag.set(p.chip, set);
    else if (p.at === "start") onStart.set(p.chip, set);
    else if (p.at === "trap") onTrap.set(p.chip, set);
    else if (p.at[0] === "c") compactAt = +p.at.slice(1);
    else if (onTile[+p.at.slice(1)]) onTile[+p.at.slice(1)].set(p.chip, set);
  }

  // --- run state ---
  let win = [];
  let uid = 0;
  let pos = 0;
  let turns = 0;
  let tokens = 0;
  let hearts = level.hearts ?? 2;
  let prevIds = [];
  let lazy = null;
  let broken = null;
  let pendingFix = null;
  let cp = null;
  const tries = tiles.map(() => 0);
  const runs = tiles.map(() => 0);
  const fixed = tiles.map(() => false);
  const altUsed = tiles.map(() => false);
  const flubbed = tiles.map(() => false);
  const skipped = [];
  const refetch = {};

  const snap = () =>
    win.map(b => ({ ...b, gems: b.gems.map(g => ({ ...g })) }));
  const fill = () => win.reduce((n, b) => n + b.size, 0);
  const emit = (t, d = {}) =>
    ev.push({ t, ...d, win: snap(), tokens, hearts, turns, fill: fill() });
  const block = (kind, size, extra = {}) => ({
    id: ++uid,
    kind,
    size,
    gems: [],
    ...extra,
  });
  const has = g => win.some(b => b.gems.some(x => x.g === g));
  const eff = i => (altUsed[i] ? { ...tiles[i], ...tiles[i].alt } : tiles[i]);
  const hasTodo = () => bot.has("todo");
  const fail = (reason, info) => {
    throw new End(false, reason, info);
  };

  function push(b, why) {
    const todo = win.findIndex(x => x.kind === "todo");
    if (todo >= 0) win.splice(todo, 0, b);
    else win.push(b);
    emit("drop", { id: b.id, why });
  }

  function charge(mult = 1, what = "turn") {
    turns++;
    const ids = win.map(b => b.id);
    let cached = 0;
    if (bot.has("cache")) {
      for (let i = 0; i < win.length && ids[i] === prevIds[i]; i++)
        cached += win[i].size;
    }
    const cost = Math.round(((fill() - cached) * CELL + cached) * mult);
    tokens += cost;
    prevIds = ids;
    emit("call", { cost, cached, what, small: mult < 1 });
    if (turns > HARD_TURNS) fail("runaway");
  }

  function heart() {
    hearts--;
    emit("ask");
    if (hearts < 0) fail("annoyed");
  }

  function overflowCheck() {
    if (fill() > N) fail("overflow", { fill: fill() });
  }

  function compact() {
    const keep = b =>
      b.pinned || b.kind === "def" || b.kind === "notes" || b.kind === "todo";
    const squash = win.filter(b => !keep(b));
    if (squash.reduce((n, b) => n + b.size, 0) <= 1) return;
    charge(1, "compact");
    const gems = [];
    const lost = [];
    for (const b of squash)
      for (const g of b.gems) (g.exact ? lost : gems).push({ ...g });
    const sum = block("summary", 1, { gems });
    const todo = win.filter(b => b.kind === "todo");
    win = [...win.filter(b => keep(b) && b.kind !== "todo"), sum, ...todo];
    emit("compact", {
      id: sum.id,
      lost: lost.map(g => g.g),
      lostTask: squash.some(b => b.kind === "task"),
    });
  }

  function afterDrops() {
    overflowCheck();
    if (compactAt && fill() >= compactAt) compact();
  }

  function runCheck(where) {
    const red = broken != null;
    push(block("test", 2, { red }), "check");
    emit("check", { red, where });
    overflowCheck();
    if (!red) return;
    emit("reveal", { tile: broken, what: "bad" });
    if (tiles[broken].corrupt) {
      if (cp && cp.at <= broken) {
        win = cp.win.map(b => ({ ...b, gems: b.gems.map(g => ({ ...g })) }));
        win.push(block("err", 1, { label: "lesson" }));
        pos = cp.pos;
        fixed[broken] = true;
        broken = null;
        emit("rewind", { to: cp.pos });
      } else fail("corrupt", { late: !!cp, tile: broken });
    } else pendingFix = broken;
  }

  // One tile's tool call. Returns true when the bot may carry on to the next
  // tile in the same turn (only matters for fan-out groups).
  function perform(j, group) {
    const T = eff(j);
    const chips = onTile[j];
    if (group) {
      if (!bot.has(T.tool) || (bot.get(T.tool) === 1 && lazy !== T.tool))
        return false;
      const inGroup = g => group.some(k => eff(k).gem === g);
      if (T.needs?.some(inGroup)) {
        push(block("err", 1, { label: "dep" }), "dep");
        emit("say", { text: "needed that first", tile: j });
        return false;
      }
      if (T.needs?.some(g => !has(g))) return false;
      if (T.tool === "sleep" || T.dull) return false;
    }

    // permissions
    const sandbox = bot.has("sandbox");
    if (T.danger) {
      emit("reveal", { tile: j, what: "danger" });
      if (chips.has("wall") || chips.has("gate")) {
        if (!chips.has("wall")) heart();
        push(block("err", 1, { label: "denied" }), "denied");
        emit("say", { text: "denied", tile: j });
        if (j === pos) pos++;
        return true;
      }
      if (!sandbox) fail("damage", { tile: j });
      emit("say", { text: "contained", tile: j });
    } else if (T.amber) {
      if (chips.has("wall")) fail("blocked", { tile: j });
      if (!chips.has("gate"))
        fail(sandbox ? "boxed" : "unapproved", { tile: j });
      heart();
    } else {
      if (chips.has("wall")) fail("blocked", { tile: j });
      if (chips.has("gate")) heart();
    }

    // errors
    tries[j]++;
    if (tries[j] <= (T.err || 0)) {
      emit("reveal", { tile: j, what: "err" });
      if (!bot.has("catch")) fail("crash", { tile: j });
      // repeated failures of the same call stack up in one block
      const last = win.findLast(b => b.kind !== "todo");
      if (last?.label === "error" && last.tile === j) {
        last.count++;
        emit("drop", { id: last.id, why: "error" });
      } else
        push(block("err", 1, { label: "error", tile: j, count: 1 }), "error");
      emit("say", { text: "error", tile: j });
      const cap = chips.has("stop") ? chips.get("stop") + 1 : 0;
      if (cap && tries[j] >= cap) {
        if (tiles[j].alt && !altUsed[j]) {
          altUsed[j] = true;
          tries[j] = 0;
          emit("alt", { tile: j });
        } else fail("gaveup", { tile: j });
      }
      return false;
    }

    // success: the result lands in the window
    runs[j]++;
    let size = T.size;
    const gems = [];
    const at = T.at || "head";
    let cut = false;
    if (chips.has("trim")) {
      const k = TRIM_KEEP[chips.get("trim")];
      if (size > k.size) {
        size = k.size;
        cut = !k.ends.includes(at);
      }
    }
    if (T.gem && !cut) gems.push({ g: T.gem, exact: !!T.exact, at });
    const b = block("result", size, {
      gems,
      tile: j,
      tool: T.tool,
      cut,
      trimmed: size < T.size,
    });
    if (chips.has("pin")) b.pinned = true;
    if (T.spiky) {
      b.spiky = true;
      emit("reveal", { tile: j, what: "spiky" });
    }
    if (chips.has("shield")) {
      b.shielded = true;
      b.size += 1;
    }
    push(b, "result");
    if (T.gem) emit("reveal", { tile: j, what: "at" });

    if ((T.bad || T.corrupt) && !fixed[j]) {
      if (runs[j] === 1) broken = j;
      else if (T.bad) {
        fixed[j] = true;
        if (broken === j) broken = null;
      }
    }
    if (chips.has("note") && T.gem && !cut) {
      let notes = win.find(x => x.kind === "notes");
      if (!notes) {
        notes = block("notes", 0);
        const after = win.findLastIndex(x => x.kind === "def");
        win.splice(after + 1, 0, notes);
      }
      if (!notes.gems.some(g => g.g === T.gem)) {
        notes.size += 1;
        notes.gems.push({ g: T.gem, exact: !!T.exact, at: "head" });
        emit("note", { id: notes.id });
      }
    }
    if (j === pos) pos++;
    if (chips.has("check")) runCheck(j);
    return true;
  }

  function scout(i) {
    let span = 0;
    const want = onTile[i].get("scout") + 1;
    const got = [];
    for (let j = i; j < tiles.length && span < want; j++) {
      const T = tiles[j];
      const plain =
        !T.danger && !T.amber && !T.err && !T.bad && !T.corrupt && !T.dull;
      const fed = (T.needs || []).every(g => has(g) || got.includes(g));
      if (!plain || !fed || T.tool === "sleep" || !bot.has(T.tool)) break;
      if (T.gem) got.push(T.gem);
      span++;
    }
    if (!span) return false;
    charge(1, "delegate");
    emit("hop", { to: i });
    let sub = 2; // the scout's own window: one tool, the task
    let subTok = 0;
    const gems = [];
    for (let j = i; j < i + span; j++) {
      const T = tiles[j];
      subTok += sub * CELL;
      let size = T.size;
      let cut = false;
      if (onTile[j].has("trim")) {
        const k = TRIM_KEEP[onTile[j].get("trim")];
        if (size > k.size) {
          size = k.size;
          cut = !k.ends.includes(T.at || "head");
        }
      }
      sub += size;
      runs[j]++;
      emit("scout", { tile: j, sub });
      if (sub > N) fail("scoutflood", { tile: j });
      if (T.gem && !cut && !T.exact)
        gems.push({ g: T.gem, exact: false, at: "head" });
      if (T.gem) emit("reveal", { tile: j, what: "at" });
    }
    subTok += sub * CELL;
    tokens += subTok;
    pos = i + span;
    emit("hop", { to: i + span - 1 });
    push(block("summary", 1, { gems, scout: true }), "scout");
    afterDrops();
    return true;
  }

  function exec(i, back) {
    const T = eff(i);
    if (!bot.has("loop")) {
      charge();
      emit("reach", { to: i });
      fail("noloop");
    }
    if (!bot.has(T.tool)) {
      charge();
      emit("reach", { to: i });
      fail("notool", { tool: T.tool, tile: i });
    }
    if (bot.get(T.tool) === 1 && lazy !== T.tool) {
      charge(1, "load");
      win = win.filter(b => !(b.kind === "def" && b.lazy));
      const d = block("def", DEF_SIZE[T.tool] || 1, {
        tool: T.tool,
        lazy: true,
      });
      const after = win.findLastIndex(x => x.kind === "def");
      win.splice(after + 1, 0, d);
      lazy = T.tool;
      emit("load", { id: d.id, tool: T.tool });
      overflowCheck();
      return;
    }
    if (onTile[i].has("rewind") && !cp && !back)
      cp = { at: i, pos: i, win: snap() };
    if (onTile[i].has("scout") && !back && scout(i)) return;

    const routed = onTile[i].has("router") && !flubbed[i];
    charge(routed ? 0.2 : 1);
    emit("hop", { to: i, back });
    if (routed && (T.needs || []).length >= 2) {
      flubbed[i] = true;
      push(block("err", 1, { label: "flub" }), "flub");
      emit("say", { text: "too much for the small model", tile: i });
      overflowCheck();
      return;
    }
    const group = [];
    const span = onTile[i].has("fan") && !back ? onTile[i].get("fan") + 2 : 1;
    for (let j = i; j < Math.min(tiles.length, i + span); j++) {
      if (j > i) emit("hop", { to: j, fan: true });
      const ok = perform(j, j > i ? group : null);
      if (!ok) break;
      group.push(j);
    }
    afterDrops();
  }

  function need(list, at) {
    const miss = (list || []).find(g => !has(g));
    if (!miss) return false;
    const src = tiles.findIndex((t, k) => eff(k).gem === miss);
    if (src < 0 || tiles[src].once) {
      charge();
      fail("amnesia", { gem: miss, tile: src });
    }
    refetch[miss] = (refetch[miss] || 0) + 1;
    if (refetch[miss] > 2) {
      charge();
      const chips = onTile[src];
      const t = tiles[src];
      const cut =
        chips.has("trim") &&
        t.size > TRIM_KEEP[chips.get("trim")].size &&
        !TRIM_KEEP[chips.get("trim")].ends.includes(t.at || "head");
      fail("loop", { gem: miss, tile: src, cut, at });
    }
    emit("miss", { gem: miss, tile: src });
    exec(src, true);
    return true;
  }

  function step() {
    // an order hiding in a tool result
    const sp = win.find(b => b.spiky && !b.shielded && !b.spent);
    if (sp) {
      charge();
      emit("hop", { to: "trap" });
      sp.spent = true;
      if (onTrap.has("wall") || onTrap.has("gate")) {
        if (!onTrap.has("wall")) heart();
        push(block("err", 1, { label: "denied" }), "denied");
        emit("say", { text: "denied", tile: "trap" });
        return;
      }
      if (bot.has("sandbox")) {
        emit("say", { text: "contained", tile: "trap" });
        return;
      }
      fail("injected", { tile: sp.tile });
    }
    if (!win.some(b => b.kind === "task" || b.kind === "todo")) {
      charge();
      fail("forgot");
    }
    if (pendingFix != null) {
      const j = pendingFix;
      pendingFix = null;
      return exec(j, true);
    }
    if (pos >= tiles.length) {
      if (need(level.goal, "flag")) return;
      charge(1, "done");
      if (onFlag.has("check")) {
        runCheck("flag");
        if (pos < tiles.length || pendingFix != null) return;
      }
      if (broken != null) fail("broken", { tile: broken });
      if (skipped.length) fail("skipped", { tiles: skipped });
      emit("hop", { to: "flag" });
      throw new End(true, "done");
    }
    const T = eff(pos);
    if (T.tool === "sleep") {
      win = win.filter(
        b => (b.kind === "def" && !b.lazy) || b.kind === "notes"
      );
      lazy = null;
      prevIds = [];
      emit("hop", { to: pos });
      emit("sleep");
      push(block("task", 1, { gems: [] }), "task");
      if (hasTodo()) win.push(block("todo", 1));
      pos++;
      return;
    }
    if (T.dull && !hasTodo()) {
      const t = win.findIndex(b => b.kind === "task");
      const after = win.slice(t + 1).reduce((n, b) => n + b.size, 0);
      if (after >= FOCUS) {
        skipped.push(pos);
        emit("skip", { tile: pos });
        pos++;
        return;
      }
    }
    if (need(T.needs, pos)) return;
    exec(pos, false);
  }

  // --- go ---
  let end;
  try {
    for (const [chip, set] of bot) {
      if (TOOLS.includes(chip) && set === 0)
        win.push(block("def", DEF_SIZE[chip] || 1, { tool: chip }));
    }
    win.push(block("task", 1, { pinned: onStart.has("pin") }));
    if (hasTodo()) win.push(block("todo", 1));
    emit("start");
    overflowCheck();
    for (let guard = 0; guard < 200; guard++) step();
    fail("runaway");
  } catch (e) {
    if (!(e instanceof End)) throw e;
    end = e;
  }

  const lostHearts = (level.hearts ?? 2) - Math.max(hearts, 0);
  const stars = end.ok
    ? 1 +
      (tokens <= level.par ? 1 : 0) +
      (lostHearts <= (level.heartPar || 0) ? 1 : 0)
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
    lostHearts,
    stars,
  };
}
