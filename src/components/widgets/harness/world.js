// The map: six branches around the model, and the parts in each. A part has a
// price in stars, a one-line description of what it does and what it costs in
// use, and a Field Notes card.

export const BRANCHES = [
  { id: "context", name: "Context", ask: "What does the model see?" },
  { id: "action", name: "Action", ask: "What can it do?" },
  { id: "guard", name: "Guard", ask: "What is it allowed to do?" },
  { id: "persist", name: "Persist", ask: "What survives?" },
  { id: "verify", name: "Verify", ask: "How does it know it worked?" },
  { id: "control", name: "Control", ask: "Who keeps it on course?" },
];

const p = (branch, name, price, does, cost, wild, needs) => ({
  branch,
  name,
  price,
  does,
  cost,
  wild,
  needs,
});

export const PARTS = {
  // ---- Action ----
  tools: p(
    "action",
    "Tools",
    0,
    "Lets the model read and edit. It asks; the harness runs the call and hands the result back, in a loop.",
    "1 cell for the tool descriptions, every turn.",
    "The tool loop at the heart of every agent: call the model, run its tool calls, repeat until it answers in plain text."
  ),
  shell: p(
    "action",
    "Shell",
    1,
    "One general tool: run any command. Tests, builds, installs, scripts it writes itself.",
    "1 cell, every turn.",
    "A bash tool and code execution. Most coding agents lean on this more than on any special-purpose tool."
  ),
  mcp: p(
    "action",
    "Connectors",
    2,
    "Reaches services outside the machine: the ticket tracker, the calendar, the database.",
    "2 cells, every turn. Connector descriptions are bulky.",
    "MCP servers and plugins."
  ),
  // ---- Context ----
  convo: p(
    "context",
    "History",
    1,
    "Keeps earlier turns in the window, so a follow-up question means something.",
    "Nothing up front. The window grows with every exchange.",
    "A model call is stateless. The harness re-sends the whole conversation each time."
  ),
  prompt: p(
    "context",
    "Prompt",
    1,
    "Standing instructions: who the agent is, how to behave. Anything else can be stuffed in here too, at a price.",
    "1 cell every turn, plus 2 or more for each thing stuffed in.",
    "The system prompt."
  ),
  memory: p(
    "context",
    "Memory file",
    2,
    "Project knowledge loaded at the start of every session: conventions, commands, where things live.",
    "1 cell, every turn.",
    "Files like AGENTS.md or CLAUDE.md, read into context when the agent starts."
  ),
  skills: p(
    "context",
    "Skills",
    2,
    "A shelf of how-to guides. Only the index sits in the window; a guide is opened when a step needs it.",
    "1 cell for the index, then one extra turn and 2 cells per guide opened.",
    "Skills and tool search: progressive disclosure instead of loading everything up front."
  ),
  cache: p(
    "context",
    "Cache",
    2,
    "The start of the window is the same every turn, so it is re-read at a tenth of the price.",
    "Nothing. But anything that rewrites the window, like compaction, pays full price again.",
    "Prompt caching, and the reason harnesses append to history instead of editing it."
  ),
  // ---- Guard ----
  perms: p(
    "guard",
    "Permissions",
    1,
    "Pauses before a risky action and asks the user.",
    "One interruption each time it asks. People stop answering.",
    "Permission prompts and allow / ask / deny rules."
  ),
  sandbox: p(
    "guard",
    "Sandbox",
    2,
    "Runs commands in a box. Mistakes inside it are free; nothing gets out.",
    "Nothing. Steps that must leave the box still need a person's say-so.",
    "Sandboxed execution: a container or VM the agent can't break out of."
  ),
  shield: p(
    "guard",
    "Shield",
    2,
    "Wraps text from the outside world and labels it as data, so it stops reading like an instruction.",
    "Nothing.",
    "Prompt-injection defences: tool output marked as untrusted."
  ),
  // ---- Persist ----
  files: p(
    "persist",
    "Files",
    1,
    "A place to write. Also a place to park: long results keep their head and tail in the window and the rest goes to disk.",
    "1 cell, every turn. A fact from the middle of a parked result costs one more look.",
    "The filesystem as working memory, and tool-output offloading."
  ),
  git: p(
    "persist",
    "Checkpoints",
    2,
    "Saves the state before an edit, so a change that can't be fixed forward can be rolled back.",
    "Nothing until it is needed.",
    "Git, file checkpoints and rewind."
  ),
  progress: p(
    "persist",
    "Progress file",
    2,
    "A running record of what is done and what was learned. Survives a new session, and keeps dull steps from being dropped.",
    "1 cell, every turn.",
    "Plan and todo files, progress notes an agent reads when it picks work back up.",
    "files"
  ),
  // ---- Verify ----
  tests: p(
    "verify",
    "Tests",
    1,
    "Runs the tests before the agent is allowed to say done. Catches wrong logic.",
    "One extra turn and 1 cell per check.",
    "Self-verification: stop hooks and test runs that gate the end of a turn.",
    "shell"
  ),
  shots: p(
    "verify",
    "Screenshots",
    2,
    "Looks at the result in a browser. Catches what tests can't see.",
    "One extra turn and 2 cells per look. Pictures are heavy.",
    "Browser tools and screenshots for visual checks."
  ),
  logs: p(
    "verify",
    "Logs",
    2,
    "Reads what the running program printed. Catches failures that only show up live.",
    "One extra turn and 1 cell per check.",
    "Reading logs and traces to observe behaviour.",
    "shell"
  ),
  // ---- Control ----
  compact: p(
    "control",
    "Compaction",
    2,
    "When the window is 70% full, squashes old results into a one-cell summary.",
    "One extra turn each time it fires, and it rewrites the window.",
    "Auto-compaction, the usual answer to context rot."
  ),
  subs: p(
    "control",
    "Subagents",
    3,
    "Sends helpers to dig, each with its own window, all at once. One cell comes back from each, and it takes the main agent a single turn.",
    "The helpers' own tokens. Usually more in total, for less time and a cleaner window.",
    "Subagents and orchestration: context isolation more than parallelism."
  ),
  loop: p(
    "control",
    "Keep-going loop",
    3,
    "When the model stops early, starts it again in a clean window with the same goal.",
    "Each restart forgets everything that isn't written down.",
    "The 'Ralph loop': intercept the exit, re-inject the prompt in a fresh context, let the files carry the state."
  ),
  router: p(
    "control",
    "Router",
    2,
    "Hands the easy steps to a small, cheap model.",
    "Nothing. Easy steps cost a fifth.",
    "Model routing behind a swappable model adapter."
  ),
};

