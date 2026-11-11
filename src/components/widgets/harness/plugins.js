// The chip catalogue: what each harness piece is called, where it can go and
// what its settings are. Plus the words the game uses: failure lines and the
// Field Notes cards.

const TOOL = name => ({ name, kind: "tool", where: ["bot"], sets: [""] });

export const CHIPS = {
  loop: { name: "Loop", where: ["bot"], sets: [""] },
  read: TOOL("Read"),
  search: TOOL("Search"),
  edit: TOOL("Edit"),
  bash: TOOL("Shell"),
  web: TOOL("Web"),
  push: TOOL("Push"),
  chat: TOOL("Ask"),
  db: TOOL("Database"),
  cloud: TOOL("Cloud"),
  catch: { name: "Catch", where: ["bot"], sets: [""] },
  check: { name: "Check", where: ["tile", "flag"], sets: [""] },
  gate: { name: "Gate", where: ["tile", "trap"], sets: [""] },
  wall: { name: "Wall", where: ["tile", "trap"], sets: [""] },
  sandbox: { name: "Sandbox", where: ["bot"], sets: [""] },
  rewind: { name: "Rewind", where: ["tile"], sets: [""] },
  trim: { name: "Trim", where: ["tile"], sets: ["head", "tail", "both"] },
  compact: { name: "Compact", where: ["cell"], sets: [""] },
  pin: { name: "Pin", where: ["tile", "start"], sets: [""] },
  note: { name: "Notes", where: ["tile"], sets: [""] },
  scout: { name: "Scout", where: ["tile"], sets: ["×1", "×2", "×3"] },
  shield: { name: "Shield", where: ["tile"], sets: [""] },
  stop: {
    name: "Stop",
    where: ["tile"],
    sets: ["1 try", "2 tries", "3 tries"],
  },
  todo: { name: "Todo", where: ["bot"], sets: [""] },
  fan: { name: "Fan-out", where: ["tile"], sets: ["×2", "×3"] },
  cache: { name: "Cache", where: ["bot"], sets: [""] },
  router: { name: "Router", where: ["tile"], sets: [""] },
};

export const LAZY_SETS = ["", "lazy"];

// One line per way a run can end badly. Each names the cause.
export const FAILS = {
  noloop: () =>
    "It asked for a tool. Nothing ran it, so it answered from memory.",
  notool: i =>
    `It needed ${CHIPS[i.tool]?.name ?? "a tool"} and guessed instead.`,
  crash: () => "The tool threw an error and the run died with it.",
  broken: () => "It said done. The tests say otherwise.",
  damage: () => "That command deleted something real.",
  unapproved: () => "It shipped without asking anyone.",
  blocked: () => "You walled off a step it needed.",
  boxed: () => "The sandbox has no way out. That step needs approval.",
  annoyed: () => "Too many questions. The user walked away.",
  corrupt: i =>
    i.late
      ? "The checkpoint was taken after the damage."
      : "A bad edit, and nothing to roll back to.",
  overflow: () => "The window overflowed.",
  loop: i =>
    i.cut
      ? "It keeps re-reading. The part it needs was trimmed off."
      : "It keeps fetching the same thing and losing it again.",
  forgot: () => "The task got squashed. It no longer knows what it's doing.",
  amnesia: () => "It needs something from before, and can't ask twice.",
  scoutflood: () => "The scout's own window overflowed.",
  injected: () => "The page told it what to do, and it did.",
  runaway: () => "It never stopped. The budget is gone.",
  gaveup: () => "It gave up on a step that had no plan B.",
  skipped: () => "It reached the end, having skipped the boring steps.",
};

