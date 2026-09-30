# SettingsButtonUI visual asset handoff

## Scope

`Assets/Prefabs/UI/SettingsButton/SettingsButtonUI.prefab` is a visual-only uGUI prefab for the exported settings/gear button. No battle scene placement, click handling, menu opening logic, or pause/settings runtime wiring is included.

The source export came from `F:/Project/Blocksurfing/UI/SettingsButton.png` and was imported into Unity as `Assets/Art/UI/SettingsButton.png`.

## Layout

Native RectTransform size: **32 x 32** UI units. The root contains a single `Image` and an `Animator`. The Image has `raycastTarget=false`; add the actual input/hit target during integration if needed.

## Slices

`Assets/Art/UI/SettingsButton.png`: **64 x 32**, two **32 x 32** cells left-to-right:

1. `SettingsButton_Normal`
2. `SettingsButton_Pressed`

Import settings match the other pixel UI assets: Sprite, Multiple, 64 PPU, Point filtering, no mipmaps, uncompressed, centered pivots.

## Visual states

The root Animator uses `SettingsButton_Visual.controller` with two manual states:

- `Normal` (default): `SettingsButton_Normal`, static.
- `Pressed`: `SettingsButton_Pressed`, static while held.

There are no automatic transitions. The developer should drive it from UI/input logic, for example:

```csharp
animator.Play("Pressed", 0, 0f);
animator.Play("Normal", 0, 0f);
```

Use this as a visual handoff only; do not let a separate Button SpriteSwap and this Animator both drive the same Image sprite.

## Verification

Unity imported the two sprite slices, created the prefab, controller, and Normal/Pressed clips, then loaded the prefab back to verify its Image sprite, Animator, size, and visual-only `raycastTarget=false` setting. No rendered gameplay scene approval or runtime settings-menu test was performed.
