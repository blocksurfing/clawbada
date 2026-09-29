# AvatarUI visual prefab

## Scope

Universal visual-only uGUI prefab: `Assets/Prefabs/UI/Avatar/AvatarUI.prefab`.
No Avatar battle scene, existing HUD, or gameplay script integration. The accompanying ActionButton migration only updates the normal-frame reference in HudSkin and its editor binder. Existing `Assets/Art/UI/Avatar.png` is preserved.
Includes the exported frame sheet, class backgrounds, four-state HP fill sheet and MP fill. Portraits and status icons are not supplied or fabricated. No HP thresholds or runtime class/state mapping are implemented.

## Layout

Native RectTransform size: 112 x 64 UI units. Put under the intended Canvas and scale the parent as a unit. Point-filtered uncompressed sprites, no mipmaps, 64 PPU. Each Image uses explicit native pixel dimensions; images do not intercept raycasts.

Sibling draw order (back to front):

1. `SelectedOutline`: 112 x 64, centered, **inactive by default**. Animator swaps the three outline sprites. This is behind the normal frame, not a front overlay.
2. `ClassBackground`: 32 x 32, center-anchored position **(-29, -2)**. Bulwark assigned solely as a preview/default. Swap Image.sprite for other classes; no separate class prefab is needed.
3. `Frame`: 112 x 64, centered, always visible.
4. `HPFill`: 64 x 32, position (15, 9), `HP_Healthy` by default.
5. `MPFill`: 32 x 32, position (1, -12), `MP_Fill`.

The fills are above Frame because Frame includes opaque dark bar backings. Their nontransparent pixels sit fully within those backings and do not cover the colored border at full fill. Both use Image.Type.Filled / Horizontal / Left, fillAmount=1, with raycastTarget=false. Preserve rect sizes/positions when swapping HP sprites. Canvas padding is retained: fillAmount clips the full sprite rect, not an exact curved-area percentage.

HP_Bar.png is 256 x 32: four 64 x 32 cells left-to-right named HP_Healthy (green/teal), HP_Wounded (yellow), HP_Low (orange), HP_Critical (red). MP_Bar.png is a single 32 x 32 cell named MP_Fill. All HP alpha masks match; all are full-length art. Developer chooses thresholds and swaps the Image.sprite without resetting fillAmount. No thresholds are assumed.

Measured portrait aperture in source frame: x=[11,43), y=[18,50) in top-left PNG coordinates. All supplied class backgrounds cover the transparent aperture at this placement. Future portrait goes above ClassBackground and below Frame, with suitable aperture clipping if its artwork extends outside the circle.

## Slices

`Assets/Art/UI/Avatar/Frame.png`: 112 x 256, four 112 x 64 cells, top-to-bottom:

- `Avatar_Frame`: normal frame, excluded from animation.
- `Avatar_Selected_01`
- `Avatar_Selected_02`
- `Avatar_Selected_03`

Unity bottom-left slice Y values are 192, 128, 64, 0 respectively.

`Assets/Art/UI/Avatar/Avatar_BG.png`: 320 x 32, ten 32 x 32 cells, left-to-right:

1. Bulwark
2. Mantis
3. Leviathan
4. Tempest
5. Specter
6. Sentinel
7. Reaver
8. Abyss
9. Kraken
10. Ember

Names: `Avatar_BG_<Class>`.

## Selected animation

`Avatar_Selected.anim` and `Avatar_Selected.controller` reside next to the prefab.
The clip binds `UnityEngine.UI.Image.m_Sprite` on SelectedOutline (not SpriteRenderer).
Loop order is 01 -> 02 -> 03 -> 01. **8 fps is an adjustable initial timing, not an artist-approved final timing.** Animator uses unscaled time.
Developer hookup: toggle `SelectedOutline.SetActive(isSelected)` and replace ClassBackground's Image.sprite from class data. No runtime mapping/selection logic has been added here. Selection restart/timing can be decided during integration.

## Validation boundary

The build method verifies imported sprite names/rects, counts/settings, saved prefab references, child order, BG coordinates, selected-off default, and samples each animation sprite in Unity. Pixel coverage is checked against the actual PNG alpha mask. This is asset/serialization validation, not rendered visual approval or battle integration testing; Nzib owns visual approval in Unity.
