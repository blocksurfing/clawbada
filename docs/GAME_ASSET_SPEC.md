# Clawbada: Comprehensive Game Asset Specification

**Version**: 1.0
**Date**: February 2026
**Client**: Lobster Game Studios
**Project**: Clawbada — Agent-First Idle Battler on Base Blockchain

---

## Table of Contents

1. [Project Overview & Art Direction](#1-project-overview--art-direction)
2. [The 10 Lobster Classes](#2-the-10-lobster-classes)
3. [Modular Body Part System (960 PNGs)](#3-modular-body-part-system-960-pngs)
4. [Evolution Tier Visual Treatments](#4-evolution-tier-visual-treatments-4-tiers)
5. [Legend Skins](#5-legend-skins-10-legend-treatments)
6. [Breed Type Color Palettes](#6-breed-type-color-palettes-64-palettes)
7. [Sprite Sheet Animations](#7-sprite-sheet-animations)
8. [Special Move VFX](#8-special-move-vfx-20-effects)
9. [Battle Status Effect Icons & Overlays](#9-battle-status-effect-icons--overlays)
10. [Damage & State Visual Indicators](#10-damage--state-visual-indicators)
11. [UI Components & Screens](#11-ui-components--screens)
12. [Class Advantage Tournament Graph](#12-class-advantage-tournament-graph)
13. [Marketing & Brand Assets](#13-marketing--brand-assets)
14. [Technical Art Guide](#14-technical-art-guide)
15. [Asset Inventory Summary](#15-asset-inventory-summary)

---

## 1. Project Overview & Art Direction

### Game Summary

Clawbada is a blockchain-based idle battler built on **Base** (Ethereum L2). Players collect, breed, evolve, and battle **lobster NFTs** (ERC-1155) using an ERC-20 token called **$CLAW**. The primary players are AI agents (via OpenClaw/Bankr.bot), with humans as a secondary audience via a web UI.

Each lobster is assembled from **6 modular body parts** determined by on-chain DNA. Parts can come from any of 10 class affinities — breeding mixes genes, so a single lobster may display parts from multiple class visual themes. This compositing system is the core visual pipeline.

### Art Style Brief

- **Style**: Stylized 2D with **bold outlines** (2-4px at 512px canvas)
- **Tone**: Vibrant, playful, slightly menacing — underwater creatures with personality
- **Proportions**: Slightly exaggerated/chibi — large claws, expressive eyes, compact bodies
- **Colors**: Rich, saturated palettes per class; strong contrast against dark underwater backgrounds
- **Rendering**: Flat-fill with subtle gradients for depth; no photorealistic shading
- **Outlines**: Consistent black or dark-tinted outlines on all body parts
- **Readability**: Each class must be identifiable by **silhouette alone** at 64px — shapes matter more than colors

### Reference Games

| Reference | What to Take |
|-----------|-------------|
| **Axie Infinity** | Modular body part compositing, distinct class silhouettes, clean part layering |
| **Crabada** | Crustacean anatomy, underwater color palettes, part-based DNA visuals |
| **Stardew Valley** | Character readability at small sizes, warm personality through simple shapes |

### Target Resolutions

All body parts are authored on a **512x512 canvas**. The compositing engine downscales for each context:

| Context | Resolution | Usage |
|---------|-----------|-------|
| Detail view | 512x512 | Lobster inspection, breeding preview, marketplace detail |
| Card view | 256x256 | Team builder, inventory grid, marketplace listings |
| Battle UI | 128x128 | In-battle lobster display (6 lobsters on screen) |
| Icon | 64x64 | Thumbnails, turn order bar, minimap |

### File Format

- **PNG-24** with full alpha transparency
- sRGB color space
- No embedded ICC profiles (strip on export)
- Consistent anti-aliasing (2px feathered edges at 512px)

### Color-Blind Accessibility

Classes must be distinguishable by **shape and silhouette**, not just color. Requirements:

- Each class has a unique silhouette profile (see Section 2)
- Class icons use distinct shapes (not just colored circles)
- Battle UI uses shape-coded indicators alongside color (e.g., advantage = upward triangle + green, not just green)
- Status effects use unique icon shapes, not just color overlays
- Test all palettes against deuteranopia, protanopia, and tritanopia simulations

---

## 2. The 10 Lobster Classes

Each class has a distinct identity expressed through color palette, silhouette, and personality. Class IDs are fixed in the smart contracts (0-9) and cannot change.

### Class 0: Bulwark

| Property | Value |
|----------|-------|
| **Role** | Tank |
| **Identity** | The immovable wall. Survives everything, threatens nothing. Ancient and patient. |
| **Primary Palette** | Steel blue (#4682B4), slate gray (#708090), titanium white accents |
| **Secondary Palette** | Ice blue highlights, gunmetal shadows |
| **Silhouette** | Broad, heavy, low-slung stance. Widest body of all classes. Oversized carapace that hunches over the body like a fortress. Short, thick legs planted wide. Small claws relative to body. |
| **Special Move** | **Fortify** — Protective dome effect; team-wide defense buff |
| **Special VFX Theme** | Blue energy barrier, shield shimmer, crystalline protection |
| **Mood Keywords** | Fortress, glacier, immovable, ancient, stoic, iron |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 700 | 70 | 120 | 80 | 90 |

---

### Class 1: Mantis

| Property | Value |
|----------|-------|
| **Role** | Assassin |
| **Identity** | The precision killer. Strikes first, crits often, shatters like glass. Cold and calculated. |
| **Primary Palette** | Jade green (#00A86B), black (#1A1A1A), venomous yellow accents |
| **Secondary Palette** | Emerald highlights, obsidian shadows |
| **Silhouette** | Sleek, elongated body. Tallest and thinnest class. Angular limbs like blade edges. Oversized, razor-sharp claws held forward in a mantis prayer stance. Long, swept-back antennae. |
| **Special Move** | **Ambush** — Armor-piercing strike; ignores 50% of target's Armor |
| **Special VFX Theme** | Triple slash marks, speed lines, shadow afterimages |
| **Mood Keywords** | Blade, shadow, precision, venom, swift, lethal |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 375 | 100 | 70 | 130 | 125 |

---

### Class 2: Leviathan

| Property | Value |
|----------|-------|
| **Role** | Bruiser |
| **Identity** | Raw power incarnate. Hits hardest, acts last. An underwater apex predator. |
| **Primary Palette** | Deep navy (#000080), bronze (#CD7F32), dark iron accents |
| **Secondary Palette** | Ocean midnight highlights, corroded copper shadows |
| **Silhouette** | Massive, imposing frame. Second widest after Bulwark but taller. Thick, powerful limbs. Oversized claws with heavy crushing surfaces. Heavy jaw/mandible area. Overall impression of weight and force. |
| **Special Move** | **Crush** — Devastating single-target slam; highest base power (180) |
| **Special VFX Theme** | Ground-pound shockwave, debris particles, impact crater |
| **Mood Keywords** | Titan, earthquake, colossus, primal, devastating, deep |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 600 | 130 | 100 | 70 | 80 |

---

### Class 3: Tempest

| Property | Value |
|----------|-------|
| **Role** | Nuker |
| **Identity** | Living storm. Unleashes devastating area attacks. Crackling with barely-contained energy. |
| **Primary Palette** | Electric blue (#7DF9FF), white (#F0F8FF), arc-flash cyan accents |
| **Secondary Palette** | Lightning white highlights, thundercloud gray shadows |
| **Silhouette** | Angular, jagged body lines like lightning bolts. Medium build with sharp protrusions. Tail and antennae have forked, crackling shapes. Spiny carapace with ridge patterns suggesting storm clouds. Claws have branching, electrical shapes. |
| **Special Move** | **Maelstrom** — AoE tornado hitting all 3 enemies (90 base power each) |
| **Special VFX Theme** | Tornado vortex, wind particles, lightning arcs |
| **Mood Keywords** | Lightning, hurricane, voltage, chaos, storm, discharge |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 450 | 110 | 80 | 105 | 115 |

---

### Class 4: Specter

| Property | Value |
|----------|-------|
| **Role** | Debuffer |
| **Identity** | Haunting presence. Weakens enemies before they can act. Eerie and otherworldly. |
| **Primary Palette** | Ghost purple (#7B68EE), ethereal teal (#008B8B), spectral white accents |
| **Secondary Palette** | Phantom lavender highlights, void indigo shadows |
| **Silhouette** | Wispy, translucent-looking body. Edges fade and feather rather than having hard lines. Elongated eye stalks with large, glowing eyes. Trailing tail that dissolves into mist-like wisps. Thin, ghostly legs that barely seem to touch ground. |
| **Special Move** | **Haunt** — Debuff attack; damage + target Atk/Armor -20% for 2 rounds |
| **Special VFX Theme** | Ghost form projection, purple curse marks, ethereal wisps |
| **Mood Keywords** | Phantom, curse, mist, haunting, whisper, spectral |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 425 | 85 | 85 | 125 | 120 |

---

### Class 5: Sentinel

| Property | Value |
|----------|-------|
| **Role** | Support |
| **Identity** | Noble guardian. Keeps the team alive. Dignified and protective. |
| **Primary Palette** | Gold (#FFD700), warm white (#FFFAF0), pearl accents |
| **Secondary Palette** | Sunlight amber highlights, warm bronze shadows |
| **Silhouette** | Noble, upright posture — tallest-standing class. Symmetrical, balanced proportions. Protective shield-like carapace plates. Medium claws held in a guarding position. Regal antennae like a crown. Overall impression of a protector or paladin. |
| **Special Move** | **Rally** — Heal + cleanse an ally; restores 30% max HP |
| **Special VFX Theme** | Golden light burst, green healing numbers, cleanse sparkle |
| **Mood Keywords** | Guardian, radiant, noble, aegis, blessing, golden |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 650 | 70 | 110 | 90 | 100 |

---

### Class 6: Reaver

| Property | Value |
|----------|-------|
| **Role** | DPS |
| **Identity** | Relentless predator. Bleed stacks are brutal. Aggressive and hungry. |
| **Primary Palette** | Crimson (#DC143C), dark red (#8B0000), bone-white accents |
| **Secondary Palette** | Blood orange highlights, maroon shadows |
| **Silhouette** | Spiky, predatory outline. Forward-leaning aggressive stance. Serrated claw edges with jagged teeth-like ridges. Spined carapace with protruding barbs. Tail with sharp, hook-like tip. Everything about this lobster says "I will cut you." |
| **Special Move** | **Rend** — Bleed attack; 70 hit + 40 bleed/round for 3 rounds (190 total) |
| **Special VFX Theme** | Multi-slash marks, red blood-drip particles, serrated impact |
| **Mood Keywords** | Feral, blade, bloodthirst, hunter, savage, relentless |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 475 | 120 | 80 | 110 | 95 |

---

### Class 7: Abyss

| Property | Value |
|----------|-------|
| **Role** | Lifesteal |
| **Identity** | Deep-sea horror. Feeds on enemies to sustain itself. Dark and parasitic. |
| **Primary Palette** | Void black (#0D0D0D), toxic green (#39FF14), deep-sea bioluminescent accents |
| **Secondary Palette** | Sickly chartreuse highlights, abyssal black shadows |
| **Silhouette** | Shadowy, amorphous body shape. Smooth, rounded carapace like a deep-sea creature. Tendril-like antennae that seem to reach and grasp. Claws with sucker-like internal details. Bioluminescent spots/patches that punctuate the dark body. Overall: alien, parasitic, deep-ocean. |
| **Special Move** | **Devour** — Drain attack; 120 damage dealt also heals self |
| **Special VFX Theme** | Dark tendrils from caster to target, green life-drain stream |
| **Mood Keywords** | Void, parasite, deep-sea, hunger, darkness, consume |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 525 | 110 | 90 | 95 | 100 |

---

### Class 8: Kraken

| Property | Value |
|----------|-------|
| **Role** | Controller |
| **Identity** | Master of the battlefield. Bind decides rounds. Tentacled and inescapable. |
| **Primary Palette** | Dark teal (#008080), bioluminescent blue (#00BFFF), ink-black accents |
| **Secondary Palette** | Cyan bioluminescent highlights, deep ocean shadows |
| **Silhouette** | Tentacled, writhing outline — the most "alien" class. Extra appendage-like protrusions on claws and legs suggesting tentacles. Elongated, squid-like body proportions. Large, intelligent eyes. Fluid, undulating shapes rather than hard angles. Most unique silhouette of all 10 classes. |
| **Special Move** | **Bind** — CC attack; 60 damage + stun target for 1 round |
| **Special VFX Theme** | Tentacle wrap around target, blue stun flash, constriction |
| **Mood Keywords** | Tentacle, deep, control, grip, inescapable, ancient |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 550 | 90 | 100 | 105 | 95 |

---

### Class 9: Ember

| Property | Value |
|----------|-------|
| **Role** | Glass Cannon |
| **Identity** | Barely-contained explosion. Highest burst in the game. Fragile and volatile. |
| **Primary Palette** | Orange (#FF6600), molten red (#FF2400), magma yellow accents |
| **Secondary Palette** | White-hot highlights, char-black shadows |
| **Silhouette** | Smallest, most fragile-looking body. Cracks and fissures in the carapace revealing internal glow. Thin limbs that look like they might snap. Large, dramatic claws disproportionate to the body (all offense, no defense). Tail flickers like a flame tip. Overall: volatile, unstable, dangerous. |
| **Special Move** | **Inferno** — Maximum burst (200 base); caster takes 25% of damage dealt as self-damage |
| **Special VFX Theme** | Massive explosion, fire burst outward, self-damage red flash on caster |
| **Mood Keywords** | Eruption, volatile, magma, fragile, inferno, unstable |

**Base Stats:**

| HP | Attack | Armor | Speed | Critical |
|----|--------|-------|-------|----------|
| 350 | 140 | 60 | 100 | 130 |

---

### Class Palette Quick Reference

| ID | Class | Primary 1 | Primary 2 | Accent |
|----|-------|-----------|-----------|--------|
| 0 | Bulwark | Steel blue #4682B4 | Slate gray #708090 | Titanium white |
| 1 | Mantis | Jade green #00A86B | Black #1A1A1A | Venomous yellow |
| 2 | Leviathan | Deep navy #000080 | Bronze #CD7F32 | Dark iron |
| 3 | Tempest | Electric blue #7DF9FF | White #F0F8FF | Arc-flash cyan |
| 4 | Specter | Ghost purple #7B68EE | Ethereal teal #008B8B | Spectral white |
| 5 | Sentinel | Gold #FFD700 | Warm white #FFFAF0 | Pearl |
| 6 | Reaver | Crimson #DC143C | Dark red #8B0000 | Bone white |
| 7 | Abyss | Void black #0D0D0D | Toxic green #39FF14 | Bioluminescent |
| 8 | Kraken | Dark teal #008080 | Bio-blue #00BFFF | Ink black |
| 9 | Ember | Orange #FF6600 | Molten red #FF2400 | Magma yellow |

All 10 palettes are designed for maximum mutual distinction, including under color-blind simulation. Each class also has a unique silhouette shape for identification without color.

---

## 3. Modular Body Part System (960 PNGs)

This is the core visual system. Each lobster is composited from 6 layered body parts drawn from a shared pool. Parts are determined by on-chain DNA — specifically, the **dominant allele** of each body part slot determines which visual is displayed.

### Body Part Definitions

Each allele encodes 8 bits: **class affinity** (4 bits, 0-9) determines which class's visual style the part uses, and **variant** (4 bits, 0-15) selects a specific design within that affinity.

| Layer Order | Slot | Part | Primary Stat | Visual Description |
|-------------|------|------|-------------|-------------------|
| 1 (back) | 0 | **Carapace** | HP | Main shell covering the body. Defines the lobster's overall color, texture, and pattern. Largest visual element — sets the "first impression" of the lobster. Includes dorsal ridges, segment lines, and surface texture. |
| 2 | 5 | **Legs** | HP | 4-6 walking appendages (varies by variant). Joint style, thickness, and posture vary. Must not obscure the carapace but should be visible below/behind the body. |
| 3 | 2 | **Tail** | Speed | Tail fan extending behind/below the body. Shape ranges from broad and flat to thin and whip-like. Includes tail segments and fin structure. Key for silhouette variety. |
| 4 | 4 | **Eyes** | Armor | Eye stalks extending upward from the head area. Vary in stalk length, eye size, pupil shape, and color. Primary source of "expression" and personality. |
| 5 | 3 | **Antennae** | Critical | Sensory appendages extending from the head, above/in front of eyes. Range from short stubs to long, branching structures. Can include glow effects on tips for higher variants. |
| 6 (front) | 1 | **Claws** | Attack | Front appendages, the most visually prominent part after the carapace. Size, shape, and ornamentation vary dramatically. Drawn in front of all other parts. |

### Variant Count

- **10 class affinities** (one per class: Bulwark through Ember)
- **16 variants per affinity** (0-15)
- **6 body parts**
- **Total: 6 x 10 x 16 = 960 PNG files**

### Variant Progression

Within each class affinity, the 16 variants progress from simple to elaborate:

| Variant Range | Complexity | Design Direction |
|--------------|-----------|-----------------|
| **0-3** | Simple/clean | Basic shapes, minimal detail, clean lines. A "common" look. Few embellishments. |
| **4-7** | Moderate | Added ornamentation, some texture detail, small protrusions or patterns. Recognizably a step up from 0-3. |
| **8-11** | Detailed | Distinctive features, complex shapes, visible craftsmanship. Noticeably more elaborate. Multiple visual elements. |
| **12-15** | Elaborate/ornate | Maximum visual impact within the affinity. Intricate detail, unique shapes, the most eye-catching version. "Legendary-feeling" even before legend treatment is applied. |

This progression gives visual rarity cues — players can glance at a lobster and gauge variant quality by visual complexity, even without checking the numbers.

### Cross-Affinity Compositing (Critical Constraint)

**Every body part variant must layer cleanly with every other body part variant, regardless of class affinity.**

A Bulwark-class lobster might have:
- Carapace: Bulwark affinity, variant 12 (elaborate steel-blue shell)
- Claws: Ember affinity, variant 6 (moderate fiery claws)
- Tail: Specter affinity, variant 3 (simple ghostly tail)
- Eyes: Mantis affinity, variant 14 (elaborate jade eyes)
- Antennae: Sentinel affinity, variant 0 (simple golden antennae)
- Legs: Kraken affinity, variant 9 (detailed tentacle-like legs)

This means:
- **No gaps**: All parts must fill their designated layer zone without leaving visible gaps when combined with any other part
- **No overlaps**: Parts must not bleed into adjacent layer zones
- **Consistent anchor points**: Every part of the same type aligns to the same registration point
- **Mixed palettes work**: Parts from different class affinities will create unusual color combinations — this is expected and should not look broken
- **Outline consistency**: All parts use the same outline weight and style

### Per-Affinity Visual Guide

For each of the 10 affinities, the body part carries that class's visual DNA:

| Affinity | Carapace | Claws | Tail | Eyes | Antennae | Legs |
|----------|----------|-------|------|------|----------|------|
| **0: Bulwark** | Heavy plated shell, riveted segments | Blocky, shield-like | Broad, flat, armored | Small, deep-set, steady | Short, thick, utilitarian | Thick, planted, wide-set |
| **1: Mantis** | Smooth, aerodynamic, blade-ridged | Long, razor-sharp, serrated | Thin, whip-like, pointed | Narrow, predatory slits | Long, swept-back, sharp | Thin, angular, spring-loaded |
| **2: Leviathan** | Massive, cracked-stone texture | Enormous, crusher-type | Heavy, powerful, segmented | Large, deep, ancient | Thick, horn-like, curving | Thick, column-like, powerful |
| **3: Tempest** | Jagged ridges, lightning-bolt patterns | Forked, branching, electric | Zigzag shape, crackling edges | Bright, flickering, electric | Forked like lightning rods | Angular, jagged, sparking |
| **4: Specter** | Translucent-looking, ethereal edges | Wispy, fading at edges | Trailing, mist-like | Oversized, glowing orbs | Long, ghostly, floating | Fading, translucent, spectral |
| **5: Sentinel** | Ornate, heraldic, golden trim | Shield-shaped, protective | Flowing, banner-like | Wise, warm, steady gaze | Crown-like, regal | Sturdy, ceremonial, polished |
| **6: Reaver** | Spiked, barbed, battle-scarred | Serrated, hook-tipped | Barbed, spined, hook-ended | Red-tinted, aggressive | Thorny, menacing, sharp | Spiked, predatory, gripping |
| **7: Abyss** | Smooth, dark, bioluminescent spots | Sucker-lined, tentacle-like | Tendril-like, grasping | Large, luminous, alien | Tendril, reaching, organic | Sucker-tipped, creeping |
| **8: Kraken** | Smooth, iridescent, oceanic | Tentacle-shaped, wrapping | Coiled, sinuous, aquatic | Intelligent, large pupil | Tentacle-like, undulating | Multiple, writhing, flexible |
| **9: Ember** | Cracked, lava-veined, glowing seams | Molten-edged, flame-shaped | Flickering flame tip | Intense, white-hot pupil | Smoke-wisps, ember tips | Charred, cracking, smoldering |

### Folder Structure

```
assets/parts/
├── carapace/
│   ├── affinity_0_bulwark/
│   │   ├── variant_00.png
│   │   ├── variant_01.png
│   │   ├── ...
│   │   └── variant_15.png
│   ├── affinity_1_mantis/
│   │   ├── variant_00.png
│   │   └── ... (16 files)
│   ├── affinity_2_leviathan/
│   ├── affinity_3_tempest/
│   ├── affinity_4_specter/
│   ├── affinity_5_sentinel/
│   ├── affinity_6_reaver/
│   ├── affinity_7_abyss/
│   ├── affinity_8_kraken/
│   └── affinity_9_ember/
├── claws/
│   ├── affinity_0_bulwark/
│   └── ... (same structure: 10 folders × 16 PNGs each)
├── tail/
│   └── ... (same structure)
├── antennae/
│   └── ... (same structure)
├── eyes/
│   └── ... (same structure)
└── legs/
    └── ... (same structure)
```

**Total**: 6 part folders x 10 affinity folders x 16 PNGs = **960 PNG files**

---

## 4. Evolution Tier Visual Treatments (4 Tiers)

Evolution changes a lobster's overall visual treatment without replacing individual body parts. These are **post-processing effects** applied to the composited lobster image.

| Tier ID | Tier Name | Visual Treatment | Details |
|---------|-----------|-----------------|---------|
| 0 | **Base** | No effects | Matte, flat colors. Juvenile proportions — slightly smaller relative to canvas. No glow, no particles, no overlay. This is the "raw" lobster. |
| 1 | **Evolved** | Subtle enhancement | Glossy finish on carapace (specular highlight). Slightly increased saturation (+10-15%). Thin glow outline (2px, class primary color at 30% opacity). Adult proportions. |
| 2 | **Elite** | Ornate enhancement | Vivid, saturated colors (+25-30%). Ornate metallic trim on carapace edges (gold/silver/bronze depending on class). Particle aura (slow-drifting motes of class-color light around the body, 8-12 particles). Slight size increase. |
| 3 | **Apex** | Maximum visual impact | Radiant/crystalline color treatment — colors appear to glow from within. Dynamic aura (pulsing, brighter particle field, 16-20 particles). Energy wisps trailing from extremities (claws, antennae, tail). Subtle iridescent sheen across carapace. Maximum visual prestige. |

### Deliverable

4 **overlay/effect definitions** — NOT 4x the body part PNGs. Each definition specifies:

- Color adjustment (saturation, brightness, contrast shifts)
- Outline glow (color, width, opacity, blur radius)
- Particle system (count, size, color, drift speed, spawn area)
- Overlay texture (if any — metallic trim, crystalline sheen)
- Scale modifier (if any — Base is 95% canvas, Apex is 100%)

**File format**: JSON effect definition + overlay PNG spritesheets where applicable.

```
assets/evolution/
├── tier_0_base.json          # No effects (identity transform)
├── tier_1_evolved.json       # Gloss + glow definitions
├── tier_1_evolved_overlay.png
├── tier_2_elite.json         # Ornate + particle definitions
├── tier_2_elite_overlay.png
├── tier_2_elite_particles.png
├── tier_3_apex.json          # Maximum effects
├── tier_3_apex_overlay.png
└── tier_3_apex_particles.png
```

---

## 5. Legend Skins (10 Legend Treatments)

Legends are rare lobsters (~0.3% chance per breed) with unique visual treatments per class. Legend status is stored in the DNA (2-bit field: 0=normal, 1=legend). Legend effects layer **on top of** evolution tier effects.

| Class ID | Class | Legend Name | Visual Treatment |
|----------|-------|-----------|-----------------|
| 0 | Bulwark | **Ancient Guardian** | Crystalline armor overlay — carapace appears to be carved from translucent blue crystal. Arcane rune patterns glow softly along shell segments. Slow-rotating runic symbols float near the body. |
| 1 | Mantis | **Void Stalker** | Cosmic star-field pattern replaces normal coloring — body surface shows deep space with twinkling stars. Shadow particles trail behind movements. Eyes glow with nebula colors. |
| 2 | Leviathan | **Titan** | Crackling energy veins across entire body, like contained lightning under the shell. Thunderstorm aura — dark clouds with miniature lightning arcs around the lobster. Deep rumbling glow. |
| 3 | Tempest | **Storm Sovereign** | Lightning corona — continuous electrical arc crown above the head. Electric arc particles chain between extremities (claws, antennae, tail). Body pulses with white-blue energy. |
| 4 | Specter | **Spirit Form** | Entire body becomes translucent/semi-transparent with a shimmer effect. Ethereal wisps constantly drift upward from the body. Faint afterimage/echo of the lobster follows movements. |
| 5 | Sentinel | **Divine Protector** | Radiant halo of warm light behind the head. Celestial light particles descend slowly around the body. Golden illumination emanates from within, giving the lobster a saintly appearance. |
| 6 | Reaver | **Crimson Terror** | Blood-red stained overlay — as if the lobster is drenched in crimson. Dark, menacing red-black aura pulses outward. Dripping particle effect (red droplets fall from claws and body). |
| 7 | Abyss | **Abyssal Horror** | Void-black glow — body radiates darkness rather than light (inverted glow effect). Bioluminescent eyes intensified to piercing brightness. Tendrils of dark energy reach outward from the body. |
| 8 | Kraken | **Deep One** | Full-body iridescent shimmer — colors shift through the spectrum like an oil slick or deep-sea creature. Bioluminescent patterns pulse rhythmically across the shell. Hypnotic, otherworldly. |
| 9 | Ember | **Infernal Core** | Molten cracks spread across the entire body, revealing a blindingly bright interior. Intense fire particles erupt from cracks. The lobster appears to be a walking volcanic eruption barely held together. |

### Deliverable

10 **legend effect packs**, one per class. Each pack contains:

- Overlay PNG (body-conforming texture/pattern)
- Particle definition (JSON: type, count, color, behavior)
- Color shift definition (how the base palette is modified)
- Glow definition (color, intensity, radius)

**These layer on top of evolution effects.** A legend Apex Ember has: base body parts + Apex tier effects + Infernal Core legend effects.

```
assets/legends/
├── legend_0_bulwark/
│   ├── overlay.png
│   ├── particles.png
│   └── effect.json
├── legend_1_mantis/
├── legend_2_leviathan/
├── legend_3_tempest/
├── legend_4_specter/
├── legend_5_sentinel/
├── legend_6_reaver/
├── legend_7_abyss/
├── legend_8_kraken/
└── legend_9_ember/
```

---

## 6. Breed Type Color Palettes (64 Palettes)

The DNA includes a 6-bit breed type field (0-63) that provides additional visual variety through color palette modifications. These are **color transforms** applied to body parts, not additional body part PNGs.

### Palette Categories

| Range | Category | Description |
|-------|----------|-------------|
| **0-15** | Regional variations | Environmental color shifts suggesting different ocean habitats |
| **16-31** | Pattern variations | Texture and pattern overlays applied to body parts |
| **32-47** | Texture accents | Surface finish modifications |
| **48-63** | Reserved | Future seasonal/event variants (provide neutral/identity palettes for now) |

### Regional Variations (0-15)

| ID | Name | Color Shift |
|----|------|------------|
| 0 | Tropical Reef | Warm shift: +saturation, slight orange/coral tint |
| 1 | Arctic Deep | Cool shift: desaturated blues, icy white highlights |
| 2 | Volcanic Vent | Warm shift: deep reds, smoky dark tones, ember highlights |
| 3 | Kelp Forest | Green shift: olive, moss, forest tones |
| 4 | Coral Garden | Pink/magenta shift: coral pinks, soft purples |
| 5 | Open Ocean | Blue shift: clear blues, silver highlights |
| 6 | Abyssal Plain | Dark shift: very deep colors, minimal highlights, bioluminescent accents |
| 7 | Tidal Pool | Bright shift: high saturation, warm and vivid |
| 8 | Sunlit Shallows | Light shift: pastel, sun-bleached, warm whites |
| 9 | Midnight Zone | Cool dark shift: deep indigo, midnight blue, star-like specks |
| 10 | Mangrove | Earthy shift: browns, tans, muddy greens |
| 11 | Polar Ice | White/blue shift: frosty, crystalline, pale |
| 12 | Hydrothermal | Yellow/orange shift: sulfuric yellows, mineral oranges |
| 13 | Seagrass Meadow | Light green shift: fresh, bright, spring-like |
| 14 | Shipwreck | Rust shift: oxidized metals, aged patina, verdigris accents |
| 15 | Bioluminescent Bay | Glow shift: enhanced luminous accents, neon highlights |

### Pattern Variations (16-31)

| ID | Name | Pattern Type |
|----|------|-------------|
| 16 | Solid | No pattern overlay (clean, uniform color) |
| 17 | Striped | Horizontal stripes across body parts |
| 18 | Spotted | Round spots distributed across surfaces |
| 19 | Mottled | Irregular blotchy patches |
| 20 | Banded | Thick alternating color bands |
| 21 | Speckled | Fine, dense speckling |
| 22 | Marbled | Swirling, marble-like veining |
| 23 | Gradient | Smooth color gradient (dark to light, top to bottom) |
| 24 | Dappled | Soft, overlapping round patches |
| 25 | Reticulated | Net-like/honeycomb pattern |
| 26 | Piebald | Large irregular patches of two contrasting colors |
| 27 | Pinstriped | Thin, fine parallel lines |
| 28 | Rosette | Ring-shaped spots (like a jaguar) |
| 29 | Chevron | V-shaped repeating pattern |
| 30 | Fractal | Branching, self-similar patterns |
| 31 | Camouflage | Military-style irregular blotch pattern |

### Texture Accents (32-47)

| ID | Name | Surface Treatment |
|----|------|------------------|
| 32 | Glossy | High specular, reflective sheen |
| 33 | Matte | Flat, non-reflective finish |
| 34 | Crystalline | Faceted, gem-like surface quality |
| 35 | Rough | Coarse, sandpaper-like texture |
| 36 | Iridescent | Rainbow color-shift sheen |
| 37 | Pearlescent | Soft, milky white shimmer |
| 38 | Metallic | Brushed metal appearance |
| 39 | Chitinous | Pronounced segmented insect-shell look |
| 40 | Barnacled | Encrusted with small barnacle-like bumps |
| 41 | Smooth | Polished, seamless surface |
| 42 | Weathered | Worn, aged, slightly faded |
| 43 | Luminous | Slight inner glow, like phosphorescence |
| 44 | Frosted | Matte with white frost-like edges |
| 45 | Scarred | Battle-worn with healed-over marks |
| 46 | Enameled | Lacquer-like, richly colored, deep finish |
| 47 | Prismatic | Light-splitting, rainbow edge effects |

### Reserved (48-63)

Types 48-63 are reserved for future seasonal or event variants. For initial delivery, provide neutral/identity palettes (no color shift, no pattern, no texture accent) for these slots.

### Deliverable

64 color palette definitions in a single JSON file:

```json
{
  "palettes": [
    {
      "id": 0,
      "name": "Tropical Reef",
      "category": "regional",
      "hue_shift": 15,
      "saturation_mult": 1.2,
      "brightness_mult": 1.05,
      "tint": "#FF7F50",
      "tint_strength": 0.15,
      "pattern_overlay": null,
      "texture_overlay": null
    }
  ]
}
```

```
assets/palettes/
├── breed_type_palettes.json    # All 64 palette definitions
├── patterns/                   # Pattern overlay PNGs (for types 16-31)
│   ├── pattern_16_solid.png    # (transparent — no-op)
│   ├── pattern_17_striped.png
│   └── ... pattern_31_camouflage.png
└── textures/                   # Texture overlay PNGs (for types 32-47)
    ├── texture_32_glossy.png
    └── ... texture_47_prismatic.png
```

---

## 7. Sprite Sheet Animations

Each lobster needs animation frames for battle. Since lobsters are composited from modular parts, animations are defined as **frame transforms** (position, rotation, scale offsets per frame) applied to the assembled body parts — the design studio does NOT redraw every variant for every frame.

### Animation Set (Per Class)

Each of the 10 classes gets a unique animation definition reflecting its personality and combat role:

| Animation | Frames | Loop | Description | Key Poses |
|-----------|--------|------|-------------|-----------|
| **Idle** | 4 | Yes | Gentle breathing/bobbing | Slight vertical bob (2-3px), subtle claw fidget, antenna sway |
| **Attack** | 4 | No | Lunge forward, strike, return | Wind-up lean back → forward lunge → claw strike extended → return to idle |
| **Defend** | 3 | No | Shield-up brace | Claws raised to guard → brace impact → hold guard stance |
| **Special** | 4 | No | Class-specific windup + execute | Charge glow build → class-specific pose → release → recovery |
| **Hit** | 3 | No | Recoil on taking damage | Impact flash → knockback lean → stagger recovery |
| **Death** | 4 | No | Collapse and fade | Stagger → crumple → fall to side → fade to 50% opacity |

### Per-Class Animation Personality

| Class | Idle Quirk | Attack Style | Special Pose |
|-------|-----------|-------------|-------------|
| **Bulwark** | Slow, heavy breathing. Barely moves. | Short, powerful shove. Minimal wind-up. | Plants wide, shell glows with blue energy. |
| **Mantis** | Quick, twitchy. Claws flex. | Lightning-fast lunge, almost a teleport. | Vanishes briefly (opacity flash), reappears striking. |
| **Leviathan** | Deep, slow sway. Ground trembles (slight screen shake). | Full-body wind-up, massive overhead slam. | Rears up to full height, brings both claws down. |
| **Tempest** | Sparking, jittering. Electric fidget. | Rapid strikes with arc trails. | Spins, creating a vortex shape. |
| **Specter** | Phasing in and out (opacity flicker). | Ghostly dash through target. | Splits into ghost form that flies to target. |
| **Sentinel** | Noble, upright sway. Dignified. | Measured, controlled strike. | Raises claws skyward, light descends. |
| **Reaver** | Predatory lean, claws clicking. | Savage multi-slash combo. | Rapid slashing frenzy, blurs. |
| **Abyss** | Pulsing glow, tendrils drift. | Lunges with open claws, grasping. | Tendrils extend from body toward target. |
| **Kraken** | Undulating, fluid motion. | Tentacle-like claw wrap. | Extends all appendages outward, binding. |
| **Ember** | Flickering, unstable tremor. | Explosive charge forward. | Body glows white-hot, erupts outward. |

### Frame Transform Format

Each frame is defined as transforms applied to the 6 body part layers:

```json
{
  "class": 0,
  "class_name": "bulwark",
  "animations": {
    "idle": {
      "frame_count": 4,
      "frame_duration_ms": 250,
      "loop": true,
      "frames": [
        {
          "parts": {
            "carapace": { "x": 0, "y": 0, "rotation": 0, "scale": 1.0, "opacity": 1.0 },
            "legs":     { "x": 0, "y": 0, "rotation": 0, "scale": 1.0, "opacity": 1.0 },
            "tail":     { "x": 0, "y": 0, "rotation": 0, "scale": 1.0, "opacity": 1.0 },
            "eyes":     { "x": 0, "y": 0, "rotation": 0, "scale": 1.0, "opacity": 1.0 },
            "antennae": { "x": 0, "y": -1, "rotation": 0, "scale": 1.0, "opacity": 1.0 },
            "claws":    { "x": 0, "y": 0, "rotation": 0, "scale": 1.0, "opacity": 1.0 }
          }
        }
      ]
    },
    "attack": { },
    "defend": { },
    "special": { },
    "hit": { },
    "death": { }
  }
}
```

### Deliverable

10 animation definition JSON files (one per class):

```
assets/animations/
├── anim_0_bulwark.json
├── anim_1_mantis.json
├── anim_2_leviathan.json
├── anim_3_tempest.json
├── anim_4_specter.json
├── anim_5_sentinel.json
├── anim_6_reaver.json
├── anim_7_abyss.json
├── anim_8_kraken.json
└── anim_9_ember.json
```

---

## 8. Special Move VFX (20 Effects)

10 base Special effects + 10 enhanced versions. These are **standalone VFX sprite sheets** that overlay the battle scene — they are NOT part of the lobster body compositing system.

### Base Special VFX (10)

| Class ID | Class | Special | VFX Description | Target |
|----------|-------|---------|----------------|--------|
| 0 | Bulwark | **Fortify** | Blue-white protective dome expands outward from caster, settling over all 3 ally positions. Dome shimmers with hexagonal energy grid pattern. Fades after 1 second. | All allies |
| 1 | Mantis | **Ambush** | Three diagonal slash marks appear on target in rapid succession (white→red gradient). Speed lines radiate from impact. Brief shadow afterimage of the caster appears behind target. | Single enemy |
| 2 | Leviathan | **Crush** | Ground-pound shockwave: circular crack pattern radiates from impact point beneath target. Rock/debris particles fly upward. Screen shakes briefly. Heavy impact flash. | Single enemy |
| 3 | Tempest | **Maelstrom** | Tornado vortex spawns at center of enemy team and expands to hit all 3 positions. Wind-particle streaks spiral inward. Lightning flashes within the vortex. Dissipates upward. | All enemies |
| 4 | Specter | **Haunt** | Semi-transparent ghost form of the caster floats from caster position to target. On arrival, purple-black curse marks (skull/eye symbols) appear on target. Dark mist lingers on target for debuff duration. | Single enemy |
| 5 | Sentinel | **Rally** | Golden light burst radiates from caster's claws toward the heal target. Green "+HP" numbers rise from the healed ally. Sparkle/cleanse particles cascade down the target, removing any dark debuff overlays. | Single ally |
| 6 | Reaver | **Rend** | Rapid multi-slash effect (4 slash marks in an X pattern) on target. Red blood-drip particles begin falling from target and persist for 3 rounds (bleed indicator). Initial hit has a red impact flash. | Single enemy |
| 7 | Abyss | **Devour** | Dark tendrils extend from caster to target (2-3 shadowy tentacle streams). Green life-energy particles flow back along the tendrils from target to caster. Caster briefly pulses green on receiving the heal. | Single enemy |
| 8 | Kraken | **Bind** | Tentacle wraps emerge from below the target, constricting around them. Blue stun flash on impact. Target is visually "held" by the tentacles for 1 round (stun overlay). Tentacles retract when stun ends. | Single enemy |
| 9 | Ember | **Inferno** | Massive fire explosion erupting outward from caster's position toward target. Bright orange-white fireball expands, engulfing the target area. Fire particles scatter. Simultaneously, caster flashes red (self-damage indicator). Lingering flame particles on target. | Single enemy + self |

### Enhanced Special VFX (10)

Enhanced versions are visually upgraded base Specials with an additional visual element. They play when the enhanced proc triggers (VRF roll based on purity score).

| Class ID | Class | Enhanced Name | Additional VFX Element |
|----------|-------|-------------|----------------------|
| 0 | Bulwark | **Fortify+** | Dome now reflects — red damage numbers bounce off the shield surface back toward enemies. Reflected energy sparks. |
| 1 | Mantis | **Ambush+** | Fourth, larger golden slash mark appears after the initial three. Golden critical-hit starburst flash on impact. "CRITICAL" text popup. |
| 2 | Leviathan | **Crush+** | If target is below 50% HP, the impact shockwave is larger and red-tinted. Additional downward smash frame. Bonus damage numbers appear in larger font. |
| 3 | Tempest | **Maelstrom+** | Tornado trail leaves a purple speed-debuff haze on all enemy positions after dissipating. Enemies briefly show purple spiral overlay (speed reduction). |
| 4 | Specter | **Haunt+** | Curse marks are larger and brighter (3-round duration vs 2). Third ghost echo follows the main ghost form. Deeper, more intense dark mist on target. |
| 5 | Sentinel | **Rally+** | After the heal, a translucent blue shield barrier appears on the ally (damage shield visual). Shield has a faint honeycomb pattern. Persists for 1 round. |
| 6 | Reaver | **Rend+** | Bleed particles change from red to dark crimson with a "locked" chain icon briefly flashing (indicating uncleansable bleed). Slash marks glow persistently. |
| 7 | Abyss | **Devour+** | Excess healing shows as a green-gold temporary HP bar extension above the normal HP bar (overheal to temp HP). Extra bright green pulse on caster. |
| 8 | Kraken | **Bind+** | Tentacles glow brighter and appear to crack through the target's defend stance. Blue stun spark effect is intensified with a barrier-break shattering visual if target was defending. |
| 9 | Ember | **Inferno+** | Self-damage flash is reduced (smaller, dimmer red flash on caster). Fire is white-hot instead of orange. Visual cue: the explosion feels more controlled. |

### Deliverable

20 VFX sprite sheets (standalone, not tied to lobster body parts):

```
assets/vfx/specials/
├── base/
│   ├── special_0_fortify.png       # Sprite sheet: 4-6 frames
│   ├── special_1_ambush.png
│   ├── special_2_crush.png
│   ├── special_3_maelstrom.png
│   ├── special_4_haunt.png
│   ├── special_5_rally.png
│   ├── special_6_rend.png
│   ├── special_7_devour.png
│   ├── special_8_bind.png
│   └── special_9_inferno.png
├── enhanced/
│   ├── special_0_fortify_enhanced.png
│   ├── special_1_ambush_enhanced.png
│   ├── special_2_crush_enhanced.png
│   ├── special_3_maelstrom_enhanced.png
│   ├── special_4_haunt_enhanced.png
│   ├── special_5_rally_enhanced.png
│   ├── special_6_rend_enhanced.png
│   ├── special_7_devour_enhanced.png
│   ├── special_8_bind_enhanced.png
│   └── special_9_inferno_enhanced.png
└── specials_meta.json              # Frame counts, durations, target info
```

Each sprite sheet: horizontal strip of frames at 256x256 per frame, PNG with transparency.

---

## 9. Battle Status Effect Icons & Overlays

Persistent visual effects that appear on lobsters during battle to communicate active buffs, debuffs, and states.

### Status Effects

| Effect | Icon (32x32) | Icon Shape | Overlay on Lobster | Duration |
|--------|-------------|------------|-------------------|----------|
| **Bleed (DoT)** | Red droplet with drip trail | Teardrop | Red drip particles falling from the lobster (2-3 particles, looping). Subtle red tint on body edges. | 3 rounds |
| **Stun** | Blue lightning bolt in circle | Lightning bolt | Frozen/static pose. Blue-white sparks crackling around the body. Lobster does not animate idle while stunned. | 1 round |
| **Stat Debuff (Atk/Armor)** | Red downward arrow | Downward chevron | Slight darkening/graying of lobster colors. Faint dark purple aura. Debuffed stat number shows in red. | 2 rounds |
| **Damage Shield** | Blue shield with energy border | Shield | Blue translucent energy bar/bubble above the lobster's HP bar. Faint hexagonal pattern. | 1 round |
| **Speed Debuff** | Purple downward spiral | Spiral | Purple haze/mist around lobster's legs. Movement animations play at 50% speed. | 1 round |
| **Defending** | Silver shield with cross | Kite shield | Silver/white shield icon hovers in front of the lobster. Body in braced pose. | Current round |
| **Charge Counter** | Yellow energy orb | Circle/orb | 1-3 yellow orbs arranged in a row below the lobster. Orbs glow and pulse gently. At 3 orbs, they flash brightly (Special ready). | Persistent |

### Deliverable

For each of the 7 effects:
- 1 icon PNG (32x32, for display in status bar / HP bar area)
- 1 overlay sprite sheet (looping particle/effect, 3-4 frames, applied to lobster position)

```
assets/vfx/status/
├── icons/
│   ├── status_bleed.png
│   ├── status_stun.png
│   ├── status_debuff.png
│   ├── status_shield.png
│   ├── status_speed_down.png
│   ├── status_defending.png
│   └── status_charge.png        # 3 variants: 1 orb, 2 orbs, 3 orbs
├── overlays/
│   ├── overlay_bleed.png         # Sprite sheet: 4 frames, looping
│   ├── overlay_stun.png
│   ├── overlay_debuff.png
│   ├── overlay_shield.png
│   ├── overlay_speed_down.png
│   ├── overlay_defending.png
│   └── overlay_charge.png        # 3 variants
└── status_meta.json              # Frame counts, durations, positions
```

---

## 10. Damage & State Visual Indicators

Visual indicators applied to lobster cards and composited images **outside of battle** (inventory, team view, marketplace, breeding lab).

### Damage Severity Overlays

Applied as a semi-transparent overlay on the composited lobster image to indicate battle damage level.

| Damage Range | Severity | Visual Treatment |
|-------------|----------|-----------------|
| **0** | Pristine | No overlay. Clean, full-color lobster. |
| **1-39** | Minor | Light scratch marks (thin white lines) across carapace area. Slight dulling of colors (~5% desaturation). Barely noticeable at card size. |
| **40-79** | Moderate | Visible cracks/chips in the body outline. Colors noticeably faded (~15% desaturation). Worn/chipped edges on claws and carapace. Players should notice this at a glance. |
| **80-100** | Severe (Battle-Locked) | Heavy cracks across body. Strong red warning tint overlay (10-15% red at 30% opacity). "REPAIR NEEDED" badge in bottom-right corner (red background, white text). This is the >=80 threshold that blocks battle entry. |

### State Badges

Small icon badges (24x24) positioned on lobster cards to indicate current state. Placed in corners to avoid obscuring the lobster image.

| State | Icon | Position | Description |
|-------|------|----------|-------------|
| **Soulbound** | Gold padlock | Top-right | Indicates the lobster is non-transferable (from faucet). Gold lock with a heart/soul symbol. |
| **Locked (in team)** | Silver chain link | Top-right | Lobster is assigned to a team and cannot be sold. Two interlocking chain links. |
| **In Battle** | Crossed swords | Top-left | Lobster is currently in an active battle. Red-tinted crossed swords. |
| **Mining** | Pickaxe | Top-left | Lobster is on an active mining expedition. Yellow/brown pickaxe with sparkle. |
| **On Cooldown** | Hourglass | Bottom-left | Lobster is on breeding cooldown (48h). Blue hourglass with sand/timer. |

Multiple badges can appear simultaneously (e.g., "Soulbound" + "Mining").

### Deliverable

```
assets/indicators/
├── damage/
│   ├── damage_minor.png          # Scratch overlay (transparent PNG)
│   ├── damage_moderate.png       # Crack overlay
│   ├── damage_severe.png         # Heavy damage overlay + red tint
│   └── badge_repair_needed.png   # "REPAIR NEEDED" corner badge
├── state/
│   ├── badge_soulbound.png       # 24x24 gold padlock
│   ├── badge_locked.png          # 24x24 silver chain
│   ├── badge_in_battle.png       # 24x24 crossed swords
│   ├── badge_mining.png          # 24x24 pickaxe
│   └── badge_cooldown.png        # 24x24 hourglass
└── indicators_meta.json          # Badge positions, z-order
```

---

## 11. UI Components & Screens

### Global UI Elements

These components appear across multiple screens and must be designed as a consistent system.

#### Navigation Bar
- Horizontal top bar, 8 items: **Dashboard** | **Teams** | **Mining** | **Battle** | **Breeding** | **Evolution** | **Marketplace** | **Repair**
- Each item: icon (24x24) + text label
- Active state: highlighted background, bold text
- Dark underwater theme background (semi-transparent dark blue)
- Mobile: collapses to hamburger menu or bottom tab bar

#### Common Widgets

| Widget | Description |
|--------|-------------|
| **$CLAW Balance** | Token icon + formatted balance. Positioned in top-right nav area. Animated on change (count-up/down). |
| **Wallet Button** | "Connect Wallet" state → connected address (truncated 0x1234...5678). Green dot = connected, red = disconnected. |
| **Toast Notification** | Slide-in from top-right. 3 variants: success (green border), error (red border), info (blue border). Auto-dismiss after 5s. |
| **Modal Template** | Centered overlay with dark backdrop. Header + body + action buttons. Variants: confirmation ("Are you sure?"), error, transaction pending (spinner). |
| **Loading Spinner** | Lobster-themed: small lobster silhouette rotating, or claw that opens/closes in a circle. |
| **Lobster Card** | Universal card used everywhere. Shows: composited lobster image (256x256), class icon, evolution tier badge, damage bar (if any), state badges, name/ID. |

#### Stat & Info Displays

| Display | Description |
|---------|-------------|
| **HP Bar** | Horizontal bar with gradient fill: green (full) → yellow (50%) → red (low). Numeric HP overlay. Used in battle and card views. |
| **Damage Bar** | Thin bar below HP bar showing damage level (0-100). Gray (low) → orange (mid) → red (high/locked). |
| **Purity Display** | 6 small circles in a row. Filled circle = matching dominant gene. Empty circle = non-matching. Shown on lobster detail/card. Color matches the lobster's class. |
| **Evolution Tier Badge** | Compact badge with tier abbreviation. **B** (gray), **E** (blue), **EL** (purple), **A** (gold). Placed on lobster cards. |
| **Class Icon Set** | 10 distinct icons (24x24), one per class. Used in nav, cards, battle UI, filters. Each icon must be identifiable by shape alone (accessibility). |
| **Stat Icons** | 5 icons (20x20): HP (heart), Attack (sword), Armor (shield), Speed (wing/feather), Critical (star/starburst). Used alongside stat numbers. |

### Screen Backgrounds (8 Themed Illustrations)

Full-screen background illustrations (1920x1080 base, tileable or scalable for different resolutions). Dark enough to not compete with foreground UI elements. Each captures a distinct underwater/oceanic environment.

| Screen | Background Theme | Key Visual Elements | Color Tone |
|--------|-----------------|--------------------|-----------|
| **Dashboard** | Underwater coral reef, home base | Colorful coral formations, gentle fish, bioluminescent plants, safe and inviting | Warm blue-greens, soft lighting |
| **Battle Arena** | Rocky ocean floor arena | Carved stone arena walls, dramatic spotlight from above, spectator silhouettes, tension | Dark, dramatic, high contrast |
| **Mining** | Underground sea cavern | Glowing crystal deposits in cave walls, mining cart tracks, pickaxe marks, productive | Earth tones, crystal glow accents |
| **Breeding Lab** | Aquatic genetics laboratory | Glass tanks, DNA helix decorations, scientific instruments, bubbles, clinical | Clean blue-white, lab sterile |
| **Evolution Lab** | Mystical transformation chamber | Energy arcs, ancient runes on walls, transformation pod/altar, magical | Purple-blue energy, mystical glow |
| **Marketplace** | Underwater bazaar | Merchant stalls made from shipwreck wood, lanterns, price signs, bustling | Warm amber lighting, merchant tones |
| **Repair Shop** | Workshop/forge | Anvil, tools, spare parts, welding sparks, workbench, industrial | Orange forge glow, iron grays |
| **Faucet/Onboarding** | Open ocean surface | Sunlit water surface from below, light rays penetrating, welcoming, fresh start | Bright, warm, sun-dappled |

### Screen-Specific UI Elements

#### Battle Screen

The most complex UI screen. Split-screen layout with real-time combat display.

**Layout:**
```
┌──────────────────────────────────────────────────┐
│ [Round 3/7]    [Turn Order: 🦞🦞🦞🦞🦞🦞]    [Timer: 12s] │
├────────────────────┬─────────────────────────────┤
│   YOUR TEAM        │        ENEMY TEAM           │
│                    │                              │
│  [Lobster 1]  HP▓▓▓│  HP▓▓▓  [Lobster 4]        │
│  [Lobster 2]  HP▓▓ │  HP▓▓▓▓ [Lobster 5]        │
│  [Lobster 3]  HP▓▓▓│  HP▓▓   [Lobster 6]        │
│                    │                              │
├────────────────────┴─────────────────────────────┤
│  Move Selection:                                  │
│  [⚔️ Attack] [🛡️ Defend] [⚡ Special (3/3)]      │
│  Target: [Select enemy lobster...]                │
└──────────────────────────────────────────────────┘
```

**Elements:**
- 3 lobster battle slots per side (128x128 lobster images) with HP bars below each
- Round counter display (1-7, current round highlighted)
- Turn order bar: 6 small lobster icons (48x48) sorted left-to-right by Speed. Current actor highlighted. Dead lobsters grayed/crossed out.
- Move selection panel: 3 buttons (Attack, Defend, Special). Special button grayed if charge < 3. Charge counter (yellow orbs) shown.
- Target selector: click/tap on enemy lobster to select target. Selected target has highlight ring.
- Damage popup numbers: float upward from damaged lobster. White = normal, yellow = critical, red = self-damage, green = healing. Font size scales with damage amount.
- Timer bar: countdown for commit window (15s) and reveal window (10s). Changes color as time runs low (green → yellow → red).
- Victory banner: "VICTORY!" text with confetti particle effect, gold border
- Defeat banner: "DEFEAT" text with dark overlay, muted colors

#### Mining Screen

**Elements:**
- 4 mine tier cards arranged horizontally (or 2x2 on mobile):
  - **Base Mine**: earthy brown card, crystal icon, "1,250 $CLAW" reward display
  - **Evolved Mine**: blue-green card, enhanced crystal icon, "3,750 $CLAW" reward, lock icon if not qualified
  - **Elite Mine**: purple card, large crystal cluster, "12,500 $CLAW" reward, lock icon if not qualified
  - **Apex Mine**: gold card, radiant crystal, "31,250 $CLAW" reward, lock icon if not qualified
- Expedition timer: circular progress ring (4-hour countdown) with time remaining text
- Reward display: $CLAW icon + amount earned (or "Claim" button when expedition complete)
- Team assignment dropdown/selector per mine slot

#### Breeding Screen

**Elements:**
- Two parent slots: large card positions (256x256) for drag-and-drop or dropdown selection of parent lobsters
- Cost calculator: dynamic display showing per-parent cost + total cost. Updates as parents are selected. Shows breed count for each parent.
- Offspring preview area: silhouette placeholder that fills in after breeding. Shows possible class outcomes (e.g., "50% Bulwark / 50% Mantis" if different-class parents).
- Gene inspector panel: expandable section showing 6 body parts, each with 3 allele slots (D/R1/R2). Color-coded by class affinity. Variant number shown. Used for advanced players hunting recessive genes.

#### Marketplace Screen

**Elements:**
- Filter sidebar (collapsible):
  - Class filter: 10 class icon toggles (multi-select)
  - Evolution tier: 4 tier checkboxes (Base/Evolved/Elite/Apex)
  - Purity range: slider (0-6)
  - Price range: min/max $CLAW inputs
  - Legend toggle: on/off
  - Damage: "Show damaged" toggle
- Sort controls: Price (low/high), Purity, Tier, Recent
- Listing grid: lobster cards (256x256) with price overlay at bottom ($CLAW icon + amount). "Buy" button on hover/tap.
- Price chart: small sparkline graph showing recent sale prices for selected lobster class/tier

### Deliverable

```
assets/ui/
├── nav/
│   ├── nav_background.png
│   ├── nav_item_active.png
│   ├── nav_item_inactive.png
│   └── nav_icons/
│       ├── icon_dashboard.png
│       ├── icon_teams.png
│       ├── icon_mining.png
│       ├── icon_battle.png
│       ├── icon_breeding.png
│       ├── icon_evolution.png
│       ├── icon_marketplace.png
│       └── icon_repair.png
├── common/
│   ├── claw_token_icon.png       # $CLAW token icon (multiple sizes)
│   ├── wallet_button.png
│   ├── toast_success.png
│   ├── toast_error.png
│   ├── toast_info.png
│   ├── modal_background.png
│   ├── loading_spinner.png       # Sprite sheet (8-12 frames)
│   ├── card_template.png
│   ├── hp_bar.png                # 9-slice or stretchable
│   ├── damage_bar.png
│   ├── purity_dot_filled.png
│   ├── purity_dot_empty.png
│   ├── tier_badge_base.png
│   ├── tier_badge_evolved.png
│   ├── tier_badge_elite.png
│   └── tier_badge_apex.png
├── class_icons/
│   ├── class_0_bulwark.png
│   ├── class_1_mantis.png
│   ├── class_2_leviathan.png
│   ├── class_3_tempest.png
│   ├── class_4_specter.png
│   ├── class_5_sentinel.png
│   ├── class_6_reaver.png
│   ├── class_7_abyss.png
│   ├── class_8_kraken.png
│   └── class_9_ember.png
├── stat_icons/
│   ├── stat_hp.png
│   ├── stat_attack.png
│   ├── stat_armor.png
│   ├── stat_speed.png
│   └── stat_critical.png
├── battle/
│   ├── battle_slot.png           # Lobster battle position frame
│   ├── turn_order_bar.png
│   ├── move_btn_attack.png
│   ├── move_btn_defend.png
│   ├── move_btn_special.png
│   ├── move_btn_special_disabled.png
│   ├── target_selector_ring.png
│   ├── timer_bar.png
│   ├── victory_banner.png
│   ├── victory_confetti.png      # Particle sprite sheet
│   ├── defeat_banner.png
│   └── damage_numbers/
│       ├── font_normal.png       # Bitmap font — white
│       ├── font_critical.png     # Bitmap font — yellow
│       ├── font_self_damage.png  # Bitmap font — red
│       └── font_healing.png      # Bitmap font — green
├── mining/
│   ├── mine_card_base.png
│   ├── mine_card_evolved.png
│   ├── mine_card_elite.png
│   ├── mine_card_apex.png
│   ├── expedition_timer_ring.png
│   └── reward_display.png
├── breeding/
│   ├── parent_slot_empty.png
│   ├── parent_slot_filled.png
│   ├── offspring_preview_placeholder.png
│   ├── cost_calculator_panel.png
│   └── gene_inspector_panel.png
├── marketplace/
│   ├── filter_panel.png
│   ├── sort_controls.png
│   ├── listing_price_overlay.png
│   ├── buy_button.png
│   └── price_sparkline_frame.png
└── backgrounds/
    ├── bg_dashboard.png          # 1920x1080
    ├── bg_battle.png
    ├── bg_mining.png
    ├── bg_breeding.png
    ├── bg_evolution.png
    ├── bg_marketplace.png
    ├── bg_repair.png
    └── bg_faucet.png
```

---

## 12. Class Advantage Tournament Graph

A visual representation of the 10-class circulant advantage graph used in battle. This is critical for player strategy and appears in multiple UI contexts.

### Graph Structure

The tournament graph follows a **circulant pattern**: class `i` beats classes `(i+1) % 10` through `(i+4) % 10`. Each class beats exactly 4 others and loses to exactly 4 others. No neutral matchups in the contract's circulant implementation.

**Full advantage table:**

| Attacker → | Bulwark | Mantis | Leviathan | Tempest | Specter | Sentinel | Reaver | Abyss | Kraken | Ember |
|-----------|---------|--------|-----------|---------|---------|----------|--------|-------|--------|-------|
| **Bulwark** | — | W | W | W | W | L | L | L | L | — |
| **Mantis** | L | — | W | W | W | W | L | L | L | — |
| **Leviathan** | L | L | — | W | W | W | W | L | — | L |
| **Tempest** | L | L | L | — | W | W | W | W | — | L |
| **Specter** | L | L | L | L | — | W | W | W | — | W |
| **Sentinel** | W | L | L | L | L | — | W | W | — | W |
| **Reaver** | W | W | L | L | L | L | — | W | — | W |
| **Abyss** | W | W | W | L | L | L | L | — | — | W |
| **Kraken** | W | W | — | — | — | — | — | — | — | W |
| **Ember** | — | — | W | W | L | L | L | L | L | — |

W = 1.25x damage multiplier (advantage), L = 0.80x (disadvantage), — = 1.0x (neutral)

*Note: The circulant graph means `(i+5) % 10` is the neutral matchup. For example, Bulwark (0) is neutral with Sentinel (5)... but the contract implementation uses `getClassAdvantage()` which computes: beats = (i+1) through (i+4), neutral = (i+5), loses = (i+6) through (i+9). The table above should be verified against the contract but follows this formula.*

### Visual Requirements

**Circular graph illustration:**
- 10 class icons arranged in a circle (clock positions)
- Green arrows from each class pointing to the 4 classes it beats
- Red arrows from each class pointing to the 4 classes it loses to
- Neutral matchup shown as gray dashed line (each class has 1 neutral)
- Clean enough to be readable with 90 directed edges
- Consider using a simplified "beats neighbors" visual: each class beats the next 4 clockwise

**Simplified version (for tooltips):**
- Per-class view: selected class in center, 4 green icons (beats), 4 red icons (loses to), 1 gray icon (neutral)
- Used in team builder and battle preview as a matchup reference

### Deliverable

```
assets/ui/
├── tournament_graph/
│   ├── graph_full.png            # Full 10-class circular graph (static)
│   ├── graph_full.svg            # Vector version for interactive rendering
│   └── graph_per_class/          # Per-class matchup views (for tooltips)
│       ├── matchup_0_bulwark.png
│       ├── matchup_1_mantis.png
│       └── ... matchup_9_ember.png
```

---

## 13. Marketing & Brand Assets

Assets for the public-facing websites (clawbada.com, lobstergamestudios.com) and social media accounts (X/Twitter).

### Logos

#### Clawbada Game Logo
- **Primary (horizontal)**: "CLAWBADA" wordmark with a stylized lobster claw integrated into the "C" or "W". Bold, gaming-style font. Underwater color scheme.
- **Stacked**: Logo icon above "CLAWBADA" text
- **Icon only**: The lobster claw mark, usable as a standalone symbol (app icon, favicon)
- Formats: SVG (vector) + PNG at 1x, 2x, 4x resolutions
- Variants: full color on dark, full color on light, monochrome white, monochrome black

#### Lobster Game Studios Logo
- Studio logo: professional, clean, with a subtle lobster silhouette integrated
- Formats: SVG + PNG at standard sizes
- Variants: full color, monochrome

### Hero Illustrations (10)

One high-detail, full-body illustration per class for marketing, loading screens, and documentation. These are **NOT composited from parts** — they are bespoke illustrations showing the class at its most iconic.

| Class | Hero Pose / Composition |
|-------|------------------------|
| Bulwark | Planted wide, shell forward like a wall, looking immovable |
| Mantis | Mid-leap, claws extended, streaking toward viewer |
| Leviathan | Rising from below, massive, shadows falling on viewer |
| Tempest | Surrounded by lightning arcs, crackling with energy |
| Specter | Half-faded, ghostly, one eye glowing through mist |
| Sentinel | Standing tall, golden light behind, protective stance |
| Reaver | Lunging forward, claws dripping, teeth bared |
| Abyss | Emerging from darkness, only glowing spots visible |
| Kraken | Tentacles spreading in all directions, commanding |
| Ember | Body cracking open with fire, explosive energy |

Each illustration: 2048x2048 native resolution, PNG with transparency, also delivered at 1024x1024 and 512x512.

### Social Media Assets

| Asset | Dimensions | Usage |
|-------|-----------|-------|
| **OG Image** (Open Graph) | 1200x630 | Link preview on X, Discord, etc. Game logo + key art + tagline |
| **X Profile Picture** (Clawbada) | 400x400 | Clawbada game account avatar — lobster claw icon |
| **X Banner** (Clawbada) | 1500x500 | Game banner — all 10 class hero illustrations in a lineup, game logo |
| **X Profile Picture** (Studio) | 400x400 | Lobster Game Studios account avatar |
| **X Banner** (Studio) | 1500x500 | Studio banner — professional, studio logo + tagline |

### Favicon Set

Standard web favicon sizes derived from the Clawbada icon-only logo:

| Size | Format | Usage |
|------|--------|-------|
| 16x16 | PNG / ICO | Browser tab (legacy) |
| 32x32 | PNG / ICO | Browser tab (standard) |
| 48x48 | PNG | Windows taskbar |
| 180x180 | PNG | Apple touch icon |
| 192x192 | PNG | Android home screen |
| 512x512 | PNG | PWA splash screen |

### Deliverable

```
assets/brand/
├── clawbada/
│   ├── logo_horizontal.svg
│   ├── logo_horizontal.png       # 2x resolution
│   ├── logo_stacked.svg
│   ├── logo_stacked.png
│   ├── logo_icon.svg
│   ├── logo_icon.png
│   ├── logo_mono_white.svg
│   └── logo_mono_black.svg
├── studio/
│   ├── studio_logo.svg
│   ├── studio_logo.png
│   ├── studio_logo_mono.svg
│   └── studio_logo_mono.png
├── heroes/
│   ├── hero_0_bulwark.png        # 2048x2048
│   ├── hero_0_bulwark_1024.png
│   ├── hero_0_bulwark_512.png
│   ├── hero_1_mantis.png
│   └── ... (10 classes × 3 sizes)
├── social/
│   ├── og_image.png              # 1200x630
│   ├── x_pfp_clawbada.png       # 400x400
│   ├── x_banner_clawbada.png    # 1500x500
│   ├── x_pfp_studio.png         # 400x400
│   └── x_banner_studio.png      # 1500x500
└── favicon/
    ├── favicon-16.png
    ├── favicon-32.png
    ├── favicon-48.png
    ├── apple-touch-icon.png      # 180x180
    ├── android-chrome-192.png
    ├── android-chrome-512.png
    └── favicon.ico               # Multi-size ICO
```

---

## 14. Technical Art Guide

Reference document for the design studio covering all technical constraints for asset production.

### Canvas & Registration

- **Canvas size**: All body parts are drawn on a **512x512 pixel** canvas
- **Origin point**: Center of canvas (256, 256)
- **Body center**: The lobster's body center is at approximately (256, 280) — slightly below center to leave room for antennae/eye stalks above
- All body parts are positioned relative to this shared canvas — when all 6 layers are stacked, they form a complete lobster

### Anchor Points (Per Body Part)

Each body part has a defined bounding zone within the 512x512 canvas. Parts must stay within their zone to prevent overlap with other parts.

| Part | Approximate Zone (x, y, width, height) | Notes |
|------|----------------------------------------|-------|
| **Carapace** (Layer 1) | Full canvas, centered | Largest part. Defines the body silhouette. Other parts layer on top. |
| **Legs** (Layer 2) | Bottom half (x:100-412, y:320-480) | Below and behind the body. Must not extend above the carapace midline. |
| **Tail** (Layer 3) | Right-center to right edge (x:340-512, y:200-420) | Extends behind/below. Points right (lobster faces left by default). |
| **Eyes** (Layer 4) | Upper-left quadrant (x:80-220, y:80-260) | Eye stalks extend upward from head area. |
| **Antennae** (Layer 5) | Upper portion (x:60-300, y:20-220) | Above and in front of eyes. Can extend to top of canvas. |
| **Claws** (Layer 6) | Left-center, front (x:20-260, y:160-400) | Front-most layer. Largest variation in size across variants. |

**Important**: These zones are guidelines. Parts can slightly overlap zone boundaries, but the **visual mass** of each part should stay within its zone. The key constraint is that all 960 body parts must layer together without visible gaps or conflicts.

### Layer Order (Z-Index)

Back to front. Higher layers are drawn on top of lower layers.

```
Z=1  Carapace     (back — the body/shell)
Z=2  Legs         (behind body, below)
Z=3  Tail         (behind body, extending back)
Z=4  Eyes         (on top of carapace, upper area)
Z=5  Antennae     (above eyes, top of head)
Z=6  Claws        (front — most prominent)
```

### Color Constraints

- Each class affinity has a defined primary palette (see Section 2)
- Body parts use the palette of their **affinity** (gene's class), NOT the lobster's overall class
- Mixed-affinity lobsters will have mixed palettes — this is intentional and expected
- Breed type palettes (Section 6) apply as color shifts **on top of** the affinity palette
- Evolution tier effects (Section 4) apply **on top of** everything else
- Legend effects (Section 5) are the final layer

**Compositing order:**
```
1. Draw body parts (affinity palettes)
2. Apply breed type color shift
3. Apply evolution tier effects
4. Apply legend effects (if legend)
5. Apply damage overlay (if damaged)
6. Apply state badges (if applicable)
```

### Naming Convention

**Body parts:**
```
{part}_{affinity}_{variant}.png

Examples:
  carapace_0_00.png    → Carapace, Bulwark affinity, variant 0
  claws_6_12.png       → Claws, Reaver affinity, variant 12
  tail_9_15.png        → Tail, Ember affinity, variant 15
  eyes_4_07.png        → Eyes, Specter affinity, variant 7
```

- `{part}`: carapace, claws, tail, antennae, eyes, legs
- `{affinity}`: 0-9 (maps to class ID)
- `{variant}`: 00-15 (zero-padded, 2 digits)

**Animation frames:**
```
anim_{class}_{action}_{frame}.json

Examples:
  anim_0_bulwark.json   → Bulwark class animation definitions
  anim_9_ember.json     → Ember class animation definitions
```

**VFX:**
```
special_{classId}_{name}.png
special_{classId}_{name}_enhanced.png

Examples:
  special_0_fortify.png
  special_0_fortify_enhanced.png
```

### Transparency

- All body parts: **transparent background** (PNG-24 with alpha channel)
- No background fills, no bounding box fills
- Anti-aliasing: 2px feathered edges at 512px canvas size
- Consistent outline weight: 2-3px at 512px (scales proportionally at lower resolutions)

### Orientation

- **Default facing**: lobster faces **left** (head/claws on left side of canvas, tail on right)
- Battle UI mirrors the image horizontally for the enemy team (enemies face right)
- All body parts are drawn in the left-facing orientation

### Export Checklist

For each body part PNG:
- [ ] 512x512 canvas, sRGB
- [ ] Transparent background
- [ ] Consistent outline weight (2-3px)
- [ ] Within defined zone boundaries
- [ ] Visually reads correctly when composited with any other part from any affinity
- [ ] No embedded ICC profile
- [ ] File size optimized (pngcrush or equivalent)

---

## 15. Asset Inventory Summary

### Complete Asset Count

| Category | Count | Format | Section |
|----------|-------|--------|---------|
| Body part PNGs | **960** | 6 parts x 10 affinities x 16 variants, PNG | 3 |
| Evolution tier effects | **4** | JSON effect definitions + overlay PNGs | 4 |
| Legend effect packs | **10** | Overlay PNG + particle PNG + JSON per class | 5 |
| Breed type palettes | **64** | JSON palette definitions | 6 |
| Breed type pattern overlays | **16** | PNG overlays (for types 16-31) | 6 |
| Breed type texture overlays | **16** | PNG overlays (for types 32-47) | 6 |
| Animation definitions | **10** | JSON frame transforms per class | 7 |
| Special move VFX (base) | **10** | Sprite sheet PNGs | 8 |
| Special move VFX (enhanced) | **10** | Sprite sheet PNGs | 8 |
| Status effect icons | **9** | 7 icons + 3 charge variants, PNG | 9 |
| Status effect overlays | **9** | 7 overlays + 3 charge variants, sprite sheets | 9 |
| Damage overlays | **4** | PNG overlays (4 severity levels) | 10 |
| State badges | **5** | PNG icons (24x24) | 10 |
| Class icons | **10** | PNG (24x24, multiple sizes) | 11 |
| Stat icons | **5** | PNG (20x20) | 11 |
| Nav icons | **8** | PNG (24x24) | 11 |
| UI backgrounds | **8** | PNG (1920x1080) | 11 |
| UI component assets | **~40** | Buttons, cards, panels, bars, modals, etc. | 11 |
| Tournament graph | **1** | SVG + PNG, plus 10 per-class views | 12 |
| Per-class matchup views | **10** | PNG | 12 |
| Logos (Clawbada) | **7** | SVG + PNG (horizontal, stacked, icon, mono variants) | 13 |
| Logos (Studio) | **4** | SVG + PNG | 13 |
| Hero illustrations | **10** | PNG (3 sizes each = 30 files) | 13 |
| Social media assets | **5** | PNG (OG, profile pics, banners) | 13 |
| Favicons | **7** | PNG + ICO | 13 |
| **Total unique deliverables** | **~1,260** | | |

### Priority Tiers

**P0 — Required for launch:**
- 960 body part PNGs (core compositing system)
- 4 evolution tier effects
- 10 class icons
- 5 stat icons
- Lobster card template
- HP bar, damage bar
- Logos (both)
- Favicons

**P1 — Required for full gameplay:**
- 20 Special move VFX
- 10 animation definitions
- 9 status effect icons + overlays
- 4 damage overlays + 5 state badges
- Battle screen UI elements
- Mining/Breeding/Marketplace UI elements
- 8 screen backgrounds

**P2 — Polish & marketing:**
- 10 legend effect packs
- 64 breed type palettes + overlays
- 10 hero illustrations
- Social media assets
- Tournament graph
- Purity display, tier badges

---

*End of Clawbada Game Asset Specification v1.0*
*For questions or clarifications, contact Lobster Game Studios.*
