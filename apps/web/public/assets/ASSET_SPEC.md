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
| **Base** | Shallow reef, sandy bottom, sunlit | Warm golds, sandy beige, light blue | Bright, welcoming, safe |
| **Evolved** | Open ocean, coral formations, mid-depth | Teal, ocean blue, coral accents | Adventurous, moderate depth |
| **Elite** | Deep ocean trench, bioluminescence | Dark navy, glowing teal/purple | Mysterious, dangerous |
| **Apex** | Volcanic vents, magma glow, abyssal | Black/charcoal, molten gold/orange | Extreme, prestigious |

---

## Directory Structure
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

## Category 1: Scene Backgrounds (18 assets)

Full-width illustrated backgrounds for every game page. Rendered behind content
at low opacity or as layered parallax. Pixel art style, 1920x1080px base (tile
horizontally for ultrawide).

### Mining Backgrounds (4)

| Filename | Description |
|----------|-------------|
| `backgrounds/bg-mine-base.png` | Sandy shore cave, wooden support beams, shallow water pools, pickaxe marks on walls, scattered shells |
| `backgrounds/bg-mine-evolved.png` | Underwater coral tunnel, bioluminescent algae on walls, mineral veins glowing teal, bubbles rising |
| `backgrounds/bg-mine-elite.png` | Deep trench shaft, crystal formations, dark rock with blue ore veins, distant light from above |
| `backgrounds/bg-mine-apex.png` | Volcanic vent cavern, magma streams, obsidian walls, gold ore deposits glowing, steam/heat shimmer |

### Battle Arena Backgrounds (4)

| Filename | Description |
|----------|-------------|
| `backgrounds/bg-arena-base.png` | Sandy colosseum floor, wooden barriers, shallow tide pools, seagulls, spectator rocks |
| `backgrounds/bg-arena-evolved.png` | Coral reef arena, kelp forest edges, underwater amphitheater carved from rock, fish spectators |
| `backgrounds/bg-arena-elite.png` | Deep ocean arena, glowing jellyfish audience, bioluminescent ring, dark water beyond |
| `backgrounds/bg-arena-apex.png` | Volcanic caldera arena, magma moat, obsidian pillars, smoke/ash particles, dramatic lighting |

### Page-Specific Backgrounds (10)

| Filename | Description |
|----------|-------------|
| `backgrounds/bg-landing.png` | Wide underwater reef panorama: sunlight filtering down, coral formations, treasure chests, mine entrance in distance, lobsters silhouetted. Bright and inviting. |
| `backgrounds/bg-dashboard.png` | Captain's quarters / war room: wooden desk with map, compass, telescope overlooking ocean through a porthole. Warm lantern light. |
| `backgrounds/bg-breeding.png` | Underwater laboratory: glass tanks with glowing eggs, bubbling tubes, seaweed growing on equipment, tidal pool workbenches, DNA helix etched on wall. |
| `backgrounds/bg-evolution.png` | Ancient underwater temple: glowing rune circles on the floor, crystal pillars channeling energy, transformation altar at center, mystical energy wisps. |
| `backgrounds/bg-repair.png` | Dockside workshop: wooden workbench with tools, shell bandages, coral salves in jars, hanging lobster armor pieces drying, warm lantern glow. |
| `backgrounds/bg-teams.png` | Barracks / crew quarters: wooden bunks, weapon racks (lobster-sized), team banners hanging from rafters, training dummies. |
| `backgrounds/bg-market.png` | Underwater bazaar: merchant stalls with awnings, hanging lanterns, display cases with lobsters, treasure piles, haggling NPCs in background. |
| `backgrounds/bg-faucet.png` | Natural spring / tide pool: crystal clear water flowing from rock formation, 5 lobster eggs nestled in sand, golden coins scattered, welcoming sunshine. |
| `backgrounds/bg-leaderboard.png` | Trophy hall: grand underwater hall with pillars, champion statues, wall of fame plaques, golden light from above. |
| `backgrounds/bg-activity.png` | Harbor / docks: busy port scene, ships coming and going, message boards, crates being loaded, news and movement. |

