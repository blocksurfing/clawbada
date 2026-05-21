# Clawbada Template Editor v3

## AI-Powered Pixel Art Authoring Tool for Game Asset Creation

---

## Overview

The Clawbada Template Editor v3 is a purpose-built, browser-based pixel art authoring tool designed for creating lobster character templates for the Clawbada blockchain game. It combines professional-grade pixel art tools inspired by **Aseprite** with **AI-assisted generation** via **RetroDiffusion** (primary) and Replicate APIs, enabling rapid creation of the 60+ body part templates required for the game's 10 lobster classes.

The editor runs as a single HTML file with zero dependencies — no installation, no build step, no server. Open it in any modern browser and start creating.

---

## Why We Built This

### The Asset Challenge

Clawbada's lobster character system is ambitious: **10 unique classes**, each with **6 body parts** (Carapace, Claws, Tail, Antennae, Eyes, Legs), across **4 evolution tiers** (Base, Evolved, Elite, Apex). That's a minimum of **60 base templates**, each needing tier-specific visual progression — from a compact Base form to a fully detailed Apex form with spikes, textures, and ornamental flourishes.

Traditional pixel art workflows (draw in Aseprite, manually convert to game format, test in-engine, iterate) are slow and disconnected from the game's rendering pipeline. Every template needs to work within a specific palette role system, composite correctly with 5 other body parts, and scale across 4 evolution tiers. The feedback loop between "drawing pixels" and "seeing the result in-game" was too long.

### The Solution: Domain-Specific Tooling

Rather than fight general-purpose editors, we built one that speaks the game's language natively:

- **Palette roles instead of raw colors** — designers paint with semantic roles (Outline, PrimaryBase, SecondaryHighlight, Accent) that automatically adapt to all 10 class color schemes
- **Custom color picker** — full color spectrum for legends, class-specific accents, and class-agnostic base designs
- **Tier-aware layers** — each layer is tagged with an evolution tier, and the editor shows live previews of how the template looks at each evolution level
- **Live composite preview** — see the template rendered in all 11 palettes (Base + 10 classes) simultaneously, in a collapsible preview bar
- **AI bootstrapping** — generate a starting point from a text prompt via RetroDiffusion or Replicate, then refine by hand
- **Secure AI proxy** — artists can use AI generation through a Cloudflare Worker proxy without seeing the real API key
- **Direct JSON export** — output matches the game's template format exactly, no conversion step

### Who It's For

- **Game artists** creating the initial template library for launch
- **Community contributors** designing new lobster variants in future seasons
- **AI agents** (via RetroDiffusion/Replicate API) generating template suggestions that human artists refine
- **Game designers** rapidly prototyping new class visuals and evolution progressions

---

## Key Features

### Professional Pixel Art Tools

The editor replicates the core Aseprite workflow that pixel artists already know:

| Tool | Shortcut | Description |
|------|----------|-------------|
| **Pencil** | B | 1-pixel brush with optional pixel-perfect mode (eliminates diagonal doubles for clean lines) |
| **Eraser** | E | Erase to transparent |
| **Flood Fill** | G | Fill connected regions of the same palette role |
| **Eyedropper** | I / Alt+click | Pick a palette role from the canvas (reports custom colors in status bar) |
| **Line** | L | Bresenham line drawing with ghost preview |
| **Rectangle** | U | Outlined or filled rectangles (Shift to toggle) |
| **Selection** | M | Rectangular selection with copy, cut, paste, scale, and arrow-key movement |
| **Move** | V | Drag selected pixels or entire layer contents |
| **Hand** | H | Dedicated canvas panning tool (also available via Space+drag) |
| **Mutation Zone** | Z | Define regions where procedural variants are allowed to modify pixels |

**Symmetry modes** (None / Horizontal / Vertical / Both) apply to all drawing tools — essential for the bilateral symmetry of lobster anatomy.

**Pixel-perfect mode** automatically removes the "staircasing" artifacts that occur during freehand drawing, producing cleaner single-pixel-width lines.

### Scale Selection (Ctrl+T)

AI-generated sprites from RetroDiffusion are often larger than the 64x64 canvas. The **Scale Selection** feature lets you resize any floating selection using nearest-neighbor resampling — essential for downscaling AI output to fit the canvas.

**How to use:**