// Field Notes: one card per level, earned by clearing it.
export const NOTES = [
  {
    chip: "loop",
    title: "The loop",
    idea: "A model can only ask for a tool. The harness runs it, hands back the result, and calls the model again with the whole window. Every call costs the window's size in tokens.",
    wild: "Every agent is this loop: call the model, run its tool calls, repeat until it answers in plain text.",
  },
  {
    chip: "read",
    title: "Tools",
    idea: "The agent can do what it has tools for, and each tool's description takes up room on every turn.",
    wild: "Tool registries and MCP servers. Installing everything is a cost, not a default.",
  },
  {
    chip: "catch",
    title: "Errors are results",
    idea: "When a tool fails, give the error to the model. It usually knows what to try next.",
    wild: "Harnesses return failures as tool results instead of throwing.",
  },
  {
    chip: "check",
    title: "Check before done",
    idea: "The model saying it's finished is a claim. Running the tests is evidence.",
    wild: "Stop hooks and verification steps that run before a turn is allowed to end.",
  },
  {
    chip: "gate",
    title: "Ask first",
    idea: "A shell tool can do anything. For some actions the harness should pause and ask a person.",
    wild: "Permission prompts.",
  },
  {
    chip: "wall",
    title: "Rules",
    idea: "Asking about everything wears people out. Deny what's never wanted, ask about what matters, allow the rest.",
    wild: "Allow / ask / deny rules per tool or command.",
  },
  {
    chip: "sandbox",
    title: "Sandbox",
    idea: "Inside a box, mistakes are free. Only the steps that leave the box need a person.",
    wild: "Sandboxed execution with approval for network or writes outside the project.",
  },
  {
    chip: "rewind",
    title: "Checkpoints",
    idea: "Some mistakes can't be fixed forward. Save a point to return to before the risky part.",
    wild: "File checkpoints and rewind.",
  },
  {
    chip: "trim",
    title: "Trim",
    idea: "A long output gets cut. Which end you keep decides whether the answer survives.",
    wild: "Tool output limits. Many keep the head and the tail, since errors tend to sit at the end.",
  },
  {
    chip: "compact",
    title: "Compact and pin",
    idea: "When the window fills, squash the old turns into a summary. Summaries keep the gist and lose exact details, so pin what must stay exact.",
    wild: "Auto-compaction, with the system prompt and task kept verbatim.",
  },
  {
    chip: "note",
    title: "Notes",
    idea: "A new session starts blank. What's written to a file is still there.",
    wild: "Memory files loaded at the start of every session.",
  },
  {
    chip: "scout",
    title: "Scouts",
    idea: "Send a helper with its own window to do the digging. Only its summary comes back.",
    wild: "Subagents: context isolation more than parallelism.",
  },
  {
    chip: "db",
    title: "Manuals on demand",
    idea: "Big tool sets don't have to sit in the window. Load one when it's needed, and put it away after.",
    wild: "Skills and tool search: load instructions on demand.",
  },
  {
    chip: "shield",
    title: "Shield",
    idea: "Text from the outside world is data. Wrapped and labelled, it stops reading like an instruction.",
    wild: "Prompt-injection defences: mark tool output as untrusted, and keep permission rules behind it.",
  },
  {
    chip: "stop",
    title: "Know when to stop",
    idea: "Retrying is right until it isn't. Cap the tries and have a plan B.",
    wild: "Retry limits, turn caps and spend budgets.",
  },
  {
    chip: "todo",
    title: "The list",
    idea: "Far from the task, the dull steps get dropped. A list restated at the end of the window keeps them in view.",
    wild: "Todo and plan tools.",
  },
  {
    chip: "fan",
    title: "Fan-out",
    idea: "Calls that don't depend on each other can go out together: one turn instead of three.",
    wild: "Parallel tool calls.",
  },
  {
    chip: "cache",
    title: "Cache",
    idea: "The start of the window is the same every turn, so it can be re-read cheaply. Rewrite the window and you pay full price again.",
    wild: "Prompt caching, and why harnesses append instead of editing history.",
  },
  {
    chip: "router",
    title: "Router",
    idea: "Not every step needs the big model. Hand the easy ones to a small one, and spend the saving where the window is fullest.",
    wild: "Model routing behind a swappable model adapter.",
  },
  {
    chip: "loop",
    title: "Ship it",
    idea: "A harness is a set of trade-offs: room, cost, safety, and how often you bother a person.",
    wild: "This is the job.",
  },
];
