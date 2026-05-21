# Clawbada Pixel Art Asset Specification

## Delivery Format
- **PNG-24** with transparency for all raster assets
- **SVG** for dividers and simple patterns (scalable, small file size)
- **Sprite sheets** with consistent grid spacing for animated elements
- **@2x versions** for retina (or design at 2x and we downscale)
- **Tileable assets** should include seamless edges (test by repeating 3x3)
- Apply `image-rendering: pixelated` to all pixel art assets in CSS

## Color Palette
Stick to the existing game tokens:

| Token | Hex | Usage |
|-------|-----|-------|
| ocean-deep | `#0a1628` | Primary background |
| ocean-mid | `#0f2942` | Sidebar, popover |
| ocean-surface | `#163a5c` | Secondary bg |
| ocean-light | `#1d4f7a` | Light ocean |
| sand | `#2a1f14` | Panel backgrounds |
| sand-light | `#3d2e1f` | Active states |
| driftwood | `#4a3728` | Wood textures |
| coral-warm | `#c4553a` | Warm accents |
| claw-gold | `#fbbf24` | Rewards, primary accent |
| ocean | `#58a6ff` | Secondary accent |
| coral | `#f97066` | Danger, active highlight |
| teal | `#3fb9a0` | Success, evolved tier |

## Tier Visual Theme

| Tier | Environment | Palette | Mood |
|------|-------------|---------|------|
| **Base** | Shallow reef, sandy bottom, sunlit | Warm golds, sandy beige, light blue | Bright, welcoming |
| **Evolved** | Open ocean, coral formations | Teal, ocean blue, coral accents | Adventurous |
| **Elite** | Deep ocean trench, bioluminescence | Dark navy, glowing teal/purple | Mysterious |
| **Apex** | Volcanic vents, magma glow, abyssal | Black/charcoal, molten gold/orange | Extreme, prestigious |

---

## Directory Structure
All filenames below are relative to `public/assets/`:

```
public/assets/
  backgrounds/     # Full-page scene backgrounds (1920x1080)
  nav/             # Sidebar and navigation textures
  panels/          # 9-slice panel frames and accessories
  icons/           # 32x32 emoji replacement icons
  badges/          # 64x24 tier badge backgrounds
  buttons/         # 9-slice button frames
  animated/        # Sprite sheets for CSS animation
  hero/            # Landing page hero assets
  loading/         # Loading states and lobby art
```

---

## Category 1: Scene Backgrounds (16 assets)

Full-width illustrated backgrounds for every game page. Rendered behind content
at low opacity or as layered parallax. Pixel art style, 1920x1080px base (tile
horizontally for ultrawide).

### Mining Backgrounds (4)

| Filename | Description |
|----------|-------------|
| `bg-mine-base.png` | Sandy shore cave, wooden support beams, shallow water pools, pickaxe marks on walls, scattered shells |
| `bg-mine-evolved.png` | Underwater coral tunnel, bioluminescent algae on walls, mineral veins glowing teal, bubbles rising |
| `bg-mine-elite.png` | Deep trench shaft, crystal formations, dark rock with blue ore veins, distant light from above |
| `bg-mine-apex.png` | Volcanic vent cavern, magma streams, obsidian walls, gold ore deposits glowing, steam/heat shimmer |

### Battle Arena Backgrounds (4)

| Filename | Description |
|----------|-------------|
| `bg-arena-base.png` | Sandy colosseum floor, wooden barriers, shallow tide pools, seagulls, spectator rocks |
| `bg-arena-evolved.png` | Coral reef arena, kelp forest edges, underwater amphitheater carved from rock, fish spectators |
| `bg-arena-elite.png` | Deep ocean arena, glowing jellyfish audience, bioluminescent ring, dark water beyond |
| `bg-arena-apex.png` | Volcanic caldera arena, magma moat, obsidian pillars, smoke/ash particles, dramatic lighting |

### Page-Specific Backgrounds (8 assets + 2 default)