1. Create a selection (drag-select with M, or Ctrl+A for Select All)
2. Press **Ctrl+T** to open the Scale dialog (appears top-right of the canvas area)
3. Type a scale percentage (e.g., "50" to halve the size) — W and H fields update automatically
4. Or click a **preset button** (25%, 50%, 75%, 150%, 200%) for common scales
5. Press **Enter** or click **Apply** to scale the selection
6. Move the scaled selection with arrow keys or drag, then click outside to commit

**Features:**

| Feature | Description |
|---------|-------------|
| **% input** | Primary control — type a percentage to scale uniformly |
| **W x H fields** | Secondary controls for precise pixel dimensions |
| **Aspect lock** | Locked by default (`[=]`). Toggle to `[/]` to scale W and H independently |
| **Preset buttons** | Quick access to 25%, 50%, 75%, 150%, 200% scales |
| **Nearest-neighbor** | Preserves hard pixel edges — no blurring or interpolation between palette roles |
| **Multiple scales** | Each application is relative to the current size. Re-open to scale again |
| **Escape to cancel** | Close the dialog without applying any changes |

**Design note:** Nearest-neighbor is the only valid resampling method because pixels store palette role indices (0-6, 7+), not colors. Interpolating between role indices (e.g., averaging "Outline" and "PrimaryBase") would produce meaningless values. Nearest-neighbor preserves the exact role of each pixel.

The dialog auto-closes when committing, deselecting, or deleting the selection.

### Full Layer System

An Aseprite-style layer panel with arbitrary user-created layers:

- **Create, delete, rename, reorder** layers freely
- **Visibility toggle** and **opacity slider** per layer for authoring clarity
- **Tier assignment** per layer (Base / Evolved / Elite / Apex / None)
- **Sketch layers** (tier "None") for reference tracing and rough drafts — excluded from export
- **Layer operations**: Duplicate (Ctrl+J), Merge Down (Ctrl+E), Flatten Visible
- **Drag-to-reorder** stacking order

Multiple layers can share the same tier. For example, a "Body Outline" layer and a "Body Fill" layer can both be assigned to tier 0 (Base). On export, they merge seamlessly.

### Evolution Tier System

The editor's signature feature: **tier-aware pixel authoring** for the 4 evolution stages.

Each layer is tagged with one of 4 evolution tiers that control when its pixels become visible:

| Tier | Name | Visible At | Canvas Region | Purpose |
|------|------|-----------|---------------|---------|
| 0 | **Base** | All tiers (Base through Apex) | Center ~42x42 | Essential silhouette — recognizable at smallest size |
| 1 | **Evolved** | Evolved, Elite, Apex | Center ~52x52 | Body definition, secondary shapes, bulk |
| 2 | **Elite** | Elite and Apex | Center ~58x58 | Textures, patterns, class-specific markings |
| 3 | **Apex** | Apex only | Full 64x64 | Spikes, auras, elaborate flourishes, prestige details |

The **tier preview strip** shows 4 live previews side-by-side, so the designer can see exactly how the template looks at each evolution level while drawing. This eliminates the guesswork of "will this detail still read at Base size?" and ensures a satisfying visual progression from a compact Base lobster to a fully detailed Apex form.

**Per-tier guide toggles**: Each tier's boundary guide (dashed lines on the canvas) can be independently shown or hidden via color-coded checkboxes in the Options panel.

**Size progression philosophy**: Base lobsters are compact and readable (65% of canvas). Each evolution tier adds visual real estate and detail complexity. Apex lobsters fill the entire canvas with elaborate ornamentation. The progression is immediately visible and communicates power at a glance.

### AI-Assisted Generation

Built-in integration with **RetroDiffusion** (primary, purpose-built for pixel art) and **Replicate** (fallback) for AI-powered pixel art generation.

#### Two AI Modes

**Proxy mode (for artists):**
The recommended mode when handing off to a pixel artist. The artist enters a proxy URL and access token — the real API key stays on a Cloudflare Worker that you control. Daily rate limits and revocable tokens protect your credits.

**Direct mode (for developers):**
Enter your API key directly. Keys are session-only by default (cleared on tab close). Optional encrypted localStorage persistence with browser fingerprint.

#### RetroDiffusion Models & Styles

| Model | Resolution | Best For |
|-------|-----------|----------|
| **RD Fast** | 64-384px | Quick iterations, low cost |
| **RD Pro** | 96-256px | Higher quality, game assets |
| **RD Plus** | 96-256px | Balanced quality/speed |

