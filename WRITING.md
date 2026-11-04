# Writing posts

The short version: add a file to `src/content/posts/`, run `pnpm dev` to preview, push to `main` to publish.

A full working example of every feature lives in
[`src/content/posts/_examples/example-post.mdx`](src/content/posts/_examples/example-post.mdx).
It's a draft, so you can see it at <http://localhost:4321/posts/example-post/> while running `pnpm dev`, but it never goes live.

## 1. Create a file

```
src/content/posts/my-post.md            -> /posts/my-post
src/content/posts/llm-serving/orca.mdx  -> /posts/llm-serving/orca
src/content/posts/_drafts/idea.md       -> /posts/idea   (a leading _ keeps the folder out of the URL)
```

Use `.md` for plain writing and math. Use `.mdx` when you want to embed a component (a widget, `<Wide>`, etc.).

## 2. Frontmatter

```yaml
---
title: "Iterative Batching, Step by Step"
description: "One or two sentences. Shows in post lists, search results and link previews."
pubDatetime: 2026-11-03T18:00:00-05:00
tags:
  - llm-inference
  - systems
draft: true          # optional: visible in `pnpm dev` only, never published
featured: false      # optional: pin to the "Featured" section of the homepage
modDatetime:         # optional: set when you meaningfully update a post
---
```

Only `title`, `description` and `pubDatetime` are required. A `pubDatetime` in the future hides the post until that day (the site rebuilds on each push, so push again or re-run the deploy workflow on the day).

In VS Code, type `frontmatter` or `template` in a new file to insert this block.

## 3. Write

- The `title` is the page's `h1`, so start your sections at `##`.
- Add a heading named exactly `## Table of contents` and it fills itself in.
- Code blocks: ```` ```python ```` for highlighting, ```` ```python file=train.py ```` for a filename tab, and a trailing `# [!code highlight]` comment to highlight a line.

### Math

```md
Inline: the cost is $O(n^2)$.

Block (the $$ lines must be on their own lines):

$$
\text{TTFT}_k = kP + (k-1)D
$$
```

### Callouts

```md
> [!NOTE]
> An aside.

> [!WARNING]- Collapsed by default
> Hidden until clicked.
```

Other types: `TIP`, `INFO`, `DANGER`, `EXAMPLE`, `QUOTE`, `BUG`, and more.

### Images

Put the file in `src/assets/images/` and reference it relatively or with `@/`:

```md
![KV cache layout](@/assets/images/kv-cache.png)
```

Astro resizes and compresses it at build time. Readers can click to zoom.

### Widgets and animations (`.mdx` only)

Import components right after the frontmatter, then use them anywhere:

```mdx
import IterativeBatching from "@/components/widgets/IterativeBatching.astro";
import Wide from "@/components/Wide.astro";

Some text...

<IterativeBatching />

<Wide>
  ...a big table, chart or figure that needs more than the text column...
</Wide>
```

To add a new widget, copy the pattern in `src/components/widgets/`:

- An `.astro` file with the markup, wrapped in `<Wide>` if it needs the room.
- Styles in `<style is:global>`, all nested under one unique root class (like `.ib-root`), with variables prefixed (like `--ib-*`). This keeps the widget's CSS and the site's CSS from affecting each other.
- Logic in a `.js` file, mounted on the `astro:page-load` event. The site swaps pages without a full reload, so code that only runs on `DOMContentLoaded` won't start after a reader clicks through from another page.
- For dark mode, read the site's `--foreground`, `--background` and `--muted-foreground` variables, or add overrides under `[data-theme="dark"] .your-root`.

## 4. Preview and publish

```bash
pnpm dev     # http://localhost:4321
```

When it looks right, remove `draft: true`, then commit and push to `main`. The site updates in about a minute.

## Retiring a post

Move the file to `src/content/archives/`. Anything outside `src/content/posts/` isn't part of the site, so the post disappears from Posts, Archives, Tags, RSS and search, but stays in the repo. Move it back to republish it.

(The "Archives" page on the site is just a by-date list of all published posts, not this folder.)

## Editing other pages

- Homepage intro: `src/content/pages/home.md` (its `title` is the big heading)
- About page: `src/content/pages/about.md`
- Site title, description, social links: `astro-paper.config.ts`