**Specs:**
- 1920x1080px, PNG-24 with transparency for layering
- Deliver both **full color** and **darkened/desaturated** versions (suffix `-dark`)
- Keep visual weight toward edges/bottom (center has UI content on top)
- Each scene should be recognizable even when darkened

---

## Category 2: Navigation & Layout (6 assets)

| Filename | Size | Description |
|----------|------|-------------|
| `nav/sidebar-wood.png` | 256x512px, tileable | Driftwood plank texture for desktop sidebar. Vertical wood grain, weathered, dark warm tones. |
| `nav/divider-rope.svg` | 200x8px | Nautical rope or knotted twine, horizontal. Replaces plain `border-t` between nav sections. |
| `nav/nav-bottom-sand.png` | 512x64px, tileable | Sandstone/driftwood strip for mobile bottom nav background. Horizontal grain. |
| `nav/header-wave.svg` | 1920x48px | Decorative wave pattern for top of page content areas. Subtle, low opacity. |
| `nav/divider-wave.svg` | 512x16px | Small wave/water line divider between page sections. |
| `nav/footer-deco.png` | 512x32px | Decorative barnacle/coral cluster strip for footer or bottom of panels. |

---

## Category 3: Panel Frames (14 assets)

### 9-Slice Frame Sets
Each frame set = 9 pieces that tile to fit any panel size.

**9-slice specs:**
- Corner pieces: 24x24px
- Edge pieces: 24x8px (horizontal) / 8x24px (vertical), tileable
- Fill: 32x32px, tileable (wood grain texture)
- All pieces have transparent backgrounds

| Asset Set | Filenames | Description |
|-----------|-----------|-------------|
| **Default** | `panels/frame-default-{tl,tr,bl,br,t,b,l,r,fill}.png` | Weathered driftwood planks, brass rivets at corners, metal band strips, barnacle/coral at bottom corners. |
| **Highlight** | `panels/frame-highlight-{tl,tr,bl,br,t,b,l,r,fill}.png` | Same but gold-plated metal bands, polished brass rivets, subtle gold glow. |
| **Danger** | `panels/frame-danger-{tl,tr,bl,br,t,b,l,r,fill}.png` | Rusted/corroded metal bands, cracked wood, red-tinged barnacles, pitted rivets. |

### Panel Accessories

| Filename | Size | Description |
|----------|------|-------------|
| `panels/panel-header.png` | 512x32px, tileable center | Decorative header strip with metal nameplate area. |
| `panels/panel-grain.png` | 128x128px, tileable | Very subtle wood grain texture (5-10% opacity overlay). |
| `panels/glow-gold.png` | 64x64px | Soft gold glow sprite for behind highlighted panels. |
| `panels/crack-overlay.png` | 128x32px | Cracked/damaged texture strip for critical damage bars. |
| `panels/rivets-sheet.png` | 48x8px (8x8 x 6 variants) | Individual rivet/bolt sprites. |

---

## Category 4: Icons (20 assets)

32x32px base, exported at 1x and 2x. Outlined style, matches game palette.

### Mine Tier Icons (4)

| Filename | Description |
|----------|-------------|
| `icons/icon-mine-base.png` | Sandy cave entrance with wooden frame |
| `icons/icon-mine-evolved.png` | Underwater coral cave with bubbles |
| `icons/icon-mine-elite.png` | Dark crystal cavern with blue glow |
| `icons/icon-mine-apex.png` | Volcanic vent with magma glow |

### Activity Feed Icons (8)