23+ built-in pixel art styles including Game Asset, Retro Arcade, Detailed, Texture, Item Sheet, Character Sheet, and more.

#### Generation Workflow

1. **Enter a text prompt** — e.g., "pixel art, top-down view, bulwark lobster carapace, armored shell, blue-gray tones, 64x64, transparent background"
2. **Generate** — the editor calls RetroDiffusion (or Replicate) via proxy or direct API
3. **Auto-quantize** — the AI output is downscaled to 64x64 and each pixel is mapped to the nearest palette role (including custom colors) using Euclidean color distance
4. **Stamp** — apply the quantized result onto the active layer as a starting point
5. **Refine** — use the pixel art tools to clean up, adjust, and polish the AI-generated base

This workflow dramatically accelerates the initial template creation. The AI provides a reasonable starting shape and shading structure; the human artist provides the precision, consistency, and game-specific knowledge to finalize it.

### Palette System: 7 Roles + Custom Colors

#### 7 Semantic Palette Roles

Instead of painting with raw colors, designers paint with **7 semantic palette roles**:

| Role | Name | Typical Use |
|------|------|-------------|
| 0 | **Outline** | Dark contour lines defining the silhouette |
| 1 | **PrimaryShadow** | Darkest shading on the primary body color |
| 2 | **PrimaryBase** | Main body color (most-used role) |
| 3 | **PrimaryHighlight** | Light areas and specular hits on primary |
| 4 | **SecondaryBase** | Accent areas, belly, joints, markings |
| 5 | **SecondaryHighlight** | Light areas on secondary color |
| 6 | **Accent** | Small pops of contrasting color (eyes, tips, gems) |

This abstraction means a single template automatically works across all 10 class color schemes. Paint a carapace once using roles; it renders correctly in Bulwark's steel blue, Ember's fiery orange, Abyss's black-and-neon-green, and every other class palette. The **class preview strip** at the bottom of the editor shows all renderings simultaneously.

#### Custom Colors

For elements that should remain the same color regardless of class — legends, special effects, class-agnostic base designs — use the **custom color picker**:

- Click the color picker and press **+ Add Color** to add a custom color (assigned role 7+)
- Custom colors are **fixed across all class palettes** — they don't change when switching classes
- The **- Remove** button removes a custom color and clears any pixels using it
- Custom colors are included in JSON export, workspace saves, and auto-saves
- AI quantization also matches against custom colors when generating

### 11 Class Palettes

The editor includes palettes for all 10 lobster classes plus a **Base (No Class)** option:

| Index | Class | Use |
|-------|-------|-----|
| 0 | **Base (No Class)** | Neutral gray palette for class-agnostic template authoring |
| 1-10 | **Bulwark, Mantis, Leviathan, Tempest, Specter, Sentinel, Reaver, Abyss, Kraken, Ember** | Class-specific color schemes |

The Base palette lets artists design shapes and structure before applying class colors — useful for creating the initial form that all 10 classes will share.

### Canvas and Viewport

- **64x64 native resolution** — the optimal balance between pixel art aesthetics and detail capacity for tier progression
- **Zoomable** (4x to 24x) via scroll wheel, centered on cursor position
- **Adjustable zoom sensitivity** — slider control (1-10) in the right panel, essential for smooth trackpad use
- **Pannable** via Space+drag or the dedicated Hand tool (H)
- **Grid overlay** (toggleable) for precise pixel placement
- **Per-tier boundary guides** — individually toggleable dashed lines showing the canvas region for each evolution tier

### Collapsible Preview Bar

The preview bar at the bottom of the editor shows:

- **Tier previews**: 4 canvases showing the template at each evolution level (Base, Evolved, Elite, Apex)
- **Class previews**: 11 canvases showing the template in every class palette

The entire preview bar can be **collapsed or expanded** via the "Previews" toggle button in the top-right corner. The collapse state is remembered across sessions.

### File Operations

| Operation | Description |
|-----------|-------------|
| **Export JSON** (Ctrl+S) | Clawbada template format v2 — merges layers by tier, includes custom colors, ready for the game pipeline |
| **Import JSON** | Backward-compatible with v1 (48x48) and v2 (64x64) templates |
| **Import PNG** | Load a reference image behind the canvas for tracing (adjustable opacity) |
| **Batch Export PNGs** | Download separate PNG renders for each evolution tier level |
| **Save Workspace** (.clwb) | Preserve all layers, custom colors, and sketches — reopen later with full state |
| **Auto-save** | localStorage backup every 60 seconds — crash protection |

