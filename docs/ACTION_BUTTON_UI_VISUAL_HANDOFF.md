# ActionButtonUI visual asset handoff

## Scope

`Assets/Prefabs/UI/ActionButton/ActionButtonUI.prefab` is a universal, visual-only uGUI prefab, 48 x 48 UI units. A Visual child wraps Frame (behind) and Icon (in front). The layout root stays fixed. Pressed moves Visual to anchoredPosition (0,-1): one native design pixel downward for both parts. Normal and Selected restore (0,0). Canvas/parent scaling also scales this design-pixel displacement. Attack is only the example/default icon; swap Icon/Image.sprite for the action. No Button component, pointer handlers, hit testing, selection ownership or battle integration is added. Both Images have raycastTarget=false. Battle scenes and gameplay scripts are unchanged. After syncing upstream, HudSkin.actionFrame and NzibHudBinder were minimally updated to resolve the new normal frame sprite; new prefab input/state integration remains out of scope.

## Icons and reference preservation

`Assets/Art/UI/ActionButton.png`: updated source sheet is 624 x 48; thirteen 48 x 48 cells left-to-right:
Attack, Defend, Wait, Bulwark/Fortify, Mantis/Ambush, Leviathan/Crush, Tempest/Maelstrom, Specter/Haunt, Sentinel/Rally, Reaver/Rend, Abyss/Devour, Kraken/Bind, Ember/Inferno.

Existing `ActionButton_<Action>` / `ActionButton_<Class>_<Special>` names, texture GUID, sprite IDs and all thirteen Unity local fileIDs are preserved. The old `ActionButton_Frame` slice was removed from the icon sheet; a pre-migration Assets reference audit found no serialized references to that texture GUID outside its own metadata. The normal frame is now a new subasset of ActionButton_Frame.png. The subsequent upstream sync introduced a HudSkin.actionFrame reference and NzibHudBinder lookup for that old slice. Both were migrated to ActionButton_Frame.png / ActionButton_Frame_Normal and verified in Unity. Other external/name-based consumers must likewise use the new frame path/name.

## Frame sheet / state contract

`Assets/Art/UI/ActionButton_Frame.png`: 192 x 48; four 48 x 48 cells left-to-right:

1. `ActionButton_Frame_Normal`
2. `ActionButton_Frame_Selected_01` (also the static Pressed sprite)
3. `ActionButton_Frame_Selected_02`
4. `ActionButton_Frame_Selected_03`

Frames are complete replacements, not outline overlays. All sheets: Point filtering, uncompressed, no mipmaps, Full Rect, centered pivots, 64 PPU.

The ActionButtonUI root has Animator with `ActionButton_Visual.controller`:

- `Normal` (default): grid 1, static.
- `Pressed`: grid 2, static while held.
- `Selected`: grid 2 -> 3 -> 4 -> repeat. Provisional 8 fps; adjust to artist preference.

The controller deliberately has no automatic transitions or input wiring. The developer owns the action selection state, and can call the root Animator.Play("Normal", 0, 0), Play("Pressed", 0, 0), or Play("Selected", 0, 0) from the appropriate input/gameplay handlers. Release only selects when the action is accepted; cancelled/outside release must not automatically select. Animator uses unscaled time. Do not let a second Button SpriteSwap/Animator simultaneously drive Frame/Image.sprite.

## Artist preview

Open ActionButtonUI.prefab, select the ActionButtonUI root, then open Window > Animation > Animation. Choose ActionButton_Normal / ActionButton_Pressed / ActionButton_Selected from the clip dropdown and use Preview/Play. No click transitions will occur by themselves; this is a visual handoff, not wired gameplay. Change Icon's Source Image to review other actions.

## Verification

Unity successfully imported 13 icons + 4 frame sprites. The import routine compared old/new texture GUID and all thirteen icon local fileIDs. Saved prefab was loaded back; child order, native sizes, positions, default sprites and controller states were checked. Pressed displacement of both Frame and Icon, root immobility, and return to zero offset in Normal/Selected were sampled and verified in Unity. Animation bindings target Visual/Frame for Image.m_Sprite and Visual for RectTransform.m_AnchoredPosition; no root transform curves. Normal, Pressed, all three Selected samples, and return to Normal passed via AnimationClip.SampleAnimation. Selected loop enabled. No rendered visual approval or battle playtest was performed. Source PNG hashes verified against imported PNGs. Temporary editor helper removed after verification.
