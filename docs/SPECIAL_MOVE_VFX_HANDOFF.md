# Special Move VFX — Designer Handoff

## Overview

Clawbada's battle system features 10 lobster classes, each with a unique **Special Move**. Specials become available from Round 4 of combat (after accumulating 3 charge from Attack/Defend actions). Each Special needs a custom visual effect animation at **3 evolution tiers** (Evolved, Elite, Apex), plus an **Enhanced** variant that triggers on high-purity lobsters.

**Total deliverables: 10 specials × 3 tiers = 30 base animations + 10 enhanced overlays = 40 animation sets.**

---

## Battle Arena Reference

### Arena Dimensions

- **Canvas**: 960 × 540 pixels
- **Internal coordinate space**: 480 × 270 (everything is 2× scaled)
- **Lobster sprite size**: 64 × 64 native, rendered at 1.8× scale (~115 × 115 pixels on screen)

### Team Layout

Two teams of 3 lobsters face each other. Team A (left) faces right, Team B (right) faces left.

```
┌──────────────────────────────────────────────────────────────┐
│  HUD BAR (HP bars, charge dots, status pips)                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│     [A0]                                        [B0]         │
│         [A1]                                [B1]             │
│     [A2]                                        [B2]         │
│                                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
      Team A (left)                          Team B (right)
```

Approximate team positions (internal coords):

| Tier | Team A (x range) | Team B (x range) | Y range |
|------|------------------|-------------------|---------|
| Evolved | 80–130 | 290–320 | 168–224 |
| Elite | 110–140 | 280–310 | 155–211 |
| Apex | 105–130 | 290–315 | 130–196 |

The gap between teams is roughly **160 internal units** (~320 pixels). Effects that travel from caster to target cross this distance.

### Render Layers (Z-Order)

Effects render on two layers relative to the lobster sprites:

```
5. HUD (HP bars, status)          ← always topmost
4. VFX OVER layer                 ← projectiles, particles, domes, beams
3. Lobster sprites (Y-sorted)     ← characters
2. VFX UNDER layer                ← ground cracks, tentacle bases, floor glows
1. Arena background               ← scene art
```

Each effect specifies which layer(s) it uses.

---

## Timing & Choreography

### Battle Flow for a Special Move

```
1. HIGHLIGHT (350ms)      — Actor glows, player reads who is acting
2. SPECIAL OVERLAY (1s)   — Dark panel shows class name + move name
3. ADVANCE (800-1500ms)   — Actor scuttles forward toward target
4. STRIKE (1750ms)        — Actor plays "special" charge-up animation
                            ⟶ CHARGE-UP VFX plays during this window
5. IMPACT (500ms)         — Damage resolves, hit reactions fire
                            ⟶ MAIN VFX EFFECT starts here
6. RETREAT (800-1500ms)   — Actor returns to home position
7. PAUSE (250ms)          — Brief idle before next action
```

**Key timing**: The main VFX effect triggers at the IMPACT moment and plays for **600–1300ms** depending on the effect. It runs independently — it continues playing even as the actor retreats.

### Battle Speed

The game runs at 1×, 1.5×, or 2× speed. All VFX timings scale proportionally. Animations should still read clearly at 2× speed (half the frame time).

---

## Color System

All effects must use the **class palette** of the casting lobster. Each class has 11 color roles arranged in triplets:

| Role | Name | Use in VFX |
|------|------|-----------|
| 0 | Outline | Effect outlines, dark edges |
| 1 | Primary Shadow | Darker version of main effect color |
| 2 | **Primary Base** | Main effect color |
| 3 | Primary Highlight | Bright/hot version of main color |
| 4 | Secondary Shadow | Support color dark |
| 5 | **Secondary Base** | Support/secondary effect color |
| 6 | Secondary Highlight | Support color bright |
| 7 | Accent Shadow | Pop color dark |
| 8 | **Accent Base** | Pop/contrast color (sparks, flashes) |
| 9 | Accent Highlight | Pop color bright (maximum intensity) |
| 10 | Universal Outline | Black outline (#0e0e0e), same for all classes |

**Draw VFX using the actual class palette colors** — paint in full color using the real colors from the class you're designing for. Our pipeline automatically maps each pixel to the nearest palette role, so the engine can re-palette the effect to any class at runtime. No need to work in grays or think about role indices. See the "Color Workflow" section under Delivery Format for details.

### Class Palette Quick Reference

| # | Class | Primary | Secondary | Accent |
|---|-------|---------|-----------|--------|
| 0 | Bulwark | Steel Blue | Slate Gray | Titanium White |
| 1 | Mantis | Jade Green | Dark Teal | Warm Yellow |
| 2 | Leviathan | Deep Navy | Bronze | Dark Iron |
| 3 | Tempest | Storm Gray | Earth Brown | Electric Cyan |
| 4 | Specter | Ghost Purple | Deep Teal | Spectral Green |
| 5 | Sentinel | Mint Sage | Lime Chartreuse | Teal Aqua |
| 6 | Reaver | Bright Red | Near-Black | Gold Orange |
| 7 | Abyss | Dark Teal | Dark Gray-Blue | Neon Green |
| 8 | Kraken | Dark Teal | Bronze | Coral |
| 9 | Ember | Dark Brown | Dark Purple-Gray | Amber |

---

## Delivery Format Specification

### What to Deliver Per Effect

For each of the 30 base animations (10 specials × 3 tiers), deliver:

#### 1. Sprite Sheet (PNG)

- **Format**: Horizontal strip — all frames arranged left to right in a single row
- **Frame size**: **128 × 128 pixels** per frame (standard), or **192 × 128** for wide effects (beams, tendrils, AoE)
- **Background**: Fully transparent (PNG-32 with alpha channel)
- **Color mode**: **Full color** — paint using the actual class palette colors. Our pipeline auto-maps pixels to palette roles (see Color Workflow below)
- **File naming**: `vfx_{class}_{special}_{tier}.png`
  - Example: `vfx_mantis_ambush_evolved.png`
  - Example: `vfx_tempest_maelstrom_apex.png`

#### 2. Animation Metadata (JSON sidecar)

Each sprite sheet has a companion JSON file with the same base name:

```json
{
  "class": "mantis",
  "special": "ambush",
  "tier": "evolved",
  "frameWidth": 128,
  "frameHeight": 128,
  "frameCount": 8,
  "fps": 12,
  "loop": false,
  "layers": ["over"],
  "anchor": { "x": 64, "y": 64 },
  "placement": "target",
  "notes": "Slash marks appear on target position"
}
```

**Field reference:**

| Field | Type | Description |
|-------|------|-------------|
| `class` | string | Class name (lowercase) |
| `special` | string | Special move name (lowercase) |
| `tier` | string | `"evolved"`, `"elite"`, or `"apex"` |
| `frameWidth` | number | Width of each frame in pixels |
| `frameHeight` | number | Height of each frame in pixels |
| `frameCount` | number | Total number of frames in the strip |
| `fps` | number | Playback speed (frames per second). Typical: 10–15 FPS |
| `loop` | boolean | `true` if the animation should loop (e.g., persistent effects) |
| `layers` | array | Which render layers: `["over"]`, `["under"]`, or `["under","over"]` |
| `anchor` | object | `{x, y}` — the "hot point" of the effect within the frame, in pixels from top-left |
| `placement` | string | Where to position the effect (see Placement below) |
| `notes` | string | Any extra context for the engineer integrating this |

**Placement values:**

| Value | Meaning |
|-------|---------|
| `"target"` | Anchor aligns with the target lobster's center |
| `"caster"` | Anchor aligns with the caster lobster's center |
| `"travel"` | Effect travels from caster to target (engine interpolates position) |
| `"target_ground"` | Anchor aligns with the bottom of the target (for ground effects) |
| `"team_center"` | Anchor aligns with the center of the target team (for AoE) |
| `"ally_center"` | Anchor aligns with the center of the caster's team (for team buffs) |

#### 3. Enhanced Overlay (Optional Separate Sheet)

Enhanced variants are delivered as a separate sprite sheet that composites **on top** of the base effect. This keeps the base effect unchanged and adds visual flair for the enhanced proc.

- **File naming**: `vfx_{class}_{special}_enhanced.png` (one per class, tier-independent)
- Same JSON sidecar format, but with `"tier": "enhanced"`
- Typically fewer frames (just the extra flash, extra slash, glow overlay, etc.)

### Color Workflow — Draw in Full Color

**Draw using the actual class palette colors.** Do not use grays or abstracted role indices. Paint the effect as it should look for its class, using the real colors from the class palette table above. This lets you make natural creative decisions about contrast, energy, and readability.

**How it works:**

1. You draw the effect in full color using the class's actual palette (e.g., Mantis Ambush uses jade green, warm yellow, dark teal)
2. You deliver full-color PNGs — exactly as you painted them
3. Our pipeline runs an automatic **nearest-role color matcher** that maps each pixel to the closest of the 11 palette roles
4. At runtime, the engine re-palettes the effect to any class's colors as needed

This is the same system used for the lobster body part templates — the template editor already has this color-matching pipeline built in.

**Guidelines for best results:**

- **Stick to the class palette colors.** Use the 11 role colors from the class you're designing for. Avoid introducing arbitrary colors that don't exist in the palette — the matcher will snap them to the nearest role, which may not be what you intended.
- **Use tonal contrast deliberately.** Shadow/Base/Highlight within each triplet (Primary, Secondary, Accent) gives you 3 levels of brightness per color group. Use shadows for depth, highlights for energy/glow.
- **Pure black (#0E0E0E) is the universal outline** — use it for hard edges and outlines on effect shapes.
- **Transparent pixels stay transparent** — the alpha channel is preserved as-is, not role-mapped.

**Reference palettes for each class** are listed in the Class Palette Quick Reference table above. Each class has 3 color groups (Primary, Secondary, Accent) with Shadow/Base/Highlight variants, plus an Outline color. That gives you 10 distinct colors per class to work with, plus the universal black outline.

### File Organization

```
assets/vfx/
├── mantis/
│   ├── vfx_mantis_ambush_evolved.png
│   ├── vfx_mantis_ambush_evolved.json
│   ├── vfx_mantis_ambush_elite.png
│   ├── vfx_mantis_ambush_elite.json
│   ├── vfx_mantis_ambush_apex.png
│   ├── vfx_mantis_ambush_apex.json
│   └── vfx_mantis_ambush_enhanced.png
│   └── vfx_mantis_ambush_enhanced.json
├── bulwark/
│   ├── vfx_bulwark_fortify_evolved.png
│   └── ...
├── ... (8 more classes)
```

---

## The 10 Special Moves — Detailed Visual Descriptions

For each special, the descriptions below cover what the designer should illustrate. The **short description** is for quick reference. The **detailed description** explains the full visual narrative. The **tier table** specifies what changes between Evolved, Elite, and Apex. The **enhanced** section describes the additional overlay for high-purity procs.

---

### 1. Bulwark — Fortify

> **Role**: Tank | **Target**: All allies | **Effect**: Team damage -40% for 1 round
> **Placement**: `ally_center` | **Layers**: under + over | **Duration**: ~1200ms

**Short**: Blue-white energy dome expands from the caster to cover all three allies, reducing incoming damage for one round. Shimmers with a hexagonal grid pattern before fading.

**Detailed**: The Bulwark plants its claws and channels defensive energy outward. A dome of translucent steel-blue light expands from the caster's position in a rapid hemisphere, settling over all three ally positions. The dome's surface displays a hexagonal lattice pattern — energy cells that briefly flash brighter as they lock into place. Small white motes drift upward inside the dome like protective sparks. After one round the dome flickers and dissolves from the edges inward. A subtle ground glow ring marks the dome's footprint on the arena floor.

**What the designer draws**: A dome-shaped energy shield, seen from the side (the camera angle is roughly 3/4 top-down). The dome should feel like a translucent force field, not a solid wall. Hex grid lines on the surface. Bright spark particles inside.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | Simple wireframe dome outline. Few particles (4-6). Fades quickly. |
| **Elite** | Semi-transparent filled dome. Visible hex mesh. 12-16 sparkle particles. Ground glow ring appears. |
| **Apex** | Full dome with animated shimmer on hex tiles. 20-24 particles. Persistent ground glow. Brief screen-wide blue tint flash on activation. |

**Enhanced (Fortify+)**: Red reflected-damage sparks visibly bounce off the dome surface toward enemy positions. Add 3-5 frames of small red spark particles traveling outward from the dome edge.

---

### 2. Mantis — Ambush

> **Role**: Assassin | **Target**: Single enemy | **Effect**: Ignores 50% armor, high crit
> **Placement**: `target` | **Layers**: over | **Duration**: ~600ms

**Short**: Three rapid diagonal slash marks appear across the target in quick succession, white fading to jade green. Speed lines radiate from the impact as the Mantis strikes through half the target's armor.

**Detailed**: The Mantis vanishes momentarily — a dark afterimage lingers at its starting position as it crosses to the target in a blur. Three diagonal slash marks rip across the target in rapid succession (roughly 100ms apart): upper-left to lower-right, lower-left to upper-right, then a horizontal bisect. Each slash begins white-hot and fades to jade green. Small pixel debris flies from each impact point. Speed lines (parallel streaks) radiate outward from the target, conveying the lethal velocity of the strike. The entire sequence completes in under half a second.

**What the designer draws**: Three sequential slash mark frames, each appearing on the target. Think anime-style cut effects — clean diagonal lines that flash bright then dim. Debris pixels scatter. The effect is fast and sharp, not floaty.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | 3 thin slash lines (2px). 3-4 debris particles per slash. No afterimage. |
| **Elite** | Thicker slashes (3px). Shadow afterimage silhouette behind target. 8-10 speed lines radiating outward. Green glow residue on slash paths (200ms). |
| **Apex** | Two-tone slashes (white core, green edge). Ghost trail from caster to target (3 translucent rectangles). Starbursts at each slash origin. 16-20 debris particles total. |

**Enhanced (Ambush+)**: A 4th, larger golden slash appears after the initial three. Accompanied by a golden starburst flash radiating from the impact center. This signals the guaranteed critical hit.

---

### 3. Leviathan — Crush

> **Role**: Bruiser | **Target**: Single enemy | **Effect**: Highest single-target burst (180 base)
> **Placement**: `target_ground` | **Layers**: under + over | **Duration**: ~900ms

**Short**: The Leviathan brings overwhelming force down on a single target. A ground-pound shockwave cracks the arena floor beneath them as rock debris flies upward. The highest raw damage of any single-target special.

**Detailed**: The Leviathan rears up and slams down with crushing weight. A circular crack pattern radiates from beneath the target — jagged fracture lines spreading outward across the arena floor (under layer). Rock and debris particles explode upward from the impact point, briefly obscuring the target (over layer). A bronze-colored shockwave ring expands rapidly outward from ground zero. The screen shakes from the force. This is pure, unsubtle destruction.

**What the designer draws**: Two sets of frames — (1) ground crack pattern expanding outward (under layer), and (2) debris particles + shockwave ring (over layer). The cracks should look like stone fracturing. Debris should be small rock/rubble chunks.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | 6-8 simple crack lines radiating from center. 4-6 small debris particles. No shockwave ring. |
| **Elite** | 12-16 branching cracks. One expanding bronze shockwave ring. Dust cloud at impact. 10-14 debris particles. |
| **Apex** | Two staggered shockwave rings. Central "crater" darker area. 20+ debris including large rock chunks (4-5px). Faint impact bar (vertical rectangle from top to target, 50ms). |

**Enhanced (Crush+)**: If target is below 50% HP, the shockwave rings shift to red-tinted. Larger impact burst. Reads as a finishing blow.

---

### 4. Tempest — Maelstrom

> **Role**: Nuker | **Target**: All enemies (AoE) | **Effect**: 90 base damage × all living enemies
> **Placement**: `team_center` (enemy team) | **Layers**: over | **Duration**: ~1100ms

**Short**: A spiraling vortex of wind and lightning spawns at the center of the enemy team, expanding to engulf all living enemy positions. Electric cyan streaks tear through the storm as it deals damage to every foe.

**Detailed**: A spinning cluster of wind-streak particles coalesces at the center of the enemy formation, rapidly expanding into a full vortex that reaches all three positions. Within the maelstrom, zigzag lightning bolts arc between targets — electric cyan against storm gray. Wind particles spiral clockwise in tightening/expanding orbits, catching pixel debris in their wake. The tornado holds for a beat at maximum intensity, then dissipates upward. The vortex only strikes positions where living enemies remain — dead (grayed-out) lobsters are visually bypassed.

**What the designer draws**: A tornado/vortex effect that spans roughly the width of a 3-lobster team formation (~100 internal units wide, ~90 high). Spinning wind streaks, lightning arcs. The effect should feel like a weather event, not a spell.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | 8-12 wind streak particles. 2-3 small lightning bolts. ~800ms duration. |
| **Elite** | 16-20 wind particles with short trails. Visible funnel shape (concentric ellipses). 4-6 lightning bolts arcing between positions. White flash at peak. |
| **Apex** | 3-4 rotating bands forming a layered spiral. 24-30 particles. 8-10 lightning bolts. Screen flash at peak. Caught debris (brown/gray squares) in vortex. |

**Enhanced (Maelstrom+)**: After the tornado dissipates, a purple/violet haze lingers on all enemy positions for ~500ms with slow-drifting purple particles. This signals the speed debuff application.

---

### 5. Specter — Haunt

> **Role**: Debuffer | **Target**: Single enemy | **Effect**: -20% Atk/Armor for 2 rounds
> **Placement**: `travel` (caster → target) | **Layers**: over | **Duration**: ~1000ms

**Short**: A translucent ghost-form of the Specter detaches and floats in a sinuous arc from caster to target. On arrival, purple-black curse marks materialize on the target as dark mist settles around them, weakening their Attack and Armor.

**Detailed**: The Specter's form shimmers and splits. A semi-transparent purple projection of itself peels away from the caster's body, gliding along a gentle sine-wave arc toward the target. The ghost trails wisps of spectral purple behind it — afterimages that fade like smoke. On reaching the target, the ghost passes through them and vanishes. In its wake, small curse marks (spectral green X-patterns) appear on the target's body. A dark purple mist settles and clings to the target, slowly orbiting them for the debuff's duration. The target's colors seem slightly muted.

**What the designer draws**: Two parts — (1) a ghost projectile that travels from one side to the other (the engine handles positioning), and (2) curse mark overlay frames that appear on the target. The ghost should be a simplified, translucent silhouette. Curse marks should be small but readable X or rune patterns in spectral green.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | Small ghost rectangle. Simple sine path. 2-3 curse marks. 3-4 mist particles. |
| **Elite** | Larger ghost with 2-3 trailing wisps. More dramatic arc. 4-6 curse marks. 8-10 mist particles. Brief darkening overlay on target area. |
| **Apex** | Two ghost silhouettes (main + echo, staggered). 4-5 trail positions. Animated/pulsing curse marks. 14-18 orbiting mist particles. Purple path streak from caster to target. |

**Enhanced (Haunt+)**: Third ghost echo follows. Curse marks glow brighter with green tinge. Mist is thicker and more intense. Duration extends to 3 rounds (extra frames of lingering mist).

---

### 6. Sentinel — Rally

> **Role**: Support | **Target**: Single ally | **Effect**: Heal 30% max HP + cleanse debuffs
> **Placement**: `travel` (caster → ally target) | **Layers**: over | **Duration**: ~900ms

**Short**: A beam of golden-teal light connects the Sentinel to a chosen ally. Sparkle particles cascade down the target as green healing numbers rise. Any debuffs are washed away in a shimmer of cleansing light.

**Detailed**: The Sentinel extends its claws toward the wounded ally, and a beam of warm teal light bridges the gap between them. Energy flows visibly along the beam — small bright particles traveling from healer to target. On arrival, the particles burst into a shower of green-gold sparkles that cascade downward over the ally like cleansing rain. If the ally was afflicted by bleed, haunt, or speed debuffs, the dark curse overlays dissolve in the sparkle shower. The Sentinel's own position glows softly during channeling, marking it clearly as the source of healing.

**What the designer draws**: (1) A beam/ray connecting two positions (engine stretches/rotates), and (2) sparkle cascade frames at the target. The beam should feel warm and organic, not laser-like. Sparkles should cascade downward like rain or falling petals.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | Thin beam (2px). 4-6 sparkle particles. Brief green flash on target. |
| **Elite** | Wider beam (4px) with brighter core. 10-14 sparkles. Expanding teal ring from target. Gold motes rising from caster. |
| **Apex** | Layered glow beam with visible energy flow particles traveling along it. 20+ cascading sparkles in a shower pattern. Two expanding light rings. Teal light pillar from caster position. |

**Enhanced (Rally+)**: After heal, a translucent honeycomb-pattern shield (6 small hexagons) appears around the target for 500ms. Tinted teal. This signals the damage shield application.

---

### 7. Reaver — Rend

> **Role**: DPS | **Target**: Single enemy | **Effect**: 70 base hit + 40 bleed/round for 3 rounds
> **Placement**: `target` | **Layers**: over | **Duration**: ~700ms

**Short**: Four rapid slash marks carve an X pattern across the target. Blood-red particles begin dripping from the wounds immediately — the bleed persists for three rounds, dealing 40 damage each round.

**Detailed**: The Reaver lunges with savage precision, raking its claws across the target in a vicious X-pattern — two diagonal slashes crossing at the center. Each slash leaves a bright red mark that glows momentarily before settling into a darker crimson. The impact sends a spray of red pixel-particles outward. Immediately after, small blood-drop particles begin falling from the slash wounds — steady, rhythmic drips. These drip particles have an unusually long lifetime (2000ms) and persist as a visual reminder of the ticking bleed damage.

**What the designer draws**: Slash marks forming an X on the target. The initial hit should feel violent and fast. Then transition to a slower "dripping" state — small red droplets falling with gravity. The drip phase is the signature visual — it should be immediately readable as "bleeding."

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | 4 slash marks (2px, X pattern). 4-6 blood drip particles with gravity. |
| **Elite** | Thicker slashes (3px) with dark red outline. Red impact ring expanding from center. 10-12 blood particles with slight horizontal drift. |
| **Apex** | Two-tone slashes (gold-orange core, dark red edge). 18-24 blood spray particles. Red mist cloud at impact. Scar marks that fade slowly (500ms after initial hit). |

**Enhanced (Rend+)**: Blood particles shift from red to dark crimson. A chain-link icon (small chain shape) flashes briefly above the target, signaling that the bleed cannot be cleansed.

---

### 8. Abyss — Devour

> **Role**: Lifesteal | **Target**: Single enemy | **Effect**: 120 base damage, heals self for damage dealt
> **Placement**: `travel` (caster → target, bidirectional) | **Layers**: over | **Duration**: ~1000ms

**Short**: Dark tendrils extend from the Abyss to wrap around the target. As damage is dealt, green life-energy particles flow back along the tendrils to the caster, healing it for the damage dealt.

**Detailed**: Dark teal tendrils extend from the caster's body toward the target along gently curving paths. The tendrils pulse with a sickly rhythm as they reach the target, latching on. Damage is dealt on contact. Then bright neon-green particles — the target's stolen life force — begin flowing back along the tendril paths toward the caster. Each returning particle that reaches the Abyss triggers a brief green pulse. The tendrils retract after the transfer is complete, leaving the target diminished and the Abyss restored.

**What the designer draws**: Two phases in one strip — (1) dark tendrils extending outward (2-4 curved lines reaching from left to right), then (2) green particles flowing back in the reverse direction. The tendrils should look organic and unsettling — not clean geometric lines.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | 2 tendrils (sine-curved). 3-5 green return particles. Brief caster green flash. |
| **Elite** | 3 tendrils with pulsing alpha. 8-12 return particles. Dark trail behind tendrils. Target area briefly darkens. Caster sparkles green. |
| **Apex** | 4 tendrils with animated "crawling" wave motion along their length. Neon green highlight along tendril edges. 16-22 return particles forming a visible stream. Dark vortex on target. Green pulse ring on caster. |

**Enhanced (Devour+)**: Return particles shift from green to green-gold. A temporary gold HP bar extension appears briefly above the caster (overheal to temporary HP). Extra-bright green pulse.

---

### 9. Kraken — Bind

> **Role**: Controller | **Target**: Single enemy | **Effect**: 60 base damage + stun for 1 round
> **Placement**: `target_ground` | **Layers**: under + over | **Duration**: ~1000ms

**Short**: Tentacles erupt from beneath the target, wrapping tightly around them. A blue-white stun flash crackles on impact. The target is completely immobilized for one full round.

**Detailed**: The arena floor beneath the target cracks and splits. Thick dark-teal tentacles burst upward — curving inward to constrict around the target. The tentacles are covered in sucker-dot details that pulse faintly. On contact, a blue-white stun flash explodes across the target (small lightning bolt shapes radiating outward), and the target's animation freezes mid-pose. The tentacles hold their grip for the full round, pulsing slowly, while coral-colored energy sparks orbit the bound target. When the stun expires, the tentacles uncoil and retract back below the surface.

**What the designer draws**: Two layer sets — (1) under-layer: tentacles emerging upward from below the target, reaching and wrapping, (2) over-layer: stun flash (lightning/electric crackle) and coral spark particles. The tentacles should look like they're breaking through the arena floor. Include "hold" and "retract" phases.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | 2 tentacles (thick curved lines). Blue-white stun flash (4 lightning lines). Hold for 500ms. |
| **Elite** | 3 tentacles with sucker-dot details. 6-8 lightning lines. Coral spark ring on impact. Tentacles pulse during hold. |
| **Apex** | 4 tentacles with animated joints and suckers. Ground crack particles at tentacle bases (under layer). Screen-level stun flash (brief blue tint). Coral orbit particles around bound target. Dark pool shadow under target. |

**Enhanced (Bind+)**: Tentacles glow brighter (highlight teal). If the target was in Defend stance, a barrier-shatter effect plays — 6-8 rectangular "glass shard" particles fly outward in coral. Signals stun piercing through Defend.

---

### 10. Ember — Inferno

> **Role**: Glass Cannon | **Target**: Single enemy + self | **Effect**: 200 base damage (highest burst), caster takes 25% self-damage
> **Placement**: `travel` (caster → target) | **Layers**: over | **Duration**: ~800ms

**Short**: A massive fireball erupts from the Ember toward the target, engulfing them in a screen-shaking explosion of orange and white-hot flame. The highest raw burst damage in the game — but the Ember takes 25% of the damage it deals as self-inflicted burns.

**Detailed**: The Ember's body glows white-hot as it channels every ounce of volatile energy. A cluster of orange-amber fire pixels coalesces into a fireball that launches from the caster toward the target, trailing flame particles along its path. On impact, the fireball detonates — fire particles explode outward in all directions, the screen shakes violently, and the target is momentarily obscured by the blaze. Lingering flame particles continue to burn at the impact point. Simultaneously, the caster flashes red as recoil damage tears through its own body — cracks of red light appear briefly across the caster. The Ember is the only class that hurts itself to attack.

**What the designer draws**: Three phases — (1) fireball forming and launching (travels left to right), (2) explosion burst at impact point, (3) caster self-damage flash (red flash/crack overlay at origin position). The fireball should feel hot and dangerous — not cute. The explosion should be the biggest, most dramatic effect in the game.

| Tier | Visual Differences |
|------|-------------------|
| **Evolved** | Small fireball (4-6 pixel cluster). 8-10 burst particles. Caster red flash. |
| **Elite** | Larger fireball with visible tail trail. 16-20 fire particles. Orange shockwave ring at impact. Caster red flash with 3-4 red damage particles. |
| **Apex** | Massive fireball with animated internal glow (alternating orange/white-hot). Continuous fire particle trail. 28-35 explosion particles. Multiple shockwave rings. Red crack marks appear across caster briefly. Heat shimmer distortion near impact. |

**Enhanced (Inferno+)**: Fireball shifts from orange to white-hot (white core, pale yellow edges). Caster's self-damage flash is notably reduced (dimmer, shorter). Visual reads as "more controlled power" — the enhanced Ember has learned to channel without as much blowback.

---

## Quick Reference Table

| # | Class | Special | Target | Type | Placement | Layers | Duration |
|---|-------|---------|--------|------|-----------|--------|----------|
| 0 | Bulwark | Fortify | All allies | Shield | ally_center | under+over | ~1200ms |
| 1 | Mantis | Ambush | Single enemy | Strike | target | over | ~600ms |
| 2 | Leviathan | Crush | Single enemy | Strike | target_ground | under+over | ~900ms |
| 3 | Tempest | Maelstrom | All enemies | AoE | team_center | over | ~1100ms |
| 4 | Specter | Haunt | Single enemy | Debuff | travel | over | ~1000ms |
| 5 | Sentinel | Rally | Single ally | Heal | travel | over | ~900ms |
| 6 | Reaver | Rend | Single enemy | DoT | target | over | ~700ms |
| 7 | Abyss | Devour | Single enemy | Drain | travel | over | ~1000ms |
| 8 | Kraken | Bind | Single enemy | Stun | target_ground | under+over | ~1000ms |
| 9 | Ember | Inferno | Single + self | Nuke | travel | over | ~800ms |

---

## Checklist Before Delivery

For each of the 30 base animations + 10 enhanced overlays:

- [ ] Sprite sheet PNG with transparent background
- [ ] Uses role-indexed palette colors (11 neutral grays, not class-specific colors)
- [ ] Frames are uniform size (128×128 or 192×128), arranged horizontally
- [ ] JSON sidecar with frame count, FPS, anchor, placement, layer info
- [ ] Evolved/Elite/Apex tiers show clear visual progression
- [ ] Enhanced overlay is a separate sheet that composites on top of any tier's base
- [ ] Animation reads clearly at 2× speed (half frame time)
- [ ] Effect fits within the arena scale (sprites are ~115px, teams ~320px apart)
- [ ] Under-layer effects look correct behind/below sprites
- [ ] File names follow `vfx_{class}_{special}_{tier}.png` convention
