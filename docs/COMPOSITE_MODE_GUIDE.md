# Composite Mode — Designer Guide

## How Clawbada Lobsters Are Built

Every lobster in Clawbada is assembled from **6 body part layers** that are **stacked on top of each other** in the same 48x48 pixel space. Think of it like 6 transparent sheets of acetate laid over each other — each sheet has one part of the lobster drawn on it.

```
     ┌─────────────────────┐
     │                     │  ← Claws (front, drawn last)
     │   ┌─────────────┐   │
     │   │             │   │  ← Antennae
     │   │  ┌───────┐  │   │
     │   │  │       │  │   │  ← Eyes
     │   │  │ ┌───┐ │  │   │
     │   │  │ │   │ │  │   │  ← Tail
     │   │  │ │ L │ │  │   │
     │   │  │ │   │ │  │   │  ← Legs
     │   │  │ └───┘ │  │   │
     │   │  │       │  │   │  ← Carapace (back, drawn first)
     │   │  └───────┘  │   │
     │   └─────────────┘   │
     └─────────────────────┘

   All 6 parts share the SAME canvas space.
   They overlap — they are NOT side by side.
```

**This is the key concept**: body parts are not placed at different positions on a big spritesheet. They all occupy the same 48x48 area and are painted over each other in a specific order.

---

## Layer Stacking Order (Back to Front)

The compositor paints body parts in this exact order:

| Order | Body Part    | What It Contains                     |
|-------|-------------|--------------------------------------|
| 1st   | **Carapace** | Back shell, main body shape & color  |
| 2nd   | **Legs**     | Walking appendages, lower body       |
| 3rd   | **Tail**     | Tail fan, rear propulsion            |
| 4th   | **Eyes**     | Eye stalks, eye shape & color        |
| 5th   | **Antennae** | Sensory appendages, glow effects     |
| 6th   | **Claws**    | Front claws, weapons (always on top) |

Parts drawn later cover parts drawn earlier. Claws are always visible on top. The carapace forms the background silhouette.

---

## The Designer Workflow in Composite Mode

### Step 1: Enable Composite Mode

