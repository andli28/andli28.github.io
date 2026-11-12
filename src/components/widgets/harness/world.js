// The map: branches around the model, and the parts in each. Every part is a
// real piece of the harness in agent.js. A part has a short label for the tip
// line and a Field Notes card.

export const BRANCHES = [
  { id: "context", name: "Context" },
  { id: "action", name: "Action" },
  { id: "guard", name: "Guard" },
  { id: "memory", name: "Memory" },
  { id: "verify", name: "Verify" },
  { id: "control", name: "Control" },
];

const p = (branch, name, short, does, wild) => ({
  branch,
  name,
  short,
  does,
  wild,
});

export const PARTS = {
  tools: p(
    "action",
    "Tools",
    "Let it read, fetch and calculate, in a loop.",
    "The model asks for a tool in a line of JSON. The harness runs it, hands the result back, and calls the model again, until it answers.",
    "The tool loop at the heart of every agent."
  ),
  feedback: p(
    "control",
    "Feedback",
    "Hand errors back instead of stopping.",
    "When a call is malformed or a tool fails, the error text goes back to the model as its next message, so it can try again.",
    "Feedback loops. Good error messages are written for the model: they say what to do next."
  ),
  prompt: p(
    "context",
    "System prompt",
    "The harness's standing rules, the same in every repository.",
    "Lines the harness puts at the start of every conversation, whatever the project: who the agent is, what it must never do, and where to look for project instructions.",
    "The system prompt. It holds the mechanics a repository owner shouldn't have to write."
  ),
  memory: p(
    "memory",
    "AGENTS.md",
    "The repository's own instructions, loaded at the start.",
    "A file kept in the repository and read into the instructions when a run begins. It teaches the agent this codebase: its commands, its layout and its conventions.",
    "AGENTS.md, CLAUDE.md and the like: context scoped to one repository."
  ),
  history: p(
    "memory",
    "History",
    "Send the earlier messages along.",
    "A model call remembers nothing. With this on, the harness re-sends the whole conversation with each new message.",
    "Conversation state. The model is stateless; the harness is what remembers."
  ),
  notes: p(
    "memory",
    "Notes file",
    "A file that outlives the session.",
    "The agent is told it has a notes file and to save what matters there. At the start of each session the harness reads the file back into the instructions.",
    "The filesystem as durable storage: notes, plans and work in progress that persist between sessions."
  ),
  check: p(
    "verify",
    "Check",
    "No answering without looking first.",
    "If the model answers without having used a tool, the harness sends it back to verify before the answer is accepted.",
    "Self-verification. Without it agents declare success on work they never checked."
  ),
  trim: p(
    "context",
    "Trim",
    "Cut the middle out of huge results.",
    "A tool result over 700 characters keeps its head and tail. The middle is replaced with a note on how to search it.",
    "Tool-output truncation and offloading."
  ),
  compact: p(
    "context",
    "Compaction",
    "Fold old steps into a summary.",
    "When the conversation passes 60% of the limit, the model is asked to summarise the older steps. The summary replaces them; the task stays word for word.",
    "Context compaction, the usual answer to context rot."
  ),
  shield: p(
    "guard",
    "Shield",
    "Mark outside text as data, not orders.",
    "Anything fetched from outside is wrapped in a tag, and the instructions say never to obey what is inside it.",
    "Prompt-injection defences."
  ),
  perms: p(
    "guard",
    "Permissions",
    "Ask you before it changes a file.",
    "Before a tool that writes, the harness stops and asks the user. You answer in the trace.",
    "Human-in-the-loop approval before actions that can't be undone."
  ),
  sandbox: p(
    "guard",
    "Sandbox",
    "Writes land in a scratch copy.",
    "Tools that write are pointed at a throwaway copy of the files. The agent can try things freely and the real files don't change.",
    "Sandboxed execution: a container or VM."
  ),
  stop: p(
    "control",
    "Stop guard",
    "Catch it repeating itself.",
    "If the model makes the same call twice in a row, the harness doesn't run it again. It tells the model to answer with what it has.",
    "Loop detection and turn limits."
  ),
  skills: p(
    "context",
    "Skills",
    "Tool manuals, opened only when needed.",
    "Only the tool names go in the instructions. The model asks for a tool's manual when it wants to use it.",
    "Skills and tool search: progressive disclosure, the answer to tool overload."
  ),
};

export const ORDER = {
  context: ["prompt", "trim", "compact", "skills"],
  action: ["tools"],
  guard: ["shield", "perms", "sandbox"],
  memory: ["history", "notes", "memory"],
  verify: ["check"],
  control: ["feedback", "stop"],
};