### Comprehensive Keyboard Shortcuts

| Key | Action |
|-----|--------|
| B/E/G/I/L/U/M/V/H/Z | Tool selection |
| 0-6 | Set palette role |
| X | Swap fg/bg role |
| Space+drag | Pan canvas |
| Scroll wheel | Zoom in/out (around cursor) |
| [ / ] | Zoom step |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+S | Export JSON |
| Ctrl+C/X/V/A/D | Copy/Cut/Paste/Select All/Deselect |
| Ctrl+T | Scale selection (opens Scale dialog) |
| Delete | Clear selection |
| Alt+Up/Down | Switch active layer |
| Ctrl+Shift+N | New layer |
| Ctrl+J | Duplicate layer |
| Ctrl+E | Merge down |

Every tool, operation, and layer action has a keyboard shortcut matching Aseprite conventions where possible. Full undo/redo with 100-step depth. The editor is designed to be driven almost entirely from the keyboard for experienced users.

---

## Technical Architecture

### Zero Dependencies

The entire editor is a single HTML file (~2800 lines) with inline CSS and JavaScript. No npm packages, no build tools, no framework dependencies. This is intentional:

- **Portable** — copy the file anywhere, open in any browser
- **No version rot** — no dependencies to update, no breaking changes from upstream packages
- **Instant startup** — no build step, no dev server, no hot module reload overhead
- **Inspectable** — view source to understand exactly what the tool does

### Canvas 2D Rendering

Raw `<canvas>` API with `imageSmoothingEnabled = false` for crisp pixel rendering. No canvas libraries (Fabric.js, Konva.js, etc.) — direct pixel manipulation gives full control over rendering order, performance, and the pixel-perfect aesthetic.

### Sparse Pixel Storage

Templates store only non-transparent pixels as `{x, y, role, tier}` objects rather than full 64x64 grids. A typical body part has 200-400 pixels, making template files 5-15KB of JSON. This matches the game's server-side rendering pipeline which processes sparse pixel arrays for efficiency.

### Color Resolution

All rendering paths use a unified `resolveColor(role, palette)` function:
- Roles 0-6 resolve from the active class palette (7 semantic roles)
- Roles 7+ resolve from the custom colors array (fixed across all classes)

This ensures consistent color handling across the main canvas, tier previews, class previews, batch PNG export, AI preview, and tool ghost previews.

### Mutation Zones

Designers can mark rectangular regions where the game's procedural variant generator is allowed to modify pixels. This enables 16 visual variants per template (controlled by the lobster's DNA variant nibble) while keeping the base design stable. The editor visualizes these zones as dashed orange rectangles overlaid on the canvas.

For a short designer-facing explanation with annotated visuals, see `docs/TEMPLATE_EDITOR_MUTATION_ZONE_HANDOFF.md`.

---

## AI Proxy for Artist Handoff

When sharing the editor with a pixel artist, use the **Cloudflare Worker proxy** to protect your API key:

### How It Works

```
Artist's Browser                    Cloudflare Worker              RetroDiffusion API
    |                                    |                              |
    |-- POST /generate (bearer token) -->|                              |
    |                                    |-- POST /inferences (API key)->|
    |                                    |<-- base64 image -------------|
    |<-- base64 image (sanitized) ------|                              |
```

- The real API key lives as a Cloudflare secret — never sent to the client
- Each artist gets a unique, revocable bearer token
- Daily rate limits (default: 100/day per token) prevent credit abuse
- Request validation: prompt length cap, forced single image, size limits
- Account balance info stripped from responses

### Setup (5 minutes)

```bash
# 1. Deploy the worker
cd packages/asset-gen/tools/ai-proxy
npx wrangler login
npx wrangler secret put RD_API_KEY    # paste your key
npx wrangler secret put ACCESS_TOKENS  # e.g. "artist-alice-abc123"
npx wrangler deploy

# 2. Give the artist
#    - The worker URL
#    - Their access token
#    - The editor HTML file
```

The artist sets AI mode to **Proxy**, enters the URL and token, and generates AI pixel art using your credits — without ever seeing the real API key. Revoke access anytime by removing their token.

