# Pixel Art Asset Specification — Clawbada Lobsters

**Handoff document for pixel artist + developer**
**System**: `@clawbada/asset-gen` procedural pixel art generator

---

## Table of Contents

1. [Overview](#1-overview)
2. [How the System Works](#2-how-the-system-works)
3. [Template JSON Format](#3-template-json-format)
4. [Palette Roles (The 7 "Colors" You Paint With)](#4-palette-roles)
5. [Class Palettes (10 Classes × 10 Colors)](#5-class-palettes)
6. [Body Part Specifications](#6-body-part-specifications)
7. [Mutation Zones](#7-mutation-zones)
8. [Asset Checklist (60 Templates)](#8-asset-checklist)
9. [Template Editor Tool](#9-template-editor-tool)
10. [Quality Criteria & Validation](#10-quality-criteria--validation)
11. [File Naming & Folder Structure](#11-file-naming--folder-structure)
12. [Reference Examples](#12-reference-examples)
13. [Visual Style Guide](#13-visual-style-guide)

---

## 1. Overview

Clawbada lobsters are procedurally generated pixel art characters. Each lobster is composed of **6 body parts**, each drawn from one of **10 class themes**. The system generates **16 visual variants** from each hand-authored base template, yielding **960 unique body part appearances** from just **60 base templates**.

### What You're Making

| Item | Count | Description |
|------|-------|-------------|
| **Base templates** | 60 | 6 body parts × 10 classes. Hand-authored JSON pixel files. |
| **Procedural variants** | 960 | 16 auto-generated variants per template. You define where mutations can happen. |
| **Assembled lobsters** | Billions | Any combination of 6 body parts from any class. The system composites them. |

### Key Numbers

| Property | Value |
|----------|-------|
| Canvas size | **48 × 48 pixels** |
| Display sizes | 48, 96, 192, 384 (nearest-neighbor upscale) |
| Colors per template | **7 palette roles** (not raw colors) |
| Templates needed | **60 total** (3 exist as reference, 57 remaining) |
| Target pixel count | **300-800 pixels** per template (typical) |
| File format | Sparse JSON (only non-transparent pixels) |

---

## 2. How the System Works

```
Artist creates base template (JSON)
  ↓
System generates 16 variants (mutations within defined zones)
  ↓
System applies class palette colors (template role 2 → class primary color)
  ↓
System applies breed type color shift (hue rotation, saturation adjust)
  ↓
6 body parts composited into one lobster (layered back-to-front)
  ↓
Optional evolution effects (glow, particles for evolved lobsters)
  ↓
Optional legend effects (per-class special treatment for rare legends)
  ↓
Upscale to display size (nearest-neighbor, stays crisp)
```

**Critical concept**: You paint with **role indices** (numbers 0-9), not actual colors. The same template renders in any of the 10 class color schemes. Role 2 is always "primary base color" — it becomes steel blue for Bulwark, jade green for Mantis, bright red for Reaver, etc.

---

## 3. Template JSON Format

Each template is a JSON file with this exact structure:

```json
{
  "bodyPart": "carapace",
  "classAffinity": 0,
  "version": 1,
  "width": 48,
  "height": 48,
  "anchor": { "x": 24, "y": 20 },
  "bounds": { "x": 12, "y": 11, "w": 24, "h": 18 },
  "mutationZones": [
    {
      "x": 14, "y": 13, "w": 20, "h": 4,
      "allowed": ["shift_pixels", "thicken", "detail_overlay"]
    }
  ],
  "pixels": [
    {"x":18,"y":11,"role":0},
    {"x":19,"y":11,"role":0},
    {"x":20,"y":12,"role":2}
  ]
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `bodyPart` | string | One of: `carapace`, `claws`, `tail`, `antennae`, `eyes`, `legs` |
| `classAffinity` | number | Class index 0-9 (see [Class Palettes](#5-class-palettes)) |
| `version` | number | Always `1` |
| `width` | number | Always `48` |
| `height` | number | Always `48` |
| `anchor` | `{x, y}` | Compositing alignment point (see [Body Part Specs](#6-body-part-specifications)) |
| `bounds` | `{x, y, w, h}` | Tight bounding box of all non-transparent pixels |
| `mutationZones` | array | Rectangles where procedural variants may modify pixels |
| `pixels` | array | Every non-transparent pixel: `{x, y, role}` |

### Pixel Format

Each pixel has:
- `x`: horizontal position, 0 (left) to 47 (right)
- `y`: vertical position, 0 (top) to 47 (bottom)
- `role`: palette role index, 0-6 (see next section)

**Only non-transparent pixels are listed.** Any coordinate not in the array is fully transparent.

---

## 4. Palette Roles

You paint with 7 abstract roles instead of specific colors. The rendering system maps these to actual RGBA colors based on the lobster's class.

| Role | Index | Name | Purpose | Usage Guide |
|------|-------|------|---------|-------------|
| **Outline** | `0` | `outline` | Darkest color, defines silhouette edges | 1px border around entire shape. **Every template must have a complete outline.** |
| **Primary Shadow** | `1` | `primaryShadow` | Dark shade of primary | Bottom edges, underside, depth shading, shadow areas |
| **Primary Base** | `2` | `primaryBase` | Main body color | Largest area — the primary fill of the body part |
| **Primary Highlight** | `3` | `primaryHighlight` | Light shade of primary | Top edges, light-catching surfaces, specular highlights |
| **Secondary Base** | `4` | `secondaryBase` | Contrasting detail color | Markings, patterns, joints, segmentation lines |
| **Secondary Highlight** | `5` | `secondaryHighlight` | Light shade of secondary | Highlights on secondary features |
| **Accent** | `6` | `accent` | Pop color, eye-catching | Sparingly used — eyes, glowing tips, special markings (2-8 pixels typical) |

### Role Distribution Guidelines

A well-balanced template typically has this approximate distribution:

| Role | % of pixels | Notes |
|------|------------|-------|
| Outline (0) | 25-35% | Complete 1px border, critical for silhouette |
| Primary Shadow (1) | 10-20% | Bottom/right edges, depth |
| Primary Base (2) | 25-40% | Largest area, main fill |
| Primary Highlight (3) | 8-15% | Top/left edges, catching light |
| Secondary Base (4) | 5-15% | Class-distinctive patterns/details |
| Secondary Highlight (5) | 2-8% | Highlights on secondary areas |
| Accent (6) | 1-3% | Very sparse, maximum 2-8 pixels |

### Shading Convention

Light source is from the **top-left**:
- **Top and left edges** → highlight (role 3)
- **Bottom and right edges** → shadow (role 1)
- **Interior** → base (role 2)
- **Inner details/markings** → secondary (roles 4, 5)
- **Special points** → accent (role 6)

---

## 5. Class Palettes

Each of the 10 classes has a distinct color scheme with **10 explicit palette roles**. All shadow and highlight values are designer-specified (no auto-derivation). Your template roles map to these colors:

### 0: Bulwark — Tank (Steel Blue / Slate Gray / Titanium White)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Dark navy | `#1A2533` | Near-black blue |
| 1 Prim Shadow | Dark steel | `#294F75` | Deep steel blue |
| 2 Prim Base | Steel blue | `#4682B4` | Main body color |
| 3 Prim Highlight | Light steel | `#78AAD2` | Brightened steel blue |
| 4 Sec Shadow | Dark slate | `#434D57` | Deep slate gray |
| 5 Sec Base | Slate gray | `#708090` | Gray markings |
| 6 Sec Highlight | Light slate | `#96A5AF` | Lighter gray |
| 7 Acc Shadow | Medium gray | `#B5B5B5` | Muted white |
| 8 Acc Base | Light gray | `#E8E8E8` | Near-white |
| 9 Acc Highlight | Titanium white | `#FAFAFA` | Brightest white |

### 1: Mantis — Assassin (Jade Green / Dark Teal / Warm Yellow)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Dark forest | `#002E1D` | Very dark green |
| 1 Prim Shadow | Dark jade | `#006E46` | Deep jade |
| 2 Prim Base | Jade green | `#00A86B` | Main body color |
| 3 Prim Highlight | Light jade | `#32D28C` | Brightened jade |
| 4 Sec Shadow | Near-black | `#171C1E` | Very dark teal |
| 5 Sec Base | Dark teal | `#20282A` | Dark markings |
| 6 Sec Highlight | Muted teal | `#2B353B` | Subtle dark teal |
| 7 Acc Shadow | Dark gold | `#D7A22F` | Deep warm yellow |
| 8 Acc Base | Warm yellow | `#FFE017` | Golden yellow |
| 9 Acc Highlight | Bright yellow | `#FDFF6B` | Pale lemon |

### 2: Leviathan — Bruiser (Deep Navy / Bronze / Dark Iron)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Abyss blue | `#000030` | Nearly pure black-blue |
| 1 Prim Shadow | Dark navy | `#000052` | Deep navy |
| 2 Prim Base | Deep navy | `#000080` | Main body color |
| 3 Prim Highlight | Medium blue | `#2828AA` | Brightened navy |
| 4 Sec Shadow | Dark bronze | `#7B4C1E` | Deep bronze |
| 5 Sec Base | Bronze | `#CD7F32` | Warm metallic markings |
| 6 Sec Highlight | Light bronze | `#E1A55A` | Lighter bronze |
| 7 Acc Shadow | Dark iron | `#4A4A4A` | Deep gray-metal |
| 8 Acc Base | Iron | `#707070` | Medium gray |
| 9 Acc Highlight | Light iron | `#888888` | Lighter gray |

### 3: Tempest — Nuker (Storm Gray / Electric Blue / Arc-flash Purple)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Deep storm | `#0D1D1F` | Very dark teal-black |
| 1 Prim Shadow | Dark storm | `#1A3A3D` | Dark teal-gray |
| 2 Prim Base | Storm gray | `#3C505A` | Main body color |
| 3 Prim Highlight | Light storm | `#4D6B77` | Brightened storm |
| 4 Sec Shadow | Muted blue | `#5596B9` | Deep electric blue |
| 5 Sec Base | Electric blue | `#48BEC8` | Vibrant teal-blue |
| 6 Sec Highlight | Ice blue | `#7DF9FF` | Bright electric |
| 7 Acc Shadow | Dark purple | `#2C21C4` | Deep violet |
| 8 Acc Base | Arc-flash | `#392BFF` | Vivid purple-blue |
| 9 Acc Highlight | Light flash | `#3D51FF` | Bright purple-blue |

### 4: Specter — Debuffer (Ghost Purple / Deep Teal / Spectral Green)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Void purple | `#1E1840` | Very dark purple |
| 1 Prim Shadow | Dark purple | `#4F3CAA` | Deep purple |
| 2 Prim Base | Ghost purple | `#7B68EE` | Medium slate blue |
| 3 Prim Highlight | Light purple | `#A591FF` | Brightened purple |
| 4 Sec Shadow | Dark ocean | `#184767` | Deep blue-teal |
| 5 Sec Base | Deep teal | `#116777` | Teal markings |
| 6 Sec Highlight | Teal | `#008B8B` | Classic teal |
| 7 Acc Shadow | Dark emerald | `#40AC83` | Deep green |
| 8 Acc Base | Spectral green | `#59D388` | Medium green |
| 9 Acc Highlight | Bright green | `#75E76A` | Vivid green |

### 5: Sentinel — Support (Mint Sage / Lime Chartreuse / Teal Aqua)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Dark sage | `#2A3E3B` | Very dark teal |
| 1 Prim Shadow | Muted sage | `#82B3AD` | Deep sage |
| 2 Prim Base | Mint sage | `#A9D8C3` | Main body color |
| 3 Prim Highlight | Light mint | `#CEF9EA` | Pale mint |
| 4 Sec Shadow | Dark chartreuse | `#BFB55F` | Olive-gold |
| 5 Sec Base | Lime | `#D4E77F` | Chartreuse |
| 6 Sec Highlight | Light lime | `#E6F7B4` | Pale lime |
| 7 Acc Shadow | Steel teal | `#5EAFC3` | Muted teal |
| 8 Acc Base | Teal aqua | `#66D0BC` | Medium aqua |
| 9 Acc Highlight | Bright aqua | `#7DFFE6` | Vivid aqua |

### 6: Reaver — DPS (Bright Red / Near-Black / Gold Orange)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Blood black | `#3D0510` | Very dark red-black |
| 1 Prim Shadow | Dark crimson | `#960A23` | Deep red |
| 2 Prim Base | Bright red | `#DC1400` | Vivid red |
| 3 Prim Highlight | Hot red | `#FF2200` | Bright scarlet |
| 4 Sec Shadow | Near-black | `#14191A` | Very dark |
| 5 Sec Base | Dark | `#20282A` | Dark markings |
| 6 Sec Highlight | Muted dark | `#2B353B` | Subtle dark |
| 7 Acc Shadow | Deep orange | `#FF6C00` | Vivid orange |
| 8 Acc Base | Gold orange | `#FFA317` | Amber-orange |
| 9 Acc Highlight | Bright gold | `#FFD120` | Golden yellow |

### 7: Abyss — Lifesteal (Dark Teal / Dark Gray-Blue / Neon Green)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Void | `#060D13` | Near-black blue |
| 1 Prim Shadow | Deep abyss | `#0E1B26` | Very dark blue |
| 2 Prim Base | Dark teal | `#1F2C2C` | Main body color |
| 3 Prim Highlight | Muted teal | `#1F3E39` | Subtle dark green |
| 4 Sec Shadow | Deep night | `#151628` | Very dark purple |
| 5 Sec Base | Dark gray-blue | `#282C3B` | Dark markings |
| 6 Sec Highlight | Muted gray | `#323B3B` | Subtle gray-teal |
| 7 Acc Shadow | Dark green | `#00A811` | Deep neon |
| 8 Acc Base | Neon green | `#00D616` | Bright green |
| 9 Acc Highlight | Toxic green | `#4DFF00` | Maximum neon |

**Special note for Abyss**: The primary and secondary colors are extremely dark. The visual interest comes almost entirely from the accent (neon green). Use more accent pixels than other classes — accent markings should be prominent.

### 8: Kraken — Controller (Dark Teal / Bronze / Coral)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Deep teal | `#002020` | Very dark teal |
| 1 Prim Shadow | Dark teal | `#005A5A` | Deep teal |
| 2 Prim Base | Teal | `#008080` | Classic teal |
| 3 Prim Highlight | Light teal | `#32AAAA` | Brightened teal |
| 4 Sec Shadow | Dark bronze | `#9F5423` | Deep bronze |
| 5 Sec Base | Bronze | `#CD7F32` | Warm metallic |
| 6 Sec Highlight | Light bronze | `#E1A55A` | Lighter bronze |
| 7 Acc Shadow | Dark coral | `#D44240` | Deep red |
| 8 Acc Base | Coral | `#E1674F` | Warm coral |
| 9 Acc Highlight | Light coral | `#FD9460` | Pale salmon |

### 9: Ember — Glass Cannon (Dark Brown / Dark Purple-Gray / Amber)

| Role | Color | Hex | Visual |
|------|-------|-----|--------|
| 0 Outline | Charcoal | `#150E0B` | Near-black brown |
| 1 Prim Shadow | Dark brown | `#291B16` | Deep brown |
| 2 Prim Base | Brown | `#381E18` | Main body color |
| 3 Prim Highlight | Warm brown | `#451E1C` | Reddish brown |
| 4 Sec Shadow | Deep purple | `#1E1922` | Very dark purple |
| 5 Sec Base | Dark purple-gray | `#26232A` | Dark markings |
| 6 Sec Highlight | Muted purple | `#3F353B` | Subtle dark |
| 7 Acc Shadow | Dark amber | `#B43C00` | Deep orange |
| 8 Acc Base | Amber | `#CD7000` | Main glow color |
| 9 Acc Highlight | Bright amber | `#E9AA17` | Golden glow |

---

## 6. Body Part Specifications

Each body part has a fixed **anchor point** for compositing alignment. All 6 layers are drawn on the same 48×48 canvas. The anchor is the reference point where the body part "attaches" to the lobster.

### Compositing Layer Order (back to front)

```
Layer 1 (back):   Carapace  — main shell (largest, background)
Layer 2:          Legs      — walking legs (behind body)
Layer 3:          Tail      — tail fan (behind body)
Layer 4:          Eyes      — eye stalks (on top of shell)
Layer 5:          Antennae  — feelers (on top of shell)
Layer 6 (front):  Claws     — pincers (foreground, most visible)
```

### Part 0: Carapace (Shell)

| Property | Value |
|----------|-------|
| **Anchor** | `{x: 24, y: 20}` — center-back of shell |
| **Stat affinity** | HP (health) |
| **Typical bounds** | ~24×18 pixels |
| **Typical pixel count** | 350-450 |

**Design direction**: The main body shell. Dome-shaped, widest part of the lobster. This is the **largest single template** — occupies the center of the canvas.

**Class differentiation**:
- **Bulwark**: Wide, thick, heavy-plated dome with reinforced ridges
- **Mantis**: Sleek, narrow, streamlined shell with sharp edges
- **Leviathan**: Massive, broad shell with ancient/barnacled texture
- **Tempest**: Angular, crystalline shell with lightning-bolt edges
- **Specter**: Ethereal, partially transparent-looking, wispy edges
- **Sentinel**: Ornate, shield-like shell with decorative patterns
- **Reaver**: Spiky, aggressive shell with barb-like protrusions
- **Abyss**: Smooth, featureless void with toxic green vein patterns
- **Kraken**: Organic, tentacle-ridge textures, deep-sea feel
- **Ember**: Cracked/magma-veined shell, jagged heat-warped edges

**Secondary/accent usage**: Secondary color for shell patterns, segmentation lines, and class-specific markings. Accent for 2-4 special feature pixels (eyes of patterns, gem-like highlights).

### Part 1: Claws (Pincers)

| Property | Value |
|----------|-------|
| **Anchor** | `{x: 12, y: 28}` — front-center attachment |
| **Stat affinity** | Attack |
| **Typical bounds** | ~23×22 pixels |
| **Typical pixel count** | 300-400 |

**Design direction**: The signature fighting appendages. Drawn as a **pair** — both left and right claw in one template. Claws are the **frontmost layer** and most visually prominent feature.

**Class differentiation**:
- **Bulwark**: Broad, shield-like crusher claws — defense-oriented shape
- **Mantis**: Long, thin, blade-like raptorial claws — assassin strikes
- **Leviathan**: Massive, heavy crusher claws — brute power
- **Tempest**: Forked, trident-like claws — lightning rod shapes
- **Specter**: Thin, ghostly, translucent-looking claws — wispy
- **Sentinel**: Ornate, golden-rimmed claws — ceremonial appearance
- **Reaver**: Serrated, saw-tooth claws — designed to rend
- **Abyss**: Smooth claws with glowing vein lines — draining
- **Kraken**: Tentacle-like gripping claws — wrapping, binding
- **Ember**: Incandescent claws, flame-shaped tips — burning

**Note**: The claws template should include BOTH claws as a single unit. Position the pair symmetrically around the anchor point. The left claw is typically at x=2-12, the right claw "arm" extends to x=14-24.

### Part 2: Tail

| Property | Value |
|----------|-------|
| **Anchor** | `{x: 34, y: 36}` — back-low attachment |
| **Stat affinity** | Speed |
| **Typical bounds** | ~21×21 pixels |
| **Typical pixel count** | 250-350 |

**Design direction**: The tail fan and uropods. Extends from the back-bottom of the lobster. Shape conveys speed class identity.

**Class differentiation**:
- **Bulwark**: Wide, flat, armored tail fan — stable, heavy
- **Mantis**: Narrow, streamlined tail — aerodynamic/aquadynamic
- **Leviathan**: Broad, powerful tail — rudder-like, massive
- **Tempest**: Forked, lightning-bolt tail — split energy streams
- **Specter**: Wispy, fading-edge tail — partially dissolved
- **Sentinel**: Fan-shaped, ceremonial tail — peacock-like spread
- **Reaver**: Barbed, weaponized tail — scorpion-sting vibe
- **Abyss**: Tendril-like, dark with green veins — organic horror
- **Kraken**: Multi-tipped tentacle tail — deep-sea appendage
- **Ember**: Flame-shaped tail fan — rising fire pattern (see reference: `tail/ember.json`)

**Note**: The Ember reference template shows a multi-flame fan pattern with 5 flame tips at the top, converging to a narrow stalk at the bottom. Use this as a guide for the level of detail.

### Part 3: Antennae

| Property | Value |
|----------|-------|
| **Anchor** | `{x: 18, y: 10}` — top-front attachment |
| **Stat affinity** | Critical (crit chance) |
| **Typical bounds** | ~20×16 pixels |
| **Typical pixel count** | 150-250 |

**Design direction**: Two antennae/feelers extending from the top of the head. Thinner and more delicate than other parts. The most "fragile" looking part.

**Class differentiation**:
- **Bulwark**: Short, sturdy, armored antennae — thick base, blunt tips
- **Mantis**: Long, thin, whip-like antennae — sensitive, lethal precision
- **Leviathan**: Thick, barnacle-encrusted antennae — ancient
- **Tempest**: Crackling, forked antenna tips — lightning rods
- **Specter**: Ghostly, semi-transparent, flickering antennae
- **Sentinel**: Ornate, banner-like antennae — regal
- **Reaver**: Barbed, hooked antennae — weaponized sensing
- **Abyss**: Bioluminescent-tipped dark antennae — deep-sea lures
- **Kraken**: Sucker-lined, tentacle-like antennae — grasping
- **Ember**: Flame-tipped antennae — ember glow at tips

**Note**: Antennae are the **thinnest** body part. Most of the shape is 1-2 pixels wide. Use outline (0) for the main structure, with small clusters of primary/secondary at bases and tips. Accent pixels at the very tips for class flavor.

### Part 4: Eyes

| Property | Value |
|----------|-------|
| **Anchor** | `{x: 16, y: 18}` — front-high attachment |
| **Stat affinity** | Armor (defense) |
| **Typical bounds** | ~16×14 pixels |
| **Typical pixel count** | 150-250 |

**Design direction**: Two eyes on stalks, lobster-style. The stalks emerge from the front-top of the shell. Eyes are a key personality/expression feature.

**Class differentiation**:
- **Bulwark**: Thick-stalked, armored eyes — visor-slit pupils
- **Mantis**: Wide, compound-eye style — predator vision
- **Leviathan**: Deep-set, ancient eyes — wise/heavy-lidded
- **Tempest**: Bright, electric-glowing eyes — crackling energy
- **Specter**: Hollow, ghostly eyes — empty glow
- **Sentinel**: Bright, alert, golden-rimmed eyes — watchful guardian
- **Reaver**: Narrow, aggressive, red-glowing eyes — predatory
- **Abyss**: Void eyes with green pinpoint pupils — unsettling
- **Kraken**: Large, intelligent, deep-sea eyes — observing
- **Ember**: Ember-glowing, smoldering eyes — intense heat

**Note**: Eyes are paired (left and right stalk). The eye surfaces themselves are great places for accent (role 6) pixels — 2-4 accent pixels for iris/pupil highlights make the lobster feel alive.

### Part 5: Legs

| Property | Value |
|----------|-------|
| **Anchor** | `{x: 24, y: 38}` — bottom-center attachment |
| **Stat affinity** | HP (health, same as carapace) |
| **Typical bounds** | ~28×12 pixels |
| **Typical pixel count** | 200-300 |

**Design direction**: Walking legs (pereopods). Typically 3-4 pairs visible from a side/top-down perspective. Legs extend below and slightly to the sides of the body.

**Class differentiation**:
- **Bulwark**: Thick, armored, sturdy legs — pillars
- **Mantis**: Long, thin, articulated legs — fast movement
- **Leviathan**: Massive, powerful legs — trunk-like
- **Tempest**: Jointed, angular legs — lightning-bolt segments
- **Specter**: Thin, fading legs — some legs seem to disappear
- **Sentinel**: Armored, decorated legs — greaves/shin-guard look
- **Reaver**: Spiked, aggressive legs — caltrops on joints
- **Abyss**: Skeletal, dark legs with green joint markings
- **Kraken**: Tentacle-hybrid legs — organic, flowing curves
- **Ember**: Heat-cracked legs with glowing joint points

**Note**: Legs are drawn behind the main body (Layer 2, after carapace). They should peek out from under/around the shell. Use primarily outline and primary shadow/base colors — legs are less detailed than claws or carapace.

---

## 7. Mutation Zones

Each template must define **2-4 rectangular mutation zones** — areas where the procedural variant system is allowed to modify pixels. Pixels outside these zones are **never changed** by the variant generator.

### Purpose

The system generates 16 variants from each template by applying random mutations inside these zones:

| Variant Range | Tier | Mutations Applied | Style |
|---------------|------|-------------------|-------|
| 0 | — | None (exact base template) | Original |
| 1-3 | Simple | 0-2 mutations | Simplified, minor edge changes |
| 4-7 | Moderate | 2-4 mutations | Small additions, thickening |
| 8-11 | Detailed | 3-6 mutations | Patterns, overlays |
| 12-15 | Elaborate | 5-8 mutations | Maximum elaboration |

### 6 Mutation Types

| Mutation | Description | Best Zone Placement |
|----------|-------------|---------------------|
| `add_pixels` | Extends silhouette at edges (spikes, bumps) | Outer edges, tips |
| `remove_pixels` | Thins/simplifies by removing non-outline pixels | Dense interior areas |
| `shift_pixels` | Moves a sub-region 1-2px for organic feel | Any interior area |
| `thicken` | Expands outlines inward | Thin areas, edges |
| `pattern_fill` | Adds interior patterns (dots, stripes, checkerboard) | Large flat interior areas |
| `detail_overlay` | Places small 2×2 or 3×3 decorative clusters | Mid-body feature areas |

### Zone Placement Guidelines

1. **Zone 1 — Edge zone**: Place along the most distinctive silhouette edge (top of shell, claw tips, tail fan edge). Allow `shift_pixels`, `thicken`, `add_pixels`.
2. **Zone 2 — Interior zone**: Place over the largest flat interior area. Allow `pattern_fill`, `detail_overlay`, `add_pixels`.
3. **Zone 3 — Detail zone**: Place over a secondary feature area (joint, marking, pattern). Allow `shift_pixels`, `add_pixels`, `remove_pixels`.
4. **Optional Zone 4**: Only if the part is large enough. Cover a distinct sub-feature.

### Rules

- Zones **may overlap** — the system handles this correctly
- Zones must stay **within the 48×48 canvas** (`x + w <= 48`, `y + h <= 48`)
- Zones should **not cover the entire template** — leave some areas stable
- **Do not place zones over critical structural pixels** (like the single anchor attachment point area) unless you want them to vary
- Each zone must list **at least 1** allowed mutation type, recommend **2-3**
- Zones covering small areas (< 4×4) should only allow `shift_pixels` or `add_pixels`

### Example (from `carapace/bulwark.json`)

```json
"mutationZones": [
  {
    "x": 14, "y": 13, "w": 20, "h": 4,
    "allowed": ["shift_pixels", "thicken", "detail_overlay"]
  },
  {
    "x": 13, "y": 17, "w": 22, "h": 6,
    "allowed": ["pattern_fill", "add_pixels", "detail_overlay"]
  },
  {
    "x": 15, "y": 23, "w": 18, "h": 5,
    "allowed": ["add_pixels", "remove_pixels", "thicken"]
  }
]
```

This places zones across: the top highlight band (zone 1), the middle body (zone 2), and the lower edge (zone 3). The shell's outline border pixels and anchor area are outside the zones.

---

## 8. Asset Checklist (60 Templates)

### Completed (3/60) — Use as Reference

| # | Body Part | Class | File | Pixel Count |
|---|-----------|-------|------|-------------|
| 1 | Carapace | Bulwark (0) | `carapace/bulwark.json` | ~364 |
| 2 | Claws | Mantis (1) | `claws/mantis.json` | ~340 |
| 3 | Tail | Ember (9) | `tail/ember.json` | ~350 |

### Remaining (57/60) — To Be Created

#### Carapace (9 remaining)

| # | Class | `classAffinity` | File | Notes |
|---|-------|-----------------|------|-------|
| 4 | Mantis | 1 | `carapace/mantis.json` | Sleek, streamlined shell |
| 5 | Leviathan | 2 | `carapace/leviathan.json` | Massive, ancient shell |
| 6 | Tempest | 3 | `carapace/tempest.json` | Angular, crystalline shell |
| 7 | Specter | 4 | `carapace/specter.json` | Ethereal, wispy-edged shell |
| 8 | Sentinel | 5 | `carapace/sentinel.json` | Ornate shield-like shell |
| 9 | Reaver | 6 | `carapace/reaver.json` | Spiky, aggressive shell |
| 10 | Abyss | 7 | `carapace/abyss.json` | Smooth void + green veins |
| 11 | Kraken | 8 | `carapace/kraken.json` | Organic, tentacle-ridged shell |
| 12 | Ember | 9 | `carapace/ember.json` | Cracked/magma-veined shell |

#### Claws (9 remaining)

| # | Class | `classAffinity` | File | Notes |
|---|-------|-----------------|------|-------|
| 13 | Bulwark | 0 | `claws/bulwark.json` | Broad shield-crusher claws |
| 14 | Leviathan | 2 | `claws/leviathan.json` | Heavy crusher claws |
| 15 | Tempest | 3 | `claws/tempest.json` | Forked trident-like claws |
| 16 | Specter | 4 | `claws/specter.json` | Ghostly thin claws |
| 17 | Sentinel | 5 | `claws/sentinel.json` | Golden ornate claws |
| 18 | Reaver | 6 | `claws/reaver.json` | Serrated saw-tooth claws |
| 19 | Abyss | 7 | `claws/abyss.json` | Dark claws w/ green veins |
| 20 | Kraken | 8 | `claws/kraken.json` | Tentacle-gripping claws |
| 21 | Ember | 9 | `claws/ember.json` | Flame-tipped incandescent claws |

#### Tail (9 remaining)

| # | Class | `classAffinity` | File | Notes |
|---|-------|-----------------|------|-------|
| 22 | Bulwark | 0 | `tail/bulwark.json` | Wide armored tail fan |
| 23 | Mantis | 1 | `tail/mantis.json` | Narrow streamlined tail |
| 24 | Leviathan | 2 | `tail/leviathan.json` | Broad powerful tail |
| 25 | Tempest | 3 | `tail/tempest.json` | Forked lightning tail |
| 26 | Specter | 4 | `tail/specter.json` | Wispy fading-edge tail |
| 27 | Sentinel | 5 | `tail/sentinel.json` | Fan-shaped ceremonial tail |
| 28 | Reaver | 6 | `tail/reaver.json` | Barbed scorpion-sting tail |
| 29 | Abyss | 7 | `tail/abyss.json` | Tendril dark tail |
| 30 | Kraken | 8 | `tail/kraken.json` | Multi-tip tentacle tail |

#### Antennae (10 — all needed)

| # | Class | `classAffinity` | File | Notes |
|---|-------|-----------------|------|-------|
| 31 | Bulwark | 0 | `antennae/bulwark.json` | Short, sturdy, armored |
| 32 | Mantis | 1 | `antennae/mantis.json` | Long, thin, whip-like |
| 33 | Leviathan | 2 | `antennae/leviathan.json` | Thick, barnacle-encrusted |
| 34 | Tempest | 3 | `antennae/tempest.json` | Crackling forked tips |
| 35 | Specter | 4 | `antennae/specter.json` | Ghostly, flickering |
| 36 | Sentinel | 5 | `antennae/sentinel.json` | Ornate, banner-like |
| 37 | Reaver | 6 | `antennae/reaver.json` | Barbed, hooked |
| 38 | Abyss | 7 | `antennae/abyss.json` | Bioluminescent-tipped |
| 39 | Kraken | 8 | `antennae/kraken.json` | Sucker-lined tentacle |
| 40 | Ember | 9 | `antennae/ember.json` | Flame-tipped |

#### Eyes (10 — all needed)

| # | Class | `classAffinity` | File | Notes |
|---|-------|-----------------|------|-------|
| 41 | Bulwark | 0 | `eyes/bulwark.json` | Thick-stalked, armored |
| 42 | Mantis | 1 | `eyes/mantis.json` | Wide compound-eye style |
| 43 | Leviathan | 2 | `eyes/leviathan.json` | Deep-set, ancient |
| 44 | Tempest | 3 | `eyes/tempest.json` | Electric-glowing |
| 45 | Specter | 4 | `eyes/specter.json` | Hollow, ghostly |
| 46 | Sentinel | 5 | `eyes/sentinel.json` | Bright, golden-rimmed |
| 47 | Reaver | 6 | `eyes/reaver.json` | Narrow, aggressive |
| 48 | Abyss | 7 | `eyes/abyss.json` | Void with green pinpoints |
| 49 | Kraken | 8 | `eyes/kraken.json` | Large, intelligent |
| 50 | Ember | 9 | `eyes/ember.json` | Smoldering, intense |

#### Legs (10 — all needed)

| # | Class | `classAffinity` | File | Notes |
|---|-------|-----------------|------|-------|
| 51 | Bulwark | 0 | `legs/bulwark.json` | Thick, armored pillars |
| 52 | Mantis | 1 | `legs/mantis.json` | Long, thin, articulated |
| 53 | Leviathan | 2 | `legs/leviathan.json` | Massive, trunk-like |
| 54 | Tempest | 3 | `legs/tempest.json` | Angular, lightning-bolt |
| 55 | Specter | 4 | `legs/specter.json` | Thin, fading |
| 56 | Sentinel | 5 | `legs/sentinel.json` | Armored greaves |
| 57 | Reaver | 6 | `legs/reaver.json` | Spiked, aggressive |
| 58 | Abyss | 7 | `legs/abyss.json` | Skeletal, green joints |
| 59 | Kraken | 8 | `legs/kraken.json` | Tentacle-hybrid curves |
| 60 | Ember | 9 | `legs/ember.json` | Heat-cracked, glowing joints |

---

## 9. Template Editor Tool

A browser-based pixel editor is included at:

```
packages/asset-gen/tools/template-editor.html
```

Open it directly in any browser (no build step needed).

### Features

- **48×48 grid** at 12× zoom with toggleable grid lines
- **7-role palette bar** — click a role to select, then click pixels to paint
- **Eraser tool** — right-click to erase pixels (set to transparent)
- **Live preview strip** — shows the template rendered in all 10 class palettes simultaneously
- **Mutation zone drawing** — shift+drag to define rectangular mutation zones
- **JSON export** — click Export to get the complete template JSON
- **JSON import** — paste existing template JSON and click Import to continue editing
- **Keyboard shortcuts**:
  - `0`-`6` — select role 0-6
  - `E` — select eraser
  - `G` — toggle grid
  - `Z` — toggle mutation zone mode

### Workflow

1. Open `template-editor.html` in browser
2. Select a role from the palette bar (start with role 0 for outline)
3. Draw the body part outline first, then fill interior with roles 1-6
4. Switch to mutation zone mode (Z key) and draw 2-4 zones
5. Check the live preview strip — all 10 classes should look good
6. Export JSON → save to `packages/asset-gen/src/templates/data/<part>/<class>.json`
7. Validate: `bun packages/asset-gen/src/cli.ts validate-templates`

### Validation CLI Commands

```bash
# Validate all templates
bun packages/asset-gen/src/cli.ts validate-templates

# Render a single variant to check quality
bun packages/asset-gen/src/cli.ts variant carapace bulwark 0 --size 192

# Generate a 16-variant sheet for visual QA
bun packages/asset-gen/src/cli.ts sheet carapace bulwark --size 96

# Preview all templates (grid of everything)
bun packages/asset-gen/src/cli.ts preview-all --cellsize 48
```

---

## 10. Quality Criteria & Validation

### Automatic Validation (run `validate-templates`)

The system checks:
- `version` is `1`
- `width` and `height` are both `48`
- `bodyPart` is one of the 6 valid names
- `classAffinity` is 0-9
- `anchor` has numeric `x` and `y`
- `bounds` has numeric `x`, `y`, `w`, `h`
- All mutation zones are within canvas bounds (0-47)
- Each mutation zone has at least 1 valid `allowed` mutation type
- All pixels have valid `x` (0-47), `y` (0-47), and `role` (0-6)
- No duplicate pixel coordinates

### Manual Quality Checks

After creating each template, verify:

1. **Complete outline**: Every non-transparent pixel that borders a transparent pixel should have an outline-adjacent pixel (role 0). The silhouette must be fully enclosed.

2. **Correct anchor point**: Must match the default anchors listed in Body Part Specs. This is critical for compositing — wrong anchors cause parts to misalign.

3. **Accurate bounds**: The `bounds` rectangle must tightly contain all pixels. Calculate as: `{x: minX, y: minY, w: maxX-minX+1, h: maxY-minY+1}`.

4. **Cross-class compositing**: Render your template with parts from OTHER classes. A Bulwark carapace must look good paired with a Mantis claw and an Ember tail. No pixel overlap conflicts between layers.

5. **Variant quality**: Generate all 16 variants (`sheet` command) and verify:
   - Variant 0 matches the base template exactly
   - No variants produce disconnected pixels (floating dots)
   - No variants break the outline
   - Elaborate variants (12-15) look interestingly different from the base

6. **Pixel count range**: Templates should have 150-450 pixels depending on body part:

   | Body Part | Min Pixels | Max Pixels | Typical |
   |-----------|-----------|-----------|---------|
   | Carapace | 300 | 500 | 350-450 |
   | Claws | 250 | 450 | 300-400 |
   | Tail | 200 | 400 | 250-350 |
   | Antennae | 100 | 250 | 150-250 |
   | Eyes | 100 | 250 | 150-250 |
   | Legs | 150 | 350 | 200-300 |

7. **Role balance**: Check the approximate role distribution matches the guidelines in Section 4. Avoid templates that are 90% one role.

8. **10-class preview**: The template should look visually coherent across all 10 class palettes. The live preview strip in the editor shows this.

---

## 11. File Naming & Folder Structure

```
packages/asset-gen/src/templates/data/
├── carapace/
│   ├── bulwark.json     ← classAffinity: 0
│   ├── mantis.json      ← classAffinity: 1
│   ├── leviathan.json   ← classAffinity: 2
│   ├── tempest.json     ← classAffinity: 3
│   ├── specter.json     ← classAffinity: 4
│   ├── sentinel.json    ← classAffinity: 5
│   ├── reaver.json      ← classAffinity: 6
│   ├── abyss.json       ← classAffinity: 7
│   ├── kraken.json      ← classAffinity: 8
│   └── ember.json       ← classAffinity: 9
├── claws/
│   └── (same 10 files)
├── tail/
│   └── (same 10 files)
├── antennae/
│   └── (same 10 files)
├── eyes/
│   └── (same 10 files)
└── legs/
    └── (same 10 files)
```

**File naming**: `<class_name>.json` (lowercase, matching the class names exactly)
**Folder naming**: `<body_part_name>/` (lowercase, matching the body part names exactly)

The loader resolves templates by path: `data/<bodyPartName>/<className>.json`

---

## 12. Reference Examples

### Example 1: `carapace/bulwark.json` (Shell — Tank)

**Key features to study:**
- 364 pixels spanning y=11 to y=28 (18 rows)
- Complete outline border (role 0) around entire dome shape
- Top rows use highlight (3) for light-catching edge
- Middle rows use primary base (2) as main fill
- Secondary base (4) and secondary highlight (5) form horizontal stripe pattern through middle
- 4 accent pixels (6) placed symmetrically for decorative detail
- Bottom rows transition to shadow (1)
- Anchor at exact center: {24, 20}
- 3 mutation zones: top band, middle body, lower edge

### Example 2: `claws/mantis.json` (Pincers — Assassin)

**Key features to study:**
- ~340 pixels forming two blade-like shapes
- Main claw body (upper-left area, x=2-13) with a secondary arm/pincer (lower-right, x=14-24)
- Small "finger" protrusion at bottom (x=10-13, y=33-37)
- Secondary (4,5) colors used for inner claw detail and joint accent pattern
- Accent (6) used sparingly for glow spots (2-3 pixels)
- Anchor at {12, 28} — front attachment

### Example 3: `tail/ember.json` (Tail — Glass Cannon)

**Key features to study:**
- ~350 pixels forming a 5-flame fan pattern
- 5 individual flame tips at y=18-22 (upper portion)
- Flames merge into a single stalk at y=26-38
- Secondary (4,5) colors create a "spine" pattern down the center
- Accent (6) marks the hottest points (3 pixels)
- Narrow stalk tapers from ~10px wide to ~2px wide at base
- Anchor at {34, 36} — back attachment
- 3 mutation zones: flame tips, mid-body spine, stalk

---

## 13. Visual Style Guide

### Overall Aesthetic

- **Pixel art, not pixel perfect**: Lobsters should feel organic and characterful, not geometric
- **Chunky proportions**: At 48×48, every pixel matters. Favor readability over realism
- **Class identity over anatomical accuracy**: A Mantis claw should scream "assassin" more than "biologically accurate pincer"
- **Silhouette-first design**: The outline (role 0) is the most important layer. A good template is recognizable from its silhouette alone

### Do's

- Start every template by drawing the outline first
- Use 1px outlines consistently (don't go 2px thick)
- Place highlights on top-left edges, shadows on bottom-right
- Use accent sparingly — it's the "pop" color, 2-8 pixels max
- Make each class version visually distinct from the same body part in other classes
- Test cross-class compositing regularly (e.g., Bulwark shell + Ember tail)
- Keep mutation zones away from the anchor attachment area

### Don'ts

- Don't leave gaps in the outline — the silhouette must be airtight
- Don't use only 1-2 roles — use at least 5 of 7 for visual richness
- Don't make templates too small (< 100 pixels) — they'll look empty at display size
- Don't make templates too large (> 500 pixels) — the canvas only has 2304 total pixels
- Don't place pixels at the extreme canvas edges (x=0, x=47, y=0, y=47) — leave 1-2px margin for mutation zones to expand into
- Don't forget to set the correct `classAffinity` value matching the class index (0-9)
- Don't copy exact shapes between classes — the whole point is class identity through distinct shapes

### Priority Order for Creation

**Recommended order** (prioritize completing full body part sets):

1. **Carapace** (9 remaining) — the backbone of every lobster
2. **Claws** (9 remaining) — the most visually prominent feature
3. **Eyes** (10) — critical for personality
4. **Tail** (9 remaining) — key shape differentiator
5. **Legs** (10) — background element, can be simpler
6. **Antennae** (10) — thinnest/simplest part

This order lets you render progressively more complete lobsters as you go — a carapace + claws already looks like a recognizable lobster.

---

## Summary

| Deliverable | Count | Format | Location |
|-------------|-------|--------|----------|
| Template JSON files | 57 remaining (60 total) | JSON | `packages/asset-gen/src/templates/data/<part>/<class>.json` |
| Canvas size | — | 48×48 pixels | — |
| Palette roles | 7 per template | Role indices 0-6 | — |
| Mutation zones | 2-4 per template | Rectangles with allowed mutations | Inside each JSON |
| Validation | Per template | `bun packages/asset-gen/src/cli.ts validate-templates` | — |
| QA sheets | Per template | `bun packages/asset-gen/src/cli.ts sheet <part> <class>` | — |