Check the **Composite** checkbox in the toolbar. This:
- Creates 6 default layers (one per body part)
- Shows colored filter buttons for toggling body part visibility
- Hides the single-part "Part" dropdown (not needed — you're working on all parts)
- Shows a "Comp" composite preview row

### Step 2: Draw the Whole Lobster

Draw your lobster character on the canvas, using **different layers for different body parts**. Each layer is assigned to a body part via the colored dropdown in the layer panel.

For example:
- Select the **"Cap Base"** layer → draw the shell/back
- Select the **"Claw Base"** layer → draw the claws
- Select the **"Eye Base"** layer → draw the eyes

You're drawing everything on the **same 64x64 canvas**. The parts physically overlap — the carapace pixels and the claw pixels both exist in the same space, just on different layers.

### Step 3: Use the Filter Bar to Focus

The colored buttons in the toolbar (Cap, Claw, Tail, Ant, Eye, Leg) let you hide/show body parts:

- Click **"Claw"** to hide all claw layers — now you can see what's behind them
- Click it again to show claws
- This helps you see how parts overlap and ensure the stacking looks correct

### Step 4: Check the Composite Preview

The **"Comp"** row in the preview bar shows 4 small canvases — one per evolution tier (Base, Evolved, Elite, Apex). These show the fully assembled lobster with all visible body parts composited in the correct stacking order.

### Step 5: Add Tier Progression

Each body part can have multiple layers at different evolution tiers:

| Tier | Name     | Canvas Region | Purpose                              |
|------|----------|--------------|--------------------------------------|
| T0   | **Base**    | Center ~42x42 | Essential silhouette, compact form   |
| T1   | **Evolved** | Center ~52x52 | More body detail, bulk               |
| T2   | **Elite**   | Center ~58x58 | Textures, patterns, class markings   |
| T3   | **Apex**    | Full 64x64    | Spikes, auras, elaborate flourishes  |

To add tier layers: click **"+ Layer"**, set the tier in the layer panel, and assign the body part. A typical setup might be:

```
Cap Base  (T0, Carapace)   ← shell silhouette
Cap Evol  (T1, Carapace)   ← shell detail
Cap Elite (T2, Carapace)   ← shell textures
Cap Apex  (T3, Carapace)   ← shell ornaments
Claw Base (T0, Claws)      ← claw silhouette
Claw Evol (T1, Claws)      ← claw detail
... etc for all 6 body parts
```

### Step 6: Export

Use **File > Export All Parts JSON** to generate 6 separate template files — one per body part. Each file contains only the pixels from layers assigned to that body part, with proper tier tags, anchor points, and mutation zones.

You can also export a single part via **File > Export JSON (Ctrl+S)** — this exports all layers (regardless of body part assignment) as a single template, using the active layer's body part.

---

## How the Palette Role System Works

You don't paint with raw colors. Instead, you paint with **7 semantic roles** that automatically adapt to each of the 10 lobster classes:

| Role | Name                | Typical Use                          |
|------|---------------------|--------------------------------------|
| 0    | **Outline**          | Dark contour lines, silhouette edges |
| 1    | **Primary Shadow**   | Darkest shading on main body color   |
| 2    | **Primary Base**     | Main body color (~50% of pixels)     |
| 3    | **Primary Highlight**| Light areas, specular hits           |
| 4    | **Secondary Base**   | Accent areas, belly, joints          |
| 5    | **Secondary Highlight** | Light areas on secondary color    |
| 6    | **Accent**           | Small pops of contrast (eyes, gems)  |

**One template, 10 class renderings.** A carapace painted with these roles automatically looks correct in Bulwark's steel blue, Ember's fiery orange, Abyss's dark green, etc.

**Custom colors** (roles 7+) are fixed across all class palettes — use them for class-agnostic details like legend effects.

---

## Why Not a Bigger Canvas?

You might expect a larger canvas where body parts are drawn side-by-side and then sliced apart. That's not how Clawbada works. Here's why:

**The game composites at runtime.** When a player's lobster is rendered, the game:
1. Loads 6 separate body part templates (one per part)
2. Paints each one onto a 48x48 canvas at position (0, 0)
3. Stacks them back-to-front (Carapace first, Claws last)

Since every part is painted at the **same origin point**, they must be drawn in the same coordinate space. If the carapace shell occupies pixels (10,10) to (38,38), and a claw overlaps at (8,20) to (20,35), both exist on the same 48x48 grid.

**The composite preview in the editor reproduces exactly what the game does** — it layers all your body part layers in the correct order so you can see the final result while you work.

---

## Anchor Points

Each body part has a reference anchor point that defines its "center of gravity" on the 48x48 canvas:

| Body Part  | Anchor (x, y) | Description        |
|-----------|----------------|---------------------|
| Carapace  | (24, 20)       | Center-back         |
| Claws     | (12, 28)       | Front-center        |
| Tail      | (34, 36)       | Back-low            |
| Antennae  | (18, 10)       | Top-front           |
| Eyes      | (16, 18)       | Front-high          |
| Legs      | (24, 38)       | Bottom-center       |

Anchors ensure body parts align correctly during compositing. The editor auto-sets anchors based on the body part assignment.

---

## Mutation Zones

Mutation zones are rectangular regions where the game's procedural system can modify pixels to create visual variants. Each lobster's DNA specifies a variant number (0-15), and the game applies small changes within these zones — adding pixels, removing them, shifting patterns, etc.

**In composite mode, zones are global** — they apply to whichever body part's pixels happen to be within the zone's rectangle. A zone drawn over the claw area only affects claw pixels because that's the only body part with pixels in that region.

---

## Quick Reference: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+S** | Export single-part JSON |
| **Ctrl+Z** | Undo |
| **Ctrl+Shift+Z** | Redo |
| **B** | Pencil tool |
| **E** | Eraser tool |
| **G** | Fill tool |
| **I** | Eyedropper tool |
| **L** | Line tool |
| **R** | Rectangle tool |
| **Middle-click drag** | Pan canvas |
| **Scroll wheel** | Zoom in/out |

---

## Summary

1. **All 6 body parts share the same canvas** — they overlap, not side-by-side
2. **Draw on separate layers** — assign each layer to a body part
3. **The filter bar** lets you hide/show parts to focus on one area
4. **The composite preview** shows the assembled lobster in real-time
5. **Export All Parts** generates 6 JSON files automatically
6. **Paint with roles** (0-6) so one template works across all 10 classes
7. **Add tier layers** (T0-T3) for evolution visual progression