Proxy files are located at `packages/asset-gen/tools/ai-proxy/`.

---

## Use Cases

### 1. Launch Asset Pipeline

The primary use case: a pixel artist creates all 60 base templates (6 body parts x 10 classes) needed for the Clawbada game launch. The AI assist feature accelerates initial template creation, while the tier system ensures each template has a compelling 4-stage evolution progression. The class preview strip catches palette issues across all 10 classes before they reach production.

**Workflow**: AI generate rough shape -> stamp -> refine silhouette on Base layer -> add Evolved details -> add Elite textures -> add Apex flourishes -> define mutation zones -> export JSON -> test in game pipeline -> iterate.

### 2. Community Template Contributions

Post-launch, Clawbada can open template creation to the community. The editor's zero-install design means anyone can download the HTML file and start creating. Community-created templates can be submitted for review and inclusion in seasonal updates, expanding the visual diversity of the lobster population.

### 3. Seasonal Content Updates

Each Clawbada season introduces rebalancing and potentially new visual content. The editor makes it fast to create variant templates, seasonal skins, or entirely new body part designs. The workspace save/load feature lets designers maintain work-in-progress across sessions.

### 4. AI Agent Asset Generation

The RetroDiffusion API integration enables programmatic template generation. An AI agent could generate a batch of template suggestions from text descriptions, which human artists then curate and refine. This hybrid AI-human pipeline scales content creation far beyond what manual-only workflows allow.

### 5. Game Design Prototyping

Before committing to a new lobster class or body part design, game designers can rapidly prototype visuals in the editor. The live tier preview shows whether a design concept has sufficient visual differentiation across evolution levels. The class preview strip reveals palette conflicts early. Sketch layers (tier "None") allow rough explorations without affecting the exportable template.

---

## Evolution Tier Visual Philosophy

The tier system encodes a deliberate visual storytelling progression:

### Base (Tier 0)
- **~65% of canvas** (center 42x42 of 64x64)
- Clean, compact silhouette with strong readability
- Minimal detail — the lobster should be identifiable by shape alone
- This is what new players see first; it must be appealing despite simplicity

### Evolved (Tiers 0+1)
- **~80% of canvas** (center 52x52)
- Body gains mass and definition
- Secondary shapes appear (larger claws, thicker tail, visible antennae details)
- The lobster looks "grown up" — noticeably more substantial than Base

### Elite (Tiers 0+1+2)
- **~90% of canvas** (center 58x58)
- Textures and patterns emerge (scale patterns, color gradients, class-specific markings)
- The lobster looks polished and dangerous
- Visual complexity rewards close inspection

### Apex (All Tiers — Full 64x64)
- **100% of canvas**
- Ornamental flourishes fill the remaining space (spikes, flowing appendages, energy effects, elaborate shell patterns)
- The ultimate trophy lobster — unmistakably powerful
- Maximum visual distinction between classes

This progression is designed to be **immediately readable in-game**: even at small sizes, players can distinguish a Base lobster from an Apex one by silhouette alone.

---

## Integration with the Clawbada Pipeline

```
Designer creates template in Editor v3
    | exports JSON (v2 format with tier tags + custom colors)
Template JSON placed in packages/asset-gen/src/templates/data/{bodyPart}/{class}.json
    | game pipeline loads template
Variant generator creates 16 visual variants per template (DNA-driven)
    | procedural mutations within defined zones
Color pipeline maps palette roles -> class-specific RGBA colors
    | breed type shifts hue/saturation per DNA
Compositor layers 6 body parts in Z-order
    | Carapace -> Legs -> Tail -> Eyes -> Antennae -> Claws
Evolution effects applied (tier-based pixel filtering + post-processing)
    | glow, particles, energy trails for higher tiers
Legend effects applied (if legendary)
    | special color treatment + visual flair
Upscaler renders at target resolution (64 / 128 / 256 / 512)
    | nearest-neighbor for crisp pixel art
Final PNG served via API or displayed in web UI
```

The editor is the first step in this pipeline. Every design decision in the tool — palette roles, custom colors, tier tags, mutation zones, anchor points — maps directly to a corresponding concept in the rendering engine. No format conversion, no manual data entry, no information loss.

---

## Template JSON Format (v2)

