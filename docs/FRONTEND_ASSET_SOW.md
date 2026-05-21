# Statement of Work — Clawbada Frontend Pixel Art Assets

**Project**: Clawbada (agent-first idle game on Base blockchain)
**Role**: Pixel Art Designer — UI Asset Package
**Rate**: $25/hour
**Estimated Total**: $3,250 - $5,750 (phased, with go/no-go checkpoints)

---

## 1. Project Summary

Clawbada is a blockchain-based idle game featuring pixel art lobster characters. The game frontend is built (Next.js/React) with a functional ocean-themed UI. We need a pixel art designer to produce ~140 visual assets across 9 categories: scene backgrounds, panel frames, icons, navigation textures, buttons, animated sprites, and hero illustrations.

The game has an existing pixel art lobster character style (see reference files). All new assets must be visually consistent with this style.

**Full asset specification**: See attached `FRONTEND_ASSET_SPEC.pdf` for complete filenames, dimensions, descriptions, and color palette.

---

## 2. Phased Delivery

Work is structured in 4 phases. Each phase ends with a review checkpoint. Subsequent phases are authorized only after the previous phase is approved. Either party may end the engagement at any phase boundary.

### Phase 1 — Style Test (Paid Trial)
**Estimated hours**: 20-30h
**Estimated cost**: $500-750
**Deadline**: 1 week from start

| Deliverable | Count | Description |
|-------------|-------|-------------|
| Scene backgrounds | 3 | `bg-landing.png`, `bg-dashboard.png`, `bg-mine-base.png` (1920x1080, full color + dark variant each) |
| Icons | 10 | All 4 mine tier icons + 6 activity feed icons (32x32, PNG-24) |
| Hero lobster | 1 | `hero-lobster.png` (512x512, dynamic pose, transparent bg) |

**Purpose**: Validate style consistency with existing lobster art, test assets in the live UI, establish working pace for remaining phases.

**Go/no-go criteria**:
- Pixel art style matches existing lobster character art (not hyper-detailed, not too minimal)
- Backgrounds are recognizable and atmospheric even at 15% opacity behind UI content
- Icons read clearly at 16px and 32px display sizes
- Color palette stays within the provided game tokens (ocean blues, sand, driftwood, coral, gold, teal)
- Files delivered in correct format (PNG-24, transparency, specified dimensions)

---

### Phase 2 — Backgrounds & Hero
**Estimated hours**: 60-80h
**Estimated cost**: $1,500-2,000
**Deadline**: 2 weeks from Phase 1 approval

| Deliverable | Count | Description |
|-------------|-------|-------------|
| Remaining scene backgrounds | 15 | 4 mining + 4 arena + 7 page-specific (see spec) |
| Dark variants | 18 | Darkened/desaturated version of every background |
| Hero scene | 1 | `hero-scene.png` (1920x600, wide banner) |

**Total backgrounds after Phase 2**: 18 scenes x 2 variants = 36 files

---

### Phase 3 — Panels, Icons & Frames
**Estimated hours**: 25-35h
**Estimated cost**: $625-875
**Deadline**: 1.5 weeks from Phase 2 approval

| Deliverable | Count | Description |
|-------------|-------|-------------|
| 9-slice panel frames | 3 sets (27 pieces) | Default, highlight, danger — each with 4 corners + 4 edges + fill |
| Panel accessories | 5 | Header bar, grain overlay, gold glow, crack overlay, rivet sheet |
| Remaining icons | 10 | 2 remaining activity icons + 4 status + 4 UI action icons |
| Tier badges | 4 | 64x24 pill-shaped badge backgrounds |

---

### Phase 4 — Polish & Animation
**Estimated hours**: 20-30h
**Estimated cost**: $500-750
**Deadline**: 1.5 weeks from Phase 3 approval

| Deliverable | Count | Description |
|-------------|-------|-------------|
| Navigation textures | 6 | Sidebar wood, rope divider, mobile nav sand, header wave, wave divider, footer barnacles |
| Button states | 3 sets (12 files) | Primary, secondary, danger — 4 states each (default/hover/pressed/disabled) |
| Animated sprite sheets | 5 | Bubbles, sparkle, coin spin, damage crack, wave strip |
| Loading assets | 3 | Loading lobster sprite, matchmaking bg, season banner |

---

## 3. Cost Summary

