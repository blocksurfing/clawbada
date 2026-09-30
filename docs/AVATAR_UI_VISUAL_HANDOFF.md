# AvatarUI visual prefab

## Scope

Universal visual-only uGUI prefab: `Assets/Prefabs/UI/Avatar/AvatarUI.prefab`.
No Avatar battle scene, existing HUD, or gameplay script integration. The accompanying ActionButton migration only updates the normal-frame reference in HudSkin and its editor binder. Existing `Assets/Art/UI/Avatar.png` is preserved.
Includes the exported frame sheet, class backgrounds, four-state HP fill sheet, MP fill, ordering badge sheet, class badge sheet, and five artist-confirmed status badges. Portraits are not supplied or fabricated. No HP thresholds, runtime class/status/state mapping, or unit-order mapping are implemented.

## Layout

Native RectTransform size: 112 x 64 UI units. Put under the intended Canvas and scale the parent as a unit. Point-filtered uncompressed sprites, no mipmaps, 64 PPU. Each Image uses explicit native pixel dimensions; images do not intercept raycasts.

Sibling draw order (back to front):

1. `SelectedOutline`: 112 x 64, centered, **inactive by default**. Animator swaps the three outline sprites. This is behind the normal frame, not a front overlay.
2. `ClassBackground`: 32 x 32, center-anchored position **(-29, -2)**. Bulwark assigned solely as a preview/default. Swap Image.sprite for other classes; no separate class prefab is needed.
3. `Frame`: 112 x 64, centered, always visible.
4. `HPFill`: 64 x 32, position (15, 9), `HP_Healthy` by default.
5. `MPFill`: 32 x 32, position (1, -12), `MP_Fill`.
6. `OrderingBadge`: 16 x 16, position **(-46, 10)**, `OrderingBadge_1` by default. This is above the frame/bars and is a sprite swap target for battle order `1` through `6`.
7. `ClassBadge`: 16 x 16, center-anchored position **(28, -6)**, centered pivot, unit scale, `ClassBadge_Bulwark` as preview/default only. Simple Image, preserveAspect=true, raycastTarget=false. Positioned to the right of the MP bar, before the green status arrow shown in the artist's mockup. The five status sprites are supplied as a library for the three reusable StatusRow slots; no runtime arrow/status logic is added. Existing children, including the manually tuned OrderingBadge, are unchanged.
8. `StatusRow`: 34 x 34, center anchors and centered pivot, anchored position **(37, -15)**, unit scale, last sibling. **Inactive by default** so an unbound instance does not falsely display statuses. Three reusable 16 x 16 Image slots form a compact two-row cluster with the unchanged ClassBadge: `[ClassBadge][StatusSlot1]` above `[StatusSlot2][StatusSlot3]`, with 2 px gaps. Slot 3 has a separately toggled, inactive overflow Text child. No layout or runtime components are added. See status integration below.

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

`Assets/Art/UI/Avatar/OrderingBadge.png`: 96 x 16, six 16 x 16 cells, left-to-right:

1. `OrderingBadge_1`
2. `OrderingBadge_2`
3. `OrderingBadge_3`
4. `OrderingBadge_4`
5. `OrderingBadge_5`
6. `OrderingBadge_6`

Developer hookup: swap `OrderingBadge`'s Image.sprite from the current battle/unit ordering data. The badge is visible by default as `OrderingBadge_1`; disable the GameObject or clear the sprite only if a screen state intentionally has no displayed order number.

## Class badge slices and integration boundary

`Assets/Art/UI/Avatar/ClassBadge.png`: 160 x 16, ten 16 x 16 cells, left-to-right in the artist-confirmed order:

1. `ClassBadge_Bulwark`
2. `ClassBadge_Mantis`
3. `ClassBadge_Leviathan`
4. `ClassBadge_Tempest`
5. `ClassBadge_Specter`
6. `ClassBadge_Sentinel`
7. `ClassBadge_Reaver`
8. `ClassBadge_Abyss`
9. `ClassBadge_Kraken`
10. `ClassBadge_Ember`

Unity slice rects are (x, 0, 16, 16), with x = 0, 16, 32, 48, 64, 80, 96, 112, 128, 144. Center pivots, 64 PPU, Point filter, uncompressed, no mipmaps, Full Rect mesh. The source export is copied unchanged.

**Bulwark is only the serialized preview/default.** Upstream ActivePanel now binds ClassBadge from the unit class through HudSkin and uses the OrderingBadge sprites. Its separate legacy status row starts beside ClassBadge and wraps upward in two columns; that is not the compact prefab layout below. Integrate the new StatusRow explicitly rather than displaying both rows. This art patch does not modify ActivePanel, status layout code, or any gameplay/runtime scripts.

ClassBadge validation used a temporary Unity Editor API helper: loaded all ten imported Sprite sub-assets and checked their names, rects, pivots, PPU, GUID/local IDs and importer settings; saved and reloaded the prefab; verified the Bulwark sprite reference, badge geometry, and all six existing child states. The helper was removed after verification. No screenshots, generated previews, playtesting, or rendered visual approval were performed; Nzib owns final visual QA and runtime status spacing remains a developer integration task.

## Status badge slices and integration boundary

`Assets/Art/UI/Avatar/StatusBadge.png` is the unchanged 80 x 16 artist export: one sheet imported as Sprite (Multiple), five 16 x 16 cells, 64 PPU, Point, uncompressed, no mipmaps, centered pivots, Full Rect mesh.