| Filename | Description |
|----------|-------------|
| `icons/icon-battle.png` | Two crossed lobster claws |
| `icons/icon-breed.png` | Egg with DNA helix or sparkle |
| `icons/icon-evolve.png` | Upward arrow with starburst |
| `icons/icon-sale.png` | Gold coins / treasure chest |
| `icons/icon-listing.png` | Market stall / shop sign |
| `icons/icon-mining.png` | Pickaxe striking ore |
| `icons/icon-faucet.png` | Lobster emerging from water drop |
| `icons/icon-event.png` | Ocean bubble / ripple |

### Status Icons (4)

| Filename | Description |
|----------|-------------|
| `icons/icon-locked.png` | Chain or padlock, underwater style |
| `icons/icon-soulbound.png` | Anchor or bonded chain |
| `icons/icon-legend.png` | Glowing star / trident sparkle |
| `icons/icon-timer.png` | Hourglass with sand flowing |

### UI Action Icons (4)

| Filename | Description |
|----------|-------------|
| `icons/icon-repair.png` | Wrench with bubble/water theme |
| `icons/icon-team.png` | 3 small lobster silhouettes grouped |
| `icons/icon-empty.png` | Sad/sleeping lobster (for empty states) |
| `icons/icon-trophy.png` | Coral/gold trophy cup |

---

## Category 5: Tier Badges (4 assets)

64x24px, pill-shaped badge backgrounds.

| Filename | Description |
|----------|-------------|
| `badges/badge-base.png` | Stone/sand textured pill |
| `badges/badge-evolved.png` | Teal water/coral textured pill |
| `badges/badge-elite.png` | Dark crystal/gem textured pill |
| `badges/badge-apex.png` | Gold/magma textured pill with subtle glow |

---

## Category 6: Button States (12 files)

9-slice compatible (8px corners, 4px edges, center fill). Each set has 4 states.

| Asset Set | Filenames | Description |
|-----------|-----------|-------------|
| **Primary** | `buttons/btn-primary-{default,hover,pressed,disabled}.png` | Coral/warm wood frame, gold text area. Raised 3D. |
| **Secondary** | `buttons/btn-secondary-{default,hover,pressed,disabled}.png` | Darker driftwood frame, muted. Flat with bevel. |
| **Danger** | `buttons/btn-danger-{default,hover,pressed,disabled}.png` | Rusted/corroded frame, red-tinted. |

---

## Category 7: Animated Elements (5 sprite sheets)

| Filename | Frames | Size | Description |
|----------|--------|------|-------------|
| `animated/bubbles-sheet.png` | 8 frames | 16x16px each | Rising bubbles, various sizes. Ambient bg animation. |
| `animated/sparkle-sheet.png` | 6 frames | 16x16px each | Rotating/twinkling star. For legend cards. |
| `animated/coin-sheet.png` | 8 frames | 16x16px each | $CLAW coin rotation. For reward animations. |
| `animated/crack-sheet.png` | 4 frames | 32x32px each | Progressive cracking. For damage bar visual. |
| `animated/wave-sheet.png` | 4 frames | 256x16px each | Animated water line. For section dividers. |

---

## Category 8: Landing Page Hero (2 assets)

| Filename | Size | Description |
|----------|------|-------------|
| `hero/hero-lobster.png` | 512x512px | Large pixel art lobster, dynamic pose (claws raised, facing viewer). Transparent bg. |
| `hero/hero-scene.png` | 1920x600px | Wide illustrated banner: underwater reef with lobsters, treasure, mine entrance. |

---

## Category 9: Loading/Lobby (3 assets)

| Filename | Size | Description |
|----------|------|-------------|
| `loading/loading-lobster.png` | 4-frame sprite, 48x48px | Lobster walking/idle animation. Replaces spinner. |
| `loading/matchmaking-bg.png` | 512x256px | Battle queue waiting room. Dark water with spotlights. |
| `loading/season-banner.png` | 512x64px | "Season 1" decorative banner. Nautical flag/pennant style. |

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

## Total: ~140 individual files
