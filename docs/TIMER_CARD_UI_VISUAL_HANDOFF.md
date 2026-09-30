# Timer card visual handoff

## Assets and hierarchy

Unity project: `packages/battle-engine/ClawbadaBattle`.

- `Assets/Art/UI/Timer_Frame.png`: original 48×48 frame/backing, Single sprite.
- `Assets/Art/UI/Timer_Indicator.png`: original 192×48 **outline hex** sheet, Multiple sprite. Four 48×48 cells, left to right: `Timer_Indicator_Green`, `Timer_Indicator_Yellow`, `Timer_Indicator_Orange`, `Timer_Indicator_Red`; rect x = 0, 48, 96, 144 and y = 0.
- Both: 64 PPU, Point filter, uncompressed, no mipmaps, Full Rect mesh, centered pivot, clamp wrapping.
- `Assets/Prefabs/UI/TimerCard/TimerCardUI.prefab`: reusable visual-only 48×48 uGUI card. Place beneath the application's Canvas; integer scaling/pixel-aligned placement is recommended.

Hierarchy (draw order):

```
TimerCardUI (RectTransform, 48×48)
  Frame      (Image, Simple, 48×48)
  Indicator  (Image, Filled / Radial360 / Top / Clockwise, 48×48)
  Number     (UI.Text, centered 28×24 text box)
```

Default indicator: green sprite, white tint, fillAmount = 1. Number is a sibling, not masked/filled by Indicator. All three graphics are non-raycast targets. There is no Canvas, Button, Animator, timer controller, countdown script, or gameplay integration in this prefab.

## Number/font

Number uses existing `UnityEngine.UI.Text`, matching `HudFactory`, `ClockView`, and the project's pixel-font wiring, rather than introducing TMP font resources/dependencies. The project HUD has no authored TMP pixel-font asset; the existing font is `Assets/Resources/UI/Fonts/Silkscreen-Regular.ttf` (`HudSkin.PixelFontOrDefault`). No downloaded font or digit artwork was added.

- Editable dynamic `Number.text`, preview `60` only.
- Silkscreen Regular, fixed fontSize **16**, MiddleCenter, best-fit/auto-size disabled, white, rich text disabled.
- Two-digit design default: 16px follows the existing 8px font grid and fits the interior. Longer values need an explicit layout/font-size decision; overflow is not automatically shrunk. Silkscreen is not monospaced.
- Preview `60` is not a duration, countdown, or timing contract.

## Developer note: font sharpness and outline

- Artist reported that the timer numeral appears blurry compared with the pixel-art frame. Sharpness remains an open developer task, not a verified fix in this art handoff.
- Investigate font atlas filtering/rasterization, Canvas scaling, pixel alignment and the current Text style (the saved prefab currently uses Bold). These are checks, not a confirmed root cause. Preserve artist adjustments; avoid global font/import changes without reviewing other HUD text.
- Added a local `UnityEngine.UI.Outline` on `Number`: opaque black, effectDistance `(1, -1)` in UI units, useGraphicAlpha enabled. This improves separation/contrast; it does **not** resolve font blur. Thickness on screen depends on Canvas scale.
- Existing text/font/style/placement and timer fill behavior are preserved. No countdown integration or shared font changes were made.
- Outline verified by Unity prefab save/reload and a mesh-effect check (one triangle becomes 15 vertices after applying the outline). Visual sharpness still needs developer/artist review at intended display scale.

## Developer integration (not implemented here)

Keep the existing authoritative deadline/`remainingMs` behavior; do not create a second countdown owner for this visual. Update the Image and number from the existing timer state:

```csharp
indicator.fillAmount = total > 0f
    ? Mathf.Clamp01(remaining / total)
    : 0f; // explicit invalid/empty budget policy; adapt to product requirements
number.text = displayValue; // formatting/rounding belongs to the timer owner
```

Use consistent time units. Supply the actual total turn/time budget separately: existing `ClockView.StartClock` receives remainingMs, not total duration. Never infer total from the preview `60`, or treat remainingMs at late join/reconnect as a fresh full budget. The developer owns invalid-budget policy and display rounding.

Switch `indicator.sprite` among the four supplied slices independently of `fillAmount`. All slices share dimensions/pivot/outline geometry; sprite swaps preserve the fill. There are **no hardcoded color thresholds** in this delivery. Existing danger text color and indicator color selection are separate concerns.

`Filled / Radial360` clips the exported transparent-center outline with an **angular sweep**, starting at Top and proceeding clockwise. Decreasing fill removes the clockwise sweep from its end. It does not measure constant distance along the hex perimeter. Frame and number remain fully visible at zero fill.

## Verification

Executed a temporary Unity Editor API helper in batch/nographics mode; no screenshots or playtests. It imported/sliced via SpriteDataProvider and TextureImporterSettings, saved/reloaded the prefab, and asserted settings, font resolution, nonempty text, hierarchy, visual-only components, and full-fill saved defaults.

Actual `Image.OnPopulateMesh` / VertexHelper samples:

| fillAmount | vertices | generated triangle area |
|---|---:|---:|
| 1 | 4 | 2304 |
| .75 | 12 | 1728 |
| .5 | 8 | 1152 |
| .25 | 4 | 576 |
| 0 | 0 | 0 |

Area describes the UI clipping mesh, not opaque outline pixel area. At each sample all four color sprites were switched without changing fill; frame and number serialized state stayed unchanged. Samples ran on loaded prefab contents, restored green/full, and left saved default at 1. The temporary helper was removed after verification.

Log marker: `TIMER_CARD_VERIFIED slices=4 prefabReload=true radialMeshSamples=5 colorSwaps=20 frameAndNumberUnchanged=true restoredFill=1`.
