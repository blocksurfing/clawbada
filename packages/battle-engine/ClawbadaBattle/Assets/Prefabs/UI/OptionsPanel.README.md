# OptionsPanel — art review prefab

`Assets/Prefabs/UI/OptionsPanel.prefab` is a standalone, editable UGUI visual layout. It does **not** replace or wire the code-built `OptionsMenu` in battle. Existing audio preferences, hints persistence, and confirmed-forfeit flow remain unchanged.

- Native layout: 100 × 158 UI units, top-left anchored at (12, -60) on a 640 × 360 canvas. This reserves the area above for the existing pause/timer; neither is duplicated here.
- Separate children: panel/ties, MUSIC and SFX headings, icon Toggles, volume Sliders, HINTS heading/icon/status, FLEE Button, and exterior Close Button. No OPTIONS title.
- Open `Assets/Scenes/UI/OptionsPreview.unity` for the isolated art-review composition. This scene is not added to build settings and is not a battle integration.
- Artwork: exact frame-0 normal crops and authored frame-2 pressed cels from the external artist `UI/GUI.aseprite`. ButtonPressed/FleePressed retain the source one-pixel downward offset in padded 48×16 crops. ClosePressed is 12×16; KnobPressed is 4×8. Native SpriteSwap transitions on FLEE, Close, and both volume Sliders display the authored pressed artwork during pointer interaction and restore normal on release. These sprite swaps do not add gameplay bindings. Music/SFX/Hint retain their paired On/Off icons; no pressed artwork is synthesized. Artist source unchanged. Assets are in `Assets/Art/UI/Options/`; the brown button normal/pressed pair is included for later use but is not visible in this layout.
- Point filtering, no compression/mipmaps, 64 PPU. Panel/button/track are tiled Images with fixed borders. Image pixels-per-unit multiplier is 100/64 for a standard Canvas reference PPU of 100. Use integer canvas scale for review (1x/3x).
- Labels use the existing approved Upheaval font. There is no body copy in this layout; future body/confirmation copy should use the existing BigShot font.
- Initial review pose: music/SFX icons on, sliders 10, hints off. These are visual sample values, NOT saved gameplay preferences.
- Toggles/sliders are native editable UGUI controls; all persistent callbacks are empty. HintsStatus is an independently editable Text with `OFF`; it intentionally does not change from clicking the review icon without future binding. FLEE and Close intentionally perform no gameplay/navigation action.
- Keep the existing forfeit-confirmation requirement when integration is separately approved; do not connect FLEE directly to the API.

## Artist preview and editable slide clips (no gameplay integration)

Reopen `Assets/Scenes/UI/OptionsPreview.unity` and press Unity Play: the panel automatically opens. Click the exterior close arrow to close it; press Space/R with Game View focused, or click **Open Options**, to reopen. `OptionsArtistPreview` supplies these scene-only controls. The production prefab's persistent callbacks remain empty; neither the gear nor battle/menu code is wired.

Select `OptionsPanel` in the scene and open Animation Window to edit `Open` / `Close`. Clips and their controller live in `Assets/Animations/UI/Options/`. They animate `PanelSlideMotion.progress`; the component maps progress onto the current Canvas left edge and the authored rest. Animation Window preview visibly moves the panel and restores its pose on stop.

For later integration, the root `Clawbada.UI.PanelSlideMotion` exposes `Open()` and `Close()`. Parent the prefab under its intended Canvas before calling `Open()`.

- Edit the root RectTransform to choose its resting position. The saved prefab pose stays visible for authoring; in Play Mode it starts hidden until the scene preview or owning developer calls `Open()`.
- Timing and easing are edited in the clips, not a separate script Duration/Easing Inspector. Current artist timing is 18 frames at 35 fps (about 0.514 seconds), with ease-in-out endpoints. Keep Open and Close as equal-length time-reversed curves for continuous reversals. Playback uses unscaled time, so it works while paused.
- `Open()` starts fully outside the Canvas left edge and finishes exactly at the authored rest. `Close()` moves the complete hierarchy (including exterior arrow) left offscreen, then deactivates the root. Call `Open()` on the retained component reference to reopen it.
- Reversing a transition starts at the current position, with no jump. Repeated same-direction calls are ignored. Hidden position is recalculated from Canvas bounds and all descendant RectTransforms on each new transition; it is not a hard-coded screen-width offset.
- Controls are disabled during motion; visible moving graphics still block pointer rays. Closed visuals neither render nor intercept input. Existing SpriteSwap and toggle press motion remain unchanged.
- Position changes made while fully open are captured on the next `Close()`. Keep anchors/layout stable during a running transition; do not let another animator/layout driver simultaneously move this root.

Verification evidence is outside the project: `F:/Project/Blocksurfing/OptionsPrefabEvidence/`. Actual Unity 6000.4.2f1 imports, reopened prefab checks, graphics-enabled camera renders at 640×360 and 1920×1080, and native pointer-handler tests are recorded there. This is not an end-to-end live battle or ScreenSpaceOverlay test.
