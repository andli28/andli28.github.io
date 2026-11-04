# andli28.github.io

My personal site and technical blog, built with [Astro](https://astro.build/) on the [AstroPaper](https://github.com/satnaing/astro-paper) theme. **See [WRITING.md](WRITING.md) for how to add posts.**

## Run it locally

Requires Node 22.23+ and [pnpm](https://pnpm.io/) (`npm i -g pnpm`).

```bash
pnpm install
pnpm dev        # http://localhost:4321, reloads on save, shows drafts
pnpm build      # production build into dist/ (type check + search index)
pnpm preview    # serve the built site
```

## Where things live

| What | Where |
| --- | --- |
| Posts | `src/content/posts/` (`.md` or `.mdx`) |
| Homepage intro | `src/content/pages/home.md` |
| About page | `src/content/pages/about.md` |
| Site title, socials, settings | `astro-paper.config.ts` |
| Colors | `src/styles/theme.css` |
| Images for posts | `src/assets/images/` |
| Interactive widgets | `src/components/widgets/` |

## Deploying

Every push to `main` builds and publishes the site via `.github/workflows/deploy.yml`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Pull requests run a lint + build check (`.github/workflows/ci.yml`).
