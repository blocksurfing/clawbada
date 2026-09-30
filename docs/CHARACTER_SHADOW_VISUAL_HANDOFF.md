# Character shadow visual handoff

Unity paths below are relative to `packages/battle-engine/ClawbadaBattle`.

## Art-side delivery

- Source: external `VFX/Shadow/Character_Shadow.png`, copied unchanged.
- Sprite: `Assets/Art/Characters/Shared/Character_Shadow.png`.
- Reusable prefab: `Assets/Prefabs/Lobsters/Shared/Character_Shadow.prefab`.
- One connected authoring instance: `Assets/Scenes/Rigging/Rig_Apex_Master.unity` > `Bulwark/Character_Shadow`.
- Direct class-root child at `(0, -0.125, 0)`, unit scale, identity local rotation. Raised 2px at 64 PPU from the initial static foot baseline placement at Y=-0.15625, per artist request. Final visual approval remains with the artist. Existing body/root transforms and animation clips are unchanged.
- Single sprite, 64x32, 64 PPU, centered pivot, Point filtering, no mipmaps, uncompressed, input alpha. White renderer tint with alpha 1 preserves the exported semitransparency.

## Layering

Approved target: ground/base hex grid < character shadow < gameplay hex highlights; all character/VFX rendering above shadow.

For the authoring reference, SpriteRenderer and SortingGroup use `Default`, order `-9`. `SortingGroup.sortAtRoot=true` prevents a containing actor SortingGroup from pulling the shadow into its row band. The authoring guide uses `Default:-10`; canonical body parts and all audited VFX prefab renderers/groups are above the shadow.

**Runtime integration is not complete.** `HexGrid` paints default cells and selection/range/enemy/ally highlights into the same `boardTilemap` (`BattleScene`, `Default:5`). Both currently render above this shadow. A shadow-only sorting change cannot satisfy base < shadow < highlight: developers must separate base and highlight rendering before rollout. No runtime scripts, battle scene, or runtime lobster prefabs were changed in this delivery.

`ActiveMarker` uses Foreground at its actor row minus one; `GroundVfx` lifts ground VFX to Foreground:90; actors use Foreground row bands starting at 100. These are above the shadow's independent Default group. Preserve the all-VFX-above-shadow rule for future effects too.

Before runtime attachment, review shadow inclusion in child-renderer blink/dim/corpse operations, Afterimage cloning and visual bounds aggregation. Keep ground anchoring separate from airborne body motion. These are developer integration tasks, not implemented behavior.

## Verification and scope

- Unity API save/reopen verified connected prefab instance, sprite reference, transform, import settings, pivot and sorting isolation.
- Resolved prefab audit covered 16 canonical rig renderers, 57 VFX renderers and 8 VFX SortingGroups above the shadow.
- Independent structural comparison verified all existing scene nodes unchanged except the Bulwark transform gaining one child. Elite/Evolved scenes were unchanged.
- Source PNG and destination bytes match. All 16 preexisting dirty meta files were preserved byte-for-byte; temporary helper removed.
- Placement is Bulwark only, not an all-class/tier rollout. No screenshots or playtests; artist owns visual QA.
