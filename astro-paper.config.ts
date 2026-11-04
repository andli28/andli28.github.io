import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://andli28.github.io/",
    title: "Andrew Li",
    description:
      "Technical notes on what I'm learning: machine learning, systems, and the math behind them.",
    author: "Andrew Li",
    profile: "https://github.com/andli28",
    ogImage: "default-og.jpg", // not present, so a generated /og.png is used
    lang: "en",
    timezone: "America/New_York",
    dir: "ltr",
  },
  posts: {
    perPage: 8,
    perIndex: 5,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    // Adds an "Edit page" link to each post. Set enabled: true to turn on.
    editPost: { enabled: false },
    search: "pagefind",
  },
  socials: [
    { name: "github", url: "https://github.com/andli28" },
    { name: "linkedin", url: "https://www.linkedin.com/in/andli28/" },
    { name: "mail", url: "mailto:achyt28@gmail.com" },
  ],
  shareLinks: [
    { name: "x", url: "https://x.com/intent/post?url=" },
    { name: "mail", url: "mailto:?subject=See%20this%20post&body=" },
  ],
});
