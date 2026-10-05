# Website & marketing art — drop zone (`design/website`)

Everything for the marketing site and the socials goes here, on the **`design/website`**
branch. It is a plain folder: no code, no Unity. Push as often as you like; when a batch is
ready, tell us (or open a PR to `main`) and we land it into the site — the same routine as the
VFX drops on `design/vfx-specials`, which stays Unity-only.

## 1. Branch

```bash
git fetch origin
git checkout design/website   # kept identical to main — we push main here after every merge
git pull                      # fast-forward
git lfs pull                  # raster exports and source files in design/website are Git LFS
```

## 2. Where things go

| Folder | What | Formats |
|---|---|---|
| `brand/` | logo, wordmark, lockups, favicon set, colour swatches, type | SVG master + PNG exports; favicon 32 / 180 / 512 |
| `marketing/` | socials: X/Twitter banner 1500×500 + profile 400×400, OG / link-preview image 1200×630, Moltbook and Base App tiles, key art, press kit, trailers | PNG/JPG exports; MP4/WebM for motion |
| `site/` | art the pages use: landing hero, section illustrations, dividers, icons, page backgrounds, how-to-play panels | PNG @1x (+ @2x where it matters), SVG for flat shapes |
| `mockups/` | page comps and Figma exports — reference only, never shipped | PNG / PDF |

Sources (PSD, AI, Affinity, Aseprite) sit next to their exports in a `src/` subfolder, e.g.
`site/src/hero.psd` beside `site/hero-1920x1080.png`.

## 3. Naming

- `kebab-case`, no spaces: `og-1200x630.png`, `logo-wordmark.svg`, `banner-x-1500x500.png`
- raster exports carry their pixel size in the name; versions as a suffix (`-v2`), never "final"
- one asset per file — no contact sheets for things the site has to crop

## 4. What is live today (replace rather than duplicate)

| On the site | Path |
|---|---|
| logo + wordmark (placeholders) | `apps/web/public/assets/logo.png`, `logo-text.png` |
| landing hero | `apps/web/public/lobster-hero.png` |
| page backgrounds (landing, mine, arena, teams, faucet, repair, leaderboard) | `apps/web/public/assets/backgrounds/` |
| section dividers, gutter, Apex battle scene, how-to-play panels | `apps/web/public/marketing/` |
| favicon, OG / Twitter card image | **none yet — the first gap** |

## 5. What happens next

Each batch lands with a PR to `main`: we copy or convert the exports into `apps/web/public`
(plain git, sized for the web), wire them into the pages, and fast-forward `design/website` to
`main` afterwards so your branch always matches it. Nothing inside `design/website` is served
directly — it is the source of truth, not the deployed copy.

## 6. Please don't

- edit anything outside `design/website` on this branch (code, Unity, docs) — put it in a
  message instead and we wire it
- commit files over ~50 MB (LFS copes, reviews don't): trailers and long videos → a link
- put website art on `design/vfx-specials` — that branch is the Unity project only
