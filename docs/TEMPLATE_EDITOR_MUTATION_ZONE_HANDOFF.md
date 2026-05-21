# Mutation Zone Handoff Note

Audience: pixel artist using `template-editor-v5.html`

## What a mutation zone is

A mutation zone is a rectangular area where the game is allowed to slightly change the template when it generates visual variants.

- Inside a zone, the game may add pixels, remove pixels, shift a small area, thicken outlines, add patterns, or add small detail clusters.
- Outside a zone, the template stays exactly as drawn.
- Variant `0` is always the untouched original. Mutations only happen on the generated variants.

The safest mental model is:

`mutation zone = permission to vary this area`

Not:

`mutation zone = important detail area`

## How to draw one in the editor

![Mutation zone tool overview](images/template-editor/mutation-zone-editor-overview.png){ width=70% }

1. Pick `Mut. Zone` in the left toolbar, or press `Z`.
2. Click once on the canvas to start the rectangle.
3. Click again to finish the rectangle.
4. The zone will appear in the `Zones` list.
5. Use the `x` in that list to remove a bad zone.

## Current state of the Apex workspaces

The current files in `packages/asset-gen/apex_characters_clwb` are already useful as reference:

- they are composite full-character workspaces
- they currently have `0` mutation zones defined
- each workspace has 6 body-part layers

![Current Apex designer workspaces](images/template-editor/mutation-zone-current-apex-workspaces.png){ width=92% }

This means the handoff is not asking the designer to redraw anything. It is asking them to decide where variation is safe on top of the work they already finished.

## What makes a good zone

Use zones on ornamental or flexible areas:

- shell ridges
- texture bands
- tips, spikes, serrations
- decorative markings
- flat interior areas that can take dots/stripes/checkerboard

Keep these stable:

- the main silhouette
- anchor / attachment area
- joints and hinges
- eyes, pupils, and tiny precision details
- narrow connection points

Rule of thumb:

If a 1-pixel shift would break the shape, do not zone it.

## Recommended zone plan per part

Aim for `2-4` small zones, not one giant zone.

- `Zone 1: edge zone`
  Place it on an outer edge, tip, or ridge that can tolerate tiny silhouette changes.
- `Zone 2: interior zone`
  Place it on a flatter interior area that can take patterns or overlays.
- `Zone 3: detail zone`
  Place it on a secondary feature that can shift slightly without changing the identity of the part.
- `Zone 4: optional`
  Only if the body part is large enough and has another clearly separate feature.

## Composite-mode note for the current files

The Apex `.clwb` files are composite workspaces, so zones are drawn on the full 64×64 character canvas.

That means:

- draw the rectangle over the actual body part area you want to vary
- a zone over the claw region should only affect claw pixels, because the other parts do not have pixels there
- avoid drawing broad rectangles that overlap multiple body parts unless you intentionally want all of them to be eligible for mutation there

## Good vs bad examples

### Carapace

![Carapace good vs bad](images/template-editor/mutation-zone-carapace-good-vs-bad.png){ width=88% }

Good:

- small zones on ridge, stripe band, and lower ornament
- stable center mass
- stable anchor/core area

Bad:

- one giant zone over most of the shell
- zoning the anchor/core silhouette area

### Claw

![Claw good vs bad](images/template-editor/mutation-zone-claw-good-vs-bad.png){ width=88% }

Good:

- zone serrations, ridges, and decorative inner detail
- keep the main pinch shape intact

Bad:

- zoning the hinge
- zoning the pinch gap
- zoning any place where a 1-pixel move changes the whole claw read

## Important current tool limitation

Right now, every new zone is created with all six mutation behaviors enabled by default.

That means a zone currently says:

`any supported mutation is acceptable here`

So when placing zones, be conservative. Only mark areas that can survive all of the following:

- slight silhouette growth
- slight silhouette loss
- small 1-pixel shifts
- thicker outline
- interior patterning
- tiny decorative overlays

## Previewing mutations in the editor

You can now see what mutations will actually do to your art before exporting:

1. Draw your mutation zones as usual (press `Z`, click twice to place each rectangle).
2. Press **Shift+Z** or click the **Preview Mutations** button in the Zones section.
3. A new row appears in the preview bar: **Original** + **4 random variants**.
4. Click **Re-roll** (or press Shift+Z again to toggle off/on) to see different random outcomes.
5. If a variant looks too destructive, shrink or reposition the zone and preview again.

The preview uses the same 6 mutation operations that the game pipeline uses (add pixels, remove pixels, shift, thicken, pattern fill, detail overlay). Each variant picks 1-3 random mutations per zone.

## Quick checklist before export

Before export, confirm all of the following: `2-4` small zones, some stable area left untouched, zones kept away from the anchor/attachment area, the main identity silhouette left stable, and every zone able to survive a 1-pixel change.