```json
{
  "bodyPart": "carapace",
  "classAffinity": 1,
  "version": 2,
  "width": 64,
  "height": 64,
  "anchor": { "x": 32, "y": 27 },
  "bounds": { "x": 10, "y": 8, "w": 44, "h": 48 },
  "mutationZones": [
    { "x": 20, "y": 15, "w": 24, "h": 20, "allowed": ["variant"] }
  ],
  "customColors": [[255, 200, 50], [100, 255, 180]],
  "pixels": [
    { "x": 15, "y": 10, "role": 0, "tier": 0 },
    { "x": 16, "y": 10, "role": 2, "tier": 0 },
    { "x": 12, "y": 8, "role": 7, "tier": 3 }
  ]
}
```

- **role 0-6**: semantic palette roles (resolved per class)
- **role 7+**: custom color indices (resolved from the `customColors` array)
- **tier 0-3**: evolution tier (Base/Evolved/Elite/Apex)
- **customColors**: optional array of `[r,g,b]` values for roles 7+
- Backward-compatible: v1 templates (48x48, no tier) import with automatic centering

---

## Comparison with Alternatives

| Feature | Aseprite | Piskel | Lospec | Clawbada Editor v3 |
|---------|----------|--------|--------|---------------------|
| Professional pixel tools | Full | Basic | Basic | Core set (Aseprite-inspired) |
| Layer system | Full | Limited | None | Full (Aseprite-style) |
| Palette role painting | No | No | No | Native (7-role + custom) |
| Evolution tier layers | No | No | No | Native (4-tier + None) |
| Multi-class preview | No | No | No | 11 simultaneous palettes |
| Tier preview strip | No | No | No | 4-level evolution preview |
| AI generation | No | No | No | RetroDiffusion + Replicate |
| AI proxy for artists | No | No | No | Cloudflare Worker proxy |
| Game format export | No | No | No | Direct JSON template export |
| Mutation zone editor | No | No | No | Built-in zone tool |
| Zero-install | No (paid) | Web app | Web app | Single HTML file |
| Pixel-perfect mode | Yes | No | No | Yes |
| Selection scale/resize | Yes | No | No | Nearest-neighbor (Ctrl+T) |
| Symmetry drawing | Yes | No | No | H/V/Both |
| Custom colors | Yes | Yes | Yes | Yes (fixed across palettes) |
| Trackpad zoom control | No | No | No | Adjustable sensitivity |

The Clawbada Editor v3 doesn't try to replace Aseprite for general pixel art. Instead, it eliminates the gap between "drawing pixels" and "seeing them in-game" by building the game's specific requirements directly into the authoring tool.

---

## Getting Started

1. Open `packages/asset-gen/tools/template-editor-v5.html` in Chrome or Firefox
2. Select a **Body Part** and **Class** from the toolbar dropdowns (use "Base (No Class)" for class-agnostic work)
3. Choose a palette role from the right panel (or press 0-6), or add a custom color
4. Start drawing with the Pencil tool (B)
5. Use the **tier preview strip** at the bottom to check evolution progression (click "Previews" to show/hide)
6. Use the **class preview strip** to verify the template works across all 11 palettes
7. Press **Ctrl+S** to export the finished template as JSON

### For AI-Assisted Creation (Proxy Mode — Artist)

1. Set AI mode to **Proxy** in the AI Assist panel
2. Enter the proxy URL and your access token (provided by the project lead)
3. Choose a style from the dropdown
4. Write a descriptive prompt for the body part you're creating
5. Click **Generate** and wait for the result
6. Click **Stamp** to apply the AI output to your active layer
7. Refine with pixel art tools until satisfied

### For AI-Assisted Creation (Direct Mode — Developer)

1. Set AI mode to **Direct API key** in the AI Assist panel
2. Select a provider (RetroDiffusion recommended) and enter your API key
3. Choose a model and style
4. Generate, stamp, and refine as above

---

## UI Theme

The editor uses a warm, light color palette designed for extended work sessions:

- **Background**: warm cream (#e8e6e1)
- **Panels**: tan (#d5d0c8)
- **Canvas area**: muted stone (#c8c4bc)
- **Accent**: muted teal (#3a6a78)
- **Text**: dark charcoal (#2a2a2a / #444) for high readability

All text meets WCAG AA contrast minimums (4.5:1 ratio) for comfortable reading.

---

*Built for the Clawbada project — an agent-first idle game on Base blockchain where AI agents assemble teams of lobster NFTs to compete through mining, breeding, and combat.*
