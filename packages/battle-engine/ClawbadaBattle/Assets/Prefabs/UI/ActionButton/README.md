# ActionButtonUI — combined art-authoring prefab

Open `Assets/Prefabs/UI/ActionButton/ActionButtonUI.prefab`. This is the ONE action authoring prefab: a root RectTransform with three ordinary child objects, **Attack**, **Special**, **Defend**. Each child owns an Animator and `Visual/Frame` + `Visual/Icon` Images. There are no nested visual prefabs, input handlers, Canvas, Wait button, or gameplay scripts.

## Layout and authoring

The layout follows the supplied artist screenshot: Special above-left of Attack; Defend left of Attack at approximately the same baseline. Special defaults to **Ambush**.

- Attack RectTransform: `(24, -22)`, original 96×96 source canvas.
- Special RectTransform: `(-10, 32)`, original 64×64 source canvas.
- Defend RectTransform: `(-40, -20)`, original 64×64 source canvas.
- Root: 192×192. Native source pixels and transparent margins are unchanged.
- Normal-frame opaque bounds are Attack 76×83 and shared frame 42×47. Accounting for their half-pixel canvas offsets, visual centers relative to Defend are Attack `(64, -1)` and Special `(30, 52)` in UI coordinates. This matches the reference to approximately one native source pixel; the JPEG is not an exact pixel-grid reference.

Select the relevant child Animator to preview **Normal**, **Hover**, **Pressed**, **Selected**. Attack uses `AttackVisual.controller`. Special uses `Ambush.overrideController`; assign any of the ten special override controllers to change identity. Defend uses `Defend.overrideController`. All overrides replace all four clips (both frame and icon), not only a static sprite. `SharedVisual.controller` is the reusable four-state base. State switching and input remain developer-owned; there are no automatic state transitions.

## Source fidelity

Source: `F:/Project/Blocksurfing/UI/Action.aseprite`.
SHA-256: `749ea6398978eb6b580ad07a6d1b5ac56d5acebe52d7714d96e87e0caba3fdcc`.

The source has six 100 ms frames: Normal 1, Hover 2, Pressed 3, Selected 4–6. Single-pose states hold their authored frame; Selected loops three frames at 10 fps. Existing 48 clips, controller mappings, 84 exported images and their metadata were reused without pixel/timing changes. No source file was overwritten. The latest source revision only collapsed the Icons layer group; fresh exports were pixel-identical.

Attack frame/claw source origin is `(8,128)` in the 96×96 canvas; shared frame source origin is `(8,8)` in the 64×64 canvas. Icons retain their common normal cel origin `(16,14)` and original per-frame offsets, including Haunt's pressed offset. No resizing, recoloring, invented art, or procedural animation.

## Special mappings

Fortify / Bulwark; Ambush / Mantis; Crush / Leviathan; **Maelstorm** / Tempest (literal source spelling retained; game move Maelstrom); Haunt / Specter; Rally / Sentinel; Rend / Reaver; Devour / Abyss; Bind / Kraken; Inferno / Ember. All ten have explicit override assets; Defend has its own override as well.

## Important developer handoff

The canonical prefab GUID `a5ba6b7a9652e084ea3f689d0f27b2b2` and root local fileID are preserved, so `Resources/UI/HudSkin.asset` still resolves its existing reference. However, **this is now a combined authoring cluster, not the former single-button runtime contract**. Existing ActionBar code instantiates that reference per action and expects root `Visual/Icon`; it has intentionally NOT been changed. Runtime/HUD integration must be adapted by the developer before using this replacement in gameplay. This is not a runtime-ready or integration-tested HUD replacement.

The old single-button clips/controller and redundant visual prefabs were retired only after reference audit and external backup. `Assets/Art/UI/ActionButton.png` and `ActionButton_Frame.png` remain unchanged because HudSkin still references them. The new art lives in `Assets/Art/UI/ActionButton/`. No ActionCluster directories remain under production Assets.

## Verification and recovery

External evidence/backup: `F:/Project/Blocksurfing/action-cluster-evidence/`.

- `cleanup-backup/`: exact pre-cleanup assets/metas and protected-file hash manifest, outside Assets.
- `cleanup-reference-audit.json`: consumers checked before deletion.
- `cleanup-build.log`, `cleanup-reopen.log`, `cleanup-unity-validation.txt`: isolated Unity 6000.4.2f1 import and persisted reopen; all 12 identities/four states, Animator state playback, no nested prefab dependencies, Ambush default.
- `cleanup-pixel-parity.json`: 72 individual renders + six combined renders exactly match source-pixel composites at nearest-neighbor 2×.
- `cluster_1.png` through `cluster_6.png`: actual Unity render previews in the new layout.
- `cleanup-final-audit.json`: installed byte parity, GUID/reference closure and protected-file checks.

The already-open production Editor was not opened concurrently by another process. Verification uses an isolated Unity project with exact production asset/meta copies. No gameplay C#, HudSkin, scenes, commits, or pushes were changed by this cleanup.