export const ORDER = {
  context: ["convo", "prompt", "memory", "skills", "cache"],
  action: ["tools", "shell", "mcp"],
  guard: ["perms", "sandbox", "shield"],
  persist: ["files", "git", "progress"],
  verify: ["tests", "shots", "logs"],
  control: ["compact", "subs", "loop", "router"],
};

// One line per way a run can end badly, and the part that would have helped.
// `fix` may be a function of the failure's details.
export const FAILS = {
  notool: {
    say: i =>
      i.part === "tools"
        ? "It can't look. It answered from memory, and guessed."
        : i.part === "shell"
          ? "It has nothing to run a command with."
          : "It can't reach anything outside this machine.",
    fix: i => i.part,
  },
  lostthread: {
    say: () =>
      "The follow-up arrived on its own. It has no idea what came before.",
    fix: () => "convo",
  },
  unknown: {
    say: () =>
      "Nobody told it how things are done here, so it made something up.",
    fix: i => i.from[0],
  },
  nofile: {
    say: () => "It has nowhere to write the result.",
    fix: () => "files",
  },
  overflow: {
    say: () => "The window overflowed.",
    fix: () => "compact",
  },
  subflood: {
    say: () => "The helper's own window overflowed.",
    fix: () => "files",
  },
  damage: {
    say: () => "That command deleted something real.",
    fix: () => "perms",
  },
  unapproved: {
    say: () => "It pushed to the outside world without asking anyone.",
    fix: () => "perms",
  },
  boxed: {
    say: () => "The box has no way out. That step needs a person's say-so.",
    fix: () => "perms",
  },
  annoyed: {
    say: () => "Too many questions. The user walked away.",
    fix: () => "sandbox",
  },
  injected: {
    say: () => "The page told it what to do, and it did.",
    fix: () => "shield",
  },
  broken: {
    say: i =>
      i.kind === "ui"
        ? "It said done. On screen it looks wrong."
        : i.kind === "runtime"
          ? "It said done. Then it fell over when it ran."
          : "It said done. The logic is wrong.",
    fix: i => ({ ui: "shots", runtime: "logs", logic: "tests" })[i.kind],
  },
  stuck: {
    say: () =>
      "The edit can't be fixed forward, and there's nothing to roll back to.",
    fix: () => "git",
  },
  amnesia: {
    say: () => "It needs something it learned earlier, and that's gone.",
    fix: () => "progress",
  },
  loop: {
    say: () => "It keeps fetching the same thing and losing it again.",
    fix: () => "files",
  },
  skipped: {
    say: () => "With the window that full, it quietly dropped the dull steps.",
    fix: () => "compact",
  },
  quit: {
    say: () => "It decided that was a good place to stop. It wasn't finished.",
    fix: () => "loop",
  },
  lostplace: {
    say: () =>
      "Each restart begins from nothing, so it keeps doing the start again.",
    fix: () => "progress",
  },
  late: {
    say: () => "One thing at a time took too long. They needed it sooner.",
    fix: () => "subs",
  },
  runaway: {
    say: () => "It never stopped. The budget is gone.",
    fix: () => "loop",
  },
};
