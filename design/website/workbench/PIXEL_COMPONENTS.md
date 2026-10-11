# Pixel components — Clawbada workbench

Use these for new pixel-art UI. Animated sidebar/user-section remain separate.

The sidebar's compact state retains all navigation icons. Its cloth uses two source tiles
(96px at 3×). The banner canvas is 144px including transparent overhang, while the pole
renders independently at 288px and sets the content footprint, leaving its right endcap
visible beyond the independent 192px logo/music controls. Toggle rolls the current banner
fully up before switching width and unrolling the other banner. Active state uses the
existing ribbon, with no extra red icon outline. There is no sidebar scrolling; unusually
short viewports retain the existing height limitation.

Sidebar artwork loads the artist-owned **Pole.png** (256×16) and **Banner.png**
(304×96) directly; no combined-sheet mask or generated crop. Pole has four 64×16
poses, repeating only tile #2 and keeping both rightmost tiles. The full pole is the toggle target, including its exposed final
tile. Both toggles play pole frames 0→1→2→3 concurrently with
the outgoing banner roll, then hold frame 3 (the source's final rest pose).
Banner has **five 48px-wide poses at x=0,64,128,192,256**, not six contiguous
48px frames: the 16px gutters and extra taper art below pose 0 are not poses.
Closing uses forward poses, opening reverse; all source tiles display at 3×.

## One-time asset registration

Add an entry in `pixel-assets.js`. Use a static `new URL('../site/...png', import.meta.url).href`
so Vite resolves, bundles and watches the real source. Set source `width`/`height` and:
- `kind: 'sprite'`, `frame: [width, height]` for icons or standalone images (whole image = one frame).
- `kind: 'panel'`, `region: [x, y, width, height]`, `tile: 16` for a 3-by-3 nine-slice region.

Never add per-asset scales. `styles/shared.css` owns `--pixel: 3px`.

## Markup

```html
<span data-pixel-sprite="menuIcons" data-frame="1" aria-hidden="true"></span>
<section class="pixel-panel" data-pixel-panel="woodenPanel">Content</section>
<button class="pixel-button" type="button">Action</button>
<a class="pixel-button pixel-button--secondary" href="#/market">Market</a>
<div class="pixel-grid" data-pixel-grid data-columns="3" data-min-width="270">
  <!-- Cards here -->
</div>
```

Decorative sprites use `aria-hidden`. Meaningful standalone sprites need a label and role.
Button defaults retain the current flat pixel styling; sprite-backed buttons can use the same
sprite or panel attributes without inventing new art. Hover/focus/pressed/disabled states are shared.

`main.js` mounts `mountPixelUI(main)` after rendering each page and disposes observers on navigation.
If code inserts pixel components later, dispose/remount the page helper after inserting them.
Do not mount twice on existing canvases. Pages start as HTML fragments; the lineup picker
and Battle modal add dynamic UI with their own mount/cleanup lifecycles.

## Scale, sizing and alignment

- Sprites render at source dimensions × global integer scale.
- Panels draw directly from the original sheet into source-resolution canvas, displayed at 3×.
- Corners stay fixed. Edges AND center repeat. Partial end tiles clip at whole source pixels;
  no border-image centering, texture stretching, or stale generated crops.
- Dimensions round width down / height up to 3px; grid tracks use integer 3px multiples.
- Shared observers snap component paint positions relative to the content origin and update
  after resize, sidebar width transitions, font load, and scrolling. Layout does not snap font glyphs.
- Frame/region metadata is centralized. Grid column count is capped by `data-columns`.
- Modern Chromium/Brave is the verified target; CSS uses `round()` and `calc-size()`.

## Artist workflow

Edit Aseprite → **export the existing PNG** → local Vite preview reloads automatically.
`tools/pixel-source-watch.js` watches registered sources, including replacement/add events.
It checks source dimensions and regions on dev startup/build and exports. It never rewrites art.
If sheet dimensions change, update the registry once. Saving only `.aseprite` does not export PNG.
The old cropped-panel pipeline is superseded; no generated PNG needs manual refresh.

## Checks

`npm test` checks tile clipping, frame bounds, grid geometry, source-watch events and routes.
`npm run build` validates registered artwork and bundles original assets.
Visual approval belongs to Nzib; don't take screenshots or redesign adjacent components unasked.
