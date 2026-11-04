# PressureIndicatorUI — art-only authored preview

`PressureIndicatorUI.prefab` is a standalone RectTransform + Animator, intended as a child of an existing UGUI Canvas. Native bounds: 32 × 184 UI units. Use integer Canvas scaling for crisp pixels. No Canvas, raycast targets, gameplay code, HUD wiring, or scene edits are included.

Hierarchy: BG, FillArea (Fill, Bubble), Frame, Fire, Text. BG and Frame preserve their relative authored source positions. Text is horizontally centered over the tube (anchored X 7.5), with its authored vertical position and dimensions preserved. Text is the artist's static **15%** bitmap, deliberately unchanged across all previews. It is not a pressure readout.

BG uses `PressureOverlay.mat` / `PressureOverlay.shader` for true destination-dependent Overlay blending at Image alpha **0.75**. This shader targets the project's Built-in render pipeline and uses an unnamed GrabPass (framebuffer-copy overhead). Verified in the current gamma-color-space D3D11 project with World Space, Screen Space Camera, and Screen Space Overlay canvases. URP/HDRP and other graphics platforms are not claimed as supported.

One editable Animator controller has four looping 0.8-second, 10fps clips: Normal, Warm, Hot, Boiling. Set integer `PreviewState` to 0, 1, 2, or 3, or select a state/clip in the Animator/Animation window. No automatic gameplay thresholds are implemented. Normal is the blue/cold art state and includes the artist's new Bubble-Normal. Warm/Hot/Boiling use yellow/orange/red fills and their corresponding bubble/fire sprites. Normal has no visible fire.

Preview fill heights are 22/48/96/141 pixels only to exhibit low-to-full composition; these are NOT game mechanics. Fill uses a vertically tiled, unmodified 10×16 source swatch. Bubble follows its surface; the fire's source-union canvas stays at the fixed base with bottom alignment. Every source frame is kept, including identical-looking frames. All authored frame durations are 100ms. Frame/BG/Text use static first-frame art (linked unchanged in source).

Source: external read-only `UI/Menu.aseprite`. Sprite assets are literal layer/cel exports with stable per-layer union canvases for animated pixels. No generated/repainted art. Sprite import: Point, no compression, no mipmaps, 100PPU (UGUI reference PPU), single sprites. Keep source union transparency to preserve animation offsets.

Runtime integration remains developer-owned. This prefab intentionally does not alter HudSkin, gameplay scripts, other prefabs, or scenes.
