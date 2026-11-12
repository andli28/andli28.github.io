// Line icons, 24×24, drawn with the current colour.
const P = {
  loop: "M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4",
  read: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4",
  edit: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  bash: "M4 5h16v14H4zM8 10l3 2.5L8 15M13 15h3",
  web: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  push: "M12 16V4M7 9l5-5l5 5M5 20h14",
  chat: "M4 5h16v11H10l-4 4v-4H4z",
  db: "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3zM5 6c0 1.7 3.1 3 7 3s7-1.3 7-3M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3",
  cloud: "M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z",
  sleep: "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z",
  catch: "M5 7c0 6 3 10 7 10s7-4 7-10M4 7h16M12 17v4",
  check: "M5 12.5l4.5 4.5L19 7",
  gate: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
  wall: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM6 6l12 12",
  sandbox: "M4 8l8-4l8 4v8l-8 4l-8-4zM4 8l8 4l8-4M12 12v8",
  rewind: "M11 7l-6 5l6 5zM20 7l-6 5l6 5z",
  trim: "M6 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM8.5 7.5L20 19M8.5 16.5L20 5",
  compact: "M3 12h6M6 9l3 3l-3 3M21 12h-6M18 9l-3 3l3 3M12 4v16",
  pin: "M9 3h6l-1 6l3 3H7l3-3zM12 12v9",
  note: "M6 4h13v16H6zM10 9h5M10 13h5M6 8H3M6 12H3M6 16H3",
  scout:
    "M7 14a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM17 14a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM4.2 16L7 5h3v12M19.8 16L17 5h-3v12",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z",
  stop: "M8 3h8l5 5v8l-5 5H8l-5-5V8zM8.5 12h7",
  todo: "M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M12 6h8M12 12h8M12 18h8",
  fan: "M3 12h6M9 12l5-7h6M9 12h11M9 12l5 7h6",
  cache: "M13 3L5 13h6l-1 8l8-10h-6z",
  router: "M3 12h5l4-6h8M8 12l4 6h8M17 3l3 3l-3 3M17 15l3 3l-3 3",
  flag: "M6 21V4M6 5h11l-2 4l2 4H6",
  task: "M6 4h12v16l-6-4l-6 4z",
  trap: "M12 4a7 7 0 0 0-4 12.7V19h8v-2.3A7 7 0 0 0 12 4zM9.5 12h.01M14.5 12h.01M10.5 19v2M13.5 19v2",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  star: "M12 3l2.7 5.6l6.1.9l-4.4 4.3l1 6.1L12 17l-5.4 2.9l1-6.1L3.2 9.5l6.1-.9z",
  book: "M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h9",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  x: "M6 6l12 12M18 6L6 18",
  play: "M8 5l11 7l-11 7z",
  back: "M15 5l-7 7l7 7",
  fwd: "M9 5l7 7l-7 7",
  sound: "M4 10v4h4l5 4V6l-5 4zM16.5 9a4 4 0 0 1 0 6",
  mute: "M4 10v4h4l5 4V6l-5 4zM16 9.5l5 5M21 9.5l-5 5",
  bolt: "M13 3L5 13h6l-1 8l8-10h-6z",
  zap: "M13 3L5 13h6l-1 8l8-10h-6z",
  target:
    "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  tools:
    "M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3l5.3-5.3a4 4 0 0 0 5.2-5.2l-2.6 2.6l-2.3-.6l-.6-2.3z",
  shell: "M4 5h16v14H4zM8 10l3 2.5L8 15M13 15h3",
  mcp: "M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4",
  convo: "M4 5h12v8H9l-3 3v-3H4zM9 16v1h6l3 3v-3h2V9h-2",
  prompt: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  memory: "M6 3h9l4 4v14H6zM15 3v4h4M9 12l2 2l4-4",
  skills: "M4 5h4v14H4zM8 5h4v14H8zM13.5 6l3.8-1l3.2 13.5l-3.8 1z",
  perms:
    "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
  files:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  git: "M7 4a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM7 16a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM17 7a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM7 8v8M17 11c0 3-4 3-8 4",
  progress:
    "M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M12 6h8M12 12h8M12 18h8",
  tests:
    "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M8 15h8",
  shots: "M4 8h3l2-3h6l2 3h3v11H4zM12 11a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  logs: "M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h6",
  subs: "M12 3a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM6 14a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM18 14a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM12 9v2M12 11l-5 3M12 11l5 3",
};

P.feedback = P.catch;
P.history = P.convo;
P.notes = P.note;

const FILLED = new Set(["heart", "star", "play", "cache", "bolt", "zap"]);

export function icon(name, cls = "") {
  const d = P[name] || P.x;
  const fill = FILLED.has(name) ? "currentColor" : "none";
  return `<svg class="ah-i ${cls}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