| Filename | Description |
|----------|-------------|
| `bg-landing.png` | Wide underwater reef panorama: sunlight filtering down, coral formations, treasure chests, mine entrance in distance, lobsters silhouetted. Bright and inviting. |
| `bg-dashboard.png` | Reef panorama variant: deeper water perspective looking toward sunlit surface, coral silhouettes in foreground, schools of fish mid-ground, faint lobsters near a mine entrance. Calmer than landing. |
| `bg-breeding.png` | Underwater laboratory: glass tanks with glowing eggs, bubbling tubes, seaweed on equipment, tidal pool workbenches, DNA helix etched on wall. |
| `bg-evolution.png` | Ancient underwater temple: glowing rune circles on floor, crystal pillars channeling energy, transformation altar at center, mystical energy wisps. |
| `bg-repair.png` | Dockside workshop: wooden workbench with tools, shell bandages, coral salves in jars, hanging lobster armor drying, warm lantern glow. |
| `bg-teams.png` | Wide underwater reef panorama: sunlight filtering down, coral formations, a few lobster characters marching in formation. Simple, bright. |
| `bg-market.png` | _None — uses default ocean-deep background._ |
| `bg-faucet.png` | Natural spring / tide pool: crystal clear water flowing from rock, 5 lobster eggs nestled in sand, golden coins scattered, welcoming sunshine. |
| `bg-leaderboard.png` | Trophy hall: grand underwater hall with pillars, champion statues, wall of fame plaques, golden light from above. |
| `bg-activity.png` | _None — uses default ocean-deep background._ |

**Specs:**
- 1920x1080px, PNG-24 with transparency for layering
- Deliver both **full color** and **darkened/desaturated** versions (suffix `-dark`)
- Keep visual weight toward edges/bottom (center has UI content on top)
- Each scene should be recognizable even when darkened

---

## Category 2: Navigation & Layout (6 assets)

| Filename | Size | Description |
|----------|------|-------------|
| `sidebar-wood.png` | 256x512, tileable | Driftwood plank texture for sidebar. Vertical grain, weathered. |
| `divider-rope.svg` | 200x8 | Nautical rope/twine, horizontal. Replaces `border-t`. |
| `nav-bottom-sand.png` | 512x64, tileable | Sandstone/driftwood strip for mobile bottom nav. |
| `header-wave.svg` | 1920x48 | Decorative wave for top of content areas. Subtle. |
| `divider-wave.svg` | 512x16 | Small wave/water line divider between sections. |
| `footer-deco.png` | 512x32 | Barnacle/coral cluster strip for footer or panel bottom. |

---

## Category 3: Panel Frames (14 assets)

### 9-Slice Frame Sets

Each frame set = 9 pieces that tile to fit any panel size.

**9-slice specs:**
- Corner pieces: 24x24px
- Edge pieces: 24x8px (horizontal) / 8x24px (vertical), tileable
- Fill: 32x32px, tileable (wood grain texture)
- All pieces have transparent backgrounds

| Set | Prefix | Description |
|-----|--------|-------------|
| **Default** | `frame-default-` | Weathered driftwood planks, brass rivets at corners, metal band strips, barnacle/coral at bottom. |
| **Highlight** | `frame-highlight-` | Gold-plated metal bands, polished brass rivets, subtle gold glow. |
| **Danger** | `frame-danger-` | Rusted/corroded metal bands, cracked wood, red-tinged barnacles, pitted rivets. |

Each set contains 9 PNGs: `{prefix}tl`, `tr`, `bl`, `br`, `t`, `b`, `l`, `r`, `fill`.

### Panel Accessories

| Filename | Size | Description |
|----------|------|-------------|
| `panel-header.png` | 512x32, tileable | Decorative header strip with metal nameplate area. |
| `panel-grain.png` | 128x128, tileable | Subtle wood grain texture (5-10% opacity overlay). |
| `glow-gold.png` | 64x64 | Soft gold glow sprite for highlighted panels. |
| `crack-overlay.png` | 128x32 | Cracked/damaged strip for critical damage bars. |
| `rivets-sheet.png` | 48x8 (6 variants) | Individual rivet/bolt sprites. |

---

## Category 4: Icons (20 assets)

32x32px base, exported at 1x and 2x. Outlined style, matches game palette.

### Mine Tier Icons (4)

| Filename | Description |
|----------|-------------|
| `icon-mine-base.png` | Sandy cave entrance with wooden frame |
| `icon-mine-evolved.png` | Underwater coral cave with bubbles |
| `icon-mine-elite.png` | Dark crystal cavern with blue glow |
| `icon-mine-apex.png` | Volcanic vent with magma glow |