| Phase | Hours (est.) | Cost (est.) | Cumulative |
|-------|-------------|-------------|------------|
| **Phase 1** — Style Test | 20-30h | $500-750 | $500-750 |
| **Phase 2** — Backgrounds | 60-80h | $1,500-2,000 | $2,000-2,750 |
| **Phase 3** — Panels & Icons | 25-35h | $625-875 | $2,625-3,625 |
| **Phase 4** — Polish & Animation | 20-30h | $500-750 | $3,125-4,375 |
| **Revisions buffer** (~15%) | ~20h | ~$500 | **$3,625-4,875** |

**Hard cap**: $5,750 (230 hours). Any work beyond this requires written approval.

---

## 4. Revision Policy

- **Phase 1**: Up to 2 full revision rounds included (this is the style calibration phase)
- **Phases 2-4**: 1 revision round per batch of deliverables included
- A "revision" = feedback on delivered assets with specific change requests; designer implements changes
- Scope changes (new assets not in the spec) require a separate estimate
- Minor tweaks (color adjustment, small repositioning) do not count as revision rounds

---

## 5. File Delivery Requirements

### Format
- **Raster assets**: PNG-24 with transparency
- **Vector assets** (dividers, patterns): SVG
- **Sprite sheets**: Consistent grid spacing, all frames same size
- **Retina**: Design at 2x, deliver both 1x and 2x (or 2x only and we downscale)
- **Tileable assets**: Seamless edges (verify by repeating 3x3)

### Organization
Deliver files matching this folder structure:
```
assets/
  backgrounds/     bg-*.png, bg-*-dark.png
  nav/             sidebar-wood.png, divider-*.svg, etc.
  panels/          frame-*-{tl,tr,bl,br,t,b,l,r,fill}.png
  icons/           icon-*.png
  badges/          badge-*.png
  buttons/         btn-*-{default,hover,pressed,disabled}.png
  animated/        *-sheet.png
  hero/            hero-*.png
  loading/         loading-*.png, matchmaking-*.png, season-*.png
```

Exact filenames are specified in `FRONTEND_ASSET_SPEC.pdf`.

### Color Palette
All assets must use colors from this palette (minor variations acceptable for gradients/shading):

| Token | Hex | Usage |
|-------|-----|-------|
| ocean-deep | `#0a1628` | Darkest background |
| ocean-mid | `#0f2942` | Mid-depth |
| ocean-surface | `#163a5c` | Lighter blue |
| sand | `#2a1f14` | Warm panel bg |
| driftwood | `#4a3728` | Wood textures |
| coral | `#f97066` | Danger/active accent |
| claw-gold | `#fbbf24` | Reward/primary accent |
| ocean | `#58a6ff` | Secondary accent |
| teal | `#3fb9a0` | Success/evolved |

---

## 6. Reference Material

The following will be provided at project start:

1. **`FRONTEND_ASSET_SPEC.pdf`** — Complete asset list with descriptions, sizes, and filenames
2. **Existing lobster art** — `lobster-hero.png` and procedurally generated lobster examples (for style matching)
3. **UI screenshots** — Current frontend screenshots showing where each asset appears
4. **Color palette swatches** — Exact hex values in a format the designer can import
5. **Crabada reference** — Screenshots from the original Crabada game (play.crabada.com) for wooden-chest panel style inspiration

---

## 7. Working Arrangement

- **Communication**: [TBD — Discord/Slack/email]
- **Time tracking**: Designer logs hours per phase; invoiced at phase completion
- **Payment**: On approval of each phase deliverable (net 7 days)
- **IP**: All delivered assets are work-for-hire; full rights transfer to project on payment
- **Tools**: Designer uses their preferred pixel art software (Aseprite, Photoshop, etc.)

---

## 8. Timeline Summary

| Week | Milestone |
|------|-----------|
| Week 1 | Phase 1 delivered (style test) |
| Week 1-2 | Review + feedback + revisions |
| Week 2 | Go/no-go decision on Phase 2 |
| Week 2-4 | Phase 2 delivered (all backgrounds) |
| Week 4-5.5 | Phase 3 delivered (panels, icons, badges) |
| Week 5.5-7 | Phase 4 delivered (nav, buttons, animation, loading) |
| **~7 weeks** | **All assets delivered** |

---

## 9. Acceptance

| | Name | Date |
|---|------|------|
| **Client** | | |
| **Designer** | | |
