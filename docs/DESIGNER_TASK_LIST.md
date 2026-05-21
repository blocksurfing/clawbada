# Clawbada Designer Task List

## Task 1: Custom Sidebar Navigation Icons

Replace the current system/Lucide icons with custom-drawn icons that match the game's illustrative style.

**Icons needed (11 total):**

| Nav Item | Current Icon | Notes |
|----------|-------------|-------|
| Dashboard | Grid/squares | Home overview |
| Mining | Pickaxe | Treasure/mining theme |
| Battle | Crossed swords | Combat/arena theme |
| Breeding | Egg | Hearts/love/pairing theme |
| Evolve | Up-arrow circle | Transformation/power-up |
| Repair | Wrench | Fix/heal theme |
| Teams | People group | Squad/team of 3 |
| Market | Shopping bag | Trading/marketplace |
| Activity | Line chart | Live feed/activity |
| Ranks | Trophy | Leaderboard/competition |
| Docs | Book | Documentation/guide |

**Specs:**
- Size: 24x24px base, provide @2x (48x48) for retina
- Format: SVG preferred, PNG acceptable
- Style: Illustrative, matching the game's underwater/nautical theme
- States: Default (muted) + Active (coral/highlighted) variants
- See reference screenshot for current sidebar layout

---

## Task 2: Home Page Game Mode Illustrations

3 illustrated card images for the "How to Play" section on the landing page. Each shows lobster characters in a scene representing that game mode.

**Cards needed (3):**

| Mode | Scene Description |
|------|-------------------|
| **Mine** | Lobsters mining treasure underground/underwater, pickaxes, gems, gold coins |
| **Breed** | Two lobsters together with a baby lobster/egg, hearts, nurturing scene |
| **Battle** | Lobsters in combat, arena setting, action poses, energy effects |

**Specs:**
- Roughly square aspect ratio with rounded corners
- Style: Colorful, illustrated (see Crabada reference — but with lobsters, not crabs)
- Size: 600x600px minimum
- Format: PNG with transparency or solid background
- Note: We do NOT have a "Loot" mode — only Mine, Breed, Battle

---

## Task 3: Custom Cursor

A themed cursor replacing the browser default pointer. Two options to choose from:

- **Option A:** Red lobster pincher/claw
- **Option B:** Golden trident

**Variants needed:**
- Default cursor (arrow replacement)
- Pointer/hover cursor (hand replacement — e.g., claw open vs closed, or trident with glow)

**Specs:**
- Size: 32x32px
- Format: PNG (with transparency) or SVG
- Hotspot: top-left area for default, finger-tip area for pointer
- Keep it readable at small size — don't over-detail

---

## Task 4: Battle Result Templates

Victory and Defeat banner illustrations for the battle results screen. Shown after a PvP battle concludes.

**Banners needed (2):**

| Result | Style | Mood |
|--------|-------|------|
| **Victory** | Triumphant banner/ribbon, gold accents, celebratory | Bright, energetic, rewarding |
| **Defeat** | Tattered banner/ribbon, muted tones | Somber but not depressing, "try again" energy |

**Specs:**
- Underwater themed background elements (bubbles, seaweed, light rays)
- Banner/ribbon with bold text area (we'll overlay "VICTORY" / "DEFEAT" text)
- Width: 1200px, height: ~400-600px
- Format: PNG with transparency (text overlaid by code) or with text baked in
- See Crabada "DEFEAT" reference for style direction — ribbon with lobster characters holding the banner ends

---

## Task 5: Navigation & Layout Texture Assets

Decorative textures and dividers to give the UI a nautical/handcrafted feel.

| Filename | Size | Tileable? | Description |
|----------|------|-----------|-------------|
| `sidebar-wood.png` | 256x512 | Yes | Driftwood plank texture for sidebar background. Vertical grain, weathered look. |
| `divider-rope.svg` | 200x8 | Yes (horizontal) | Nautical rope/twine, horizontal. Replaces plain `border-t` dividers. |
| `nav-bottom-sand.png` | 512x64 | Yes (horizontal) | Sandstone/driftwood strip for mobile bottom navigation bar. |
| `header-wave.svg` | 1920x48 | No | Decorative wave for top of content areas. Subtle, not overpowering. |
| `divider-wave.svg` | 512x16 | Yes (horizontal) | Small wave/water line divider between page sections. |
| `footer-deco.png` | 512x32 | Yes (horizontal) | Barnacle/coral cluster strip for footer or panel bottoms. |

**General specs:**
- Color palette should work on dark ocean backgrounds (#0e1e35 to #1b4568 range)
- Textures should be subtle — enhance the theme without distracting from content
- SVGs preferred where possible for scalability
- PNGs should include transparency where appropriate

---

## Color Reference

| Token | Hex | Usage |
|-------|-----|-------|
| Ocean deep | #0e1e35 | Main background |
| Ocean mid | #142f4d | Secondary panels |
| Ocean surface | #1b4568 | Sidebar, elevated areas |
| Sand | #2a1f14 | Warm container accents |
| Driftwood | #4a3728 | Nav/divider wood tones |
| Coral | #f97066 | Active states, primary accent |
| Claw gold | #fbbf24 | Headings, rewards, highlights |
| Teal | #3fb9a0 | Success states, secondary accent |

---

## Delivery

- Drop finished assets into `packages/asset-gen/` or share via preferred method
- Name files as specified in the tables above where applicable
- Include @2x variants for any raster icons