### Activity Feed Icons (8)

| Filename | Description |
|----------|-------------|
| `icon-battle.png` | Two crossed lobster claws |
| `icon-breed.png` | Egg with DNA helix or sparkle |
| `icon-evolve.png` | Upward arrow with starburst |
| `icon-sale.png` | Gold coins / treasure chest |
| `icon-listing.png` | Market stall / shop sign |
| `icon-mining.png` | Pickaxe striking ore |
| `icon-faucet.png` | Lobster emerging from water drop |
| `icon-event.png` | Ocean bubble / ripple |

### Status Icons (4)

| Filename | Description |
|----------|-------------|
| `icon-locked.png` | Chain or padlock, underwater style |
| `icon-soulbound.png` | Anchor or bonded chain |
| `icon-legend.png` | Glowing star / trident sparkle |
| `icon-timer.png` | Hourglass with sand flowing |

### UI Action Icons (4)

| Filename | Description |
|----------|-------------|
| `icon-repair.png` | Wrench with bubble/water theme |
| `icon-team.png` | 3 small lobster silhouettes grouped |
| `icon-empty.png` | Sad/sleeping lobster (for empty states) |
| `icon-trophy.png` | Coral/gold trophy cup |

---

## Category 5: Tier Badges (4 assets)

64x24px, pill-shaped badge backgrounds.

| Filename | Description |
|----------|-------------|
| `badge-base.png` | Stone/sand textured pill |
| `badge-evolved.png` | Teal water/coral textured pill |
| `badge-elite.png` | Dark crystal/gem textured pill |
| `badge-apex.png` | Gold/magma textured pill with subtle glow |

---

## Category 6: Button States (12 files)

9-slice compatible (8px corners, 4px edges, center fill). Each set has 4 states: default, hover, pressed, disabled.

| Set | Prefix | Description |
|-----|--------|-------------|
| **Primary** | `btn-primary-` | Coral/warm wood frame, gold text area. Raised 3D. |
| **Secondary** | `btn-secondary-` | Darker driftwood frame, muted. Flat with bevel. |
| **Danger** | `btn-danger-` | Rusted/corroded frame, red-tinted. |

Files per set: `{prefix}default.png`, `hover.png`, `pressed.png`, `disabled.png`.

---

## Category 7: Animated Elements (5 sprite sheets)

| Filename | Spec | Description |
|----------|------|-------------|
| `bubbles-sheet.png` | 8 frames, 16x16 | Rising bubbles, various sizes. Ambient bg animation. |
| `sparkle-sheet.png` | 6 frames, 16x16 | Rotating/twinkling star. For legend cards. |
| `coin-sheet.png` | 8 frames, 16x16 | $CLAW coin rotation. For reward animations. |
| `crack-sheet.png` | 4 frames, 32x32 | Progressive cracking. For damage bar visual. |
| `wave-sheet.png` | 4 frames, 256x16 | Animated water line. For section dividers. |

---

## Category 8: Landing Page Hero (2 assets)

| Filename | Size | Description |
|----------|------|-------------|
| `hero-lobster.png` | 512x512 | Large pixel art lobster, dynamic pose (claws raised, facing viewer). Transparent bg. |
| `hero-scene.png` | 1920x600 | Wide illustrated banner: underwater reef with lobsters, treasure, mine entrance. |

---

## Category 9: Loading/Lobby (3 assets)

| Filename | Size | Description |
|----------|------|-------------|
| `loading-lobster.png` | 48x48, 4 frames | Lobster walking/idle animation. Replaces spinner. |
| `matchmaking-bg.png` | 512x256 | Battle queue waiting room. Dark water with spotlights. |
| `season-banner.png` | 512x64 | "Season 1" decorative banner. Nautical flag/pennant style. |

---

## Priority Order
1. Scene backgrounds (biggest visual impact)
2. Panel frames (elevates every page)
3. Icons (eliminates all emoji)
4. Landing page hero (first impression)
5. Navigation textures (sidebar polish)
6. Tier badges
7. Button states
8. Animated elements
9. Loading/lobby

## Total: ~138 individual files