### Retained sprite library (not fixed semantic slots)

| Sprite name | Slice rect (x, y, w, h) |
| --- | --- |
| `StatusBadge_Defense` (defense stance) | (0, 0, 16, 16) |
| `StatusBadge_ArmorBuff` | (16, 0, 16, 16) |
| `StatusBadge_Bleeding` | (32, 0, 16, 16) |
| `StatusBadge_Debuff` | (48, 0, 16, 16) |
| `StatusBadge_BlockedTurn` | (64, 0, 16, 16) |

All five imported Sprite sub-assets and their PNG/meta remain unchanged and available for runtime swapping. Three visible slots are a presentation capacity, not a limit on simultaneous game statuses.

### Compact prefab hierarchy

```text
AvatarUI (112 x 64; unchanged)
├── ClassBadge (unchanged center 28,-6; 16 x 16)
└── StatusRow (inactive; center 37,-15; 34 x 34)
    ├── StatusSlot1 (Image; local 9,9; Avatar center 46,-6)
    ├── StatusSlot2 (Image; local -9,-9; Avatar center 28,-24)
    └── StatusSlot3 (Image; local 9,-9; Avatar center 46,-24)
        └── OverflowLabel (Text; inactive; local 0,0; 16 x 16)
```

Row, slots, and label use center anchors (0.5, 0.5), centered pivots and unit scale. Each slot is 16 x 16, Simple Image, preserveAspect=true, raycastTarget=false. Slots are reusable display positions, not bound status types. All three slots have activeSelf=true and enabled Images; their serialized previews are Defense, ArmorBuff, and Bleeding respectively, **not game state or a chosen ordering policy**. Enable StatusRow only for authoring preview or after binding actual statuses.

Layout is `[ClassBadge][StatusSlot1]` / `[StatusSlot2][StatusSlot3]`, with 2 px horizontal and vertical gaps. Combined badge/slot bounds are x=[20,54], y=[-32,2], inside the unchanged 112 x 64 root bounds x=[-56,56], y=[-32,32]. No original frame, badge, bars, or root sizing/placement changed.

`StatusSlot3/OverflowLabel` uses existing `UnityEngine.UI.Text`, white Silkscreen-Regular at fixed **8 px**, middle-center alignment, raycastTarget=false, rich text and best-fit disabled. Its serialized text is **+2**, inactive by default. Unity TextGenerator measured that preview at **13 x 10**, fitting its 16 x 16 rect. The slot Image component and child Text/GameObject can be toggled separately: keep StatusSlot3 active, disable its **Image component** (not its parent GameObject), and activate OverflowLabel for overflow. Restore the Image and hide the label for an ordinary third icon. No automatic switching or count calculation exists in this prefab.

### Developer hookup required (not implemented)

- Bind from authoritative active-status data; hide/reset unused slots and overflow before enabling StatusRow. With zero statuses keep the row hidden. The row remains inactive by default because ActivePanel does not bind it yet.
- For **one to three** active statuses, show all statuses in the reusable slots and hide OverflowLabel.
- For **more than three**, show the first two status icons; replace the third icon with **+N**, where **N = active status count - 2** (four statuses => +2; five => +3). This user-approved convention counts every status not shown as an icon, not just the amount above three.
- Runtime chooses and consistently applies the status ordering policy; **no priority/order is assumed here**. Swap Image.sprite from the retained library as appropriate. This layout defines no status maximum, duration, threshold, eligibility, or mechanics; `StatusBadge_BlockedTurn` must not be implicitly mapped to stun. Larger count strings need developer handling/fit validation rather than assuming a maximum count.
- Full-status detail access/interaction (for example whatever detail UI the developer selects) remains a **developer task, not implemented**. There is no click handler, tooltip, popup, input routing, or runtime script added by this visual patch.
- ActivePanel's existing legacy runtime status row currently caps at four entries including defense and may overlap this cluster. Replace or explicitly reconcile that row, its capacity, and its placement before enabling this prefab row in battle; never display both uncoordinated rows.

Validation: a temporary Unity Editor API helper verified all five imported Sprite names/rects, saved/unloaded/imported/reloaded the prefab, checked exactly three reusable Images and one inactive overflow Text, slot geometry and preview references, and measured +2 with TextGenerator. Original non-status components were compared before save, with serialized preservation checked after reload. The helper and its meta were removed. No screenshots, playtest, or rendered visual approval performed; runtime binding and final visual QA remain outside this patch.

## Selected animation

`Avatar_Selected.anim` and `Avatar_Selected.controller` reside next to the prefab.
The clip binds `UnityEngine.UI.Image.m_Sprite` on SelectedOutline (not SpriteRenderer).
Loop order is 01 -> 02 -> 03 -> 01. **8 fps is an adjustable initial timing, not an artist-approved final timing.** Animator uses unscaled time.
Developer hookup: toggle `SelectedOutline.SetActive(isSelected)` and replace ClassBackground's Image.sprite from class data. No runtime mapping/selection logic has been added here. Selection restart/timing can be decided during integration.

## Validation boundary

The build method verifies imported sprite names/rects, counts/settings, saved prefab references, child order, BG coordinates, selected-off default, and samples each animation sprite in Unity. Pixel coverage is checked against the actual PNG alpha mask. This is asset/serialization validation, not rendered visual approval or battle integration testing; Nzib owns visual approval in Unity.
