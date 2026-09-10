# Specter — Haunt VFX handoff

## Status

Designer-side Unity VFX assets are prepared for Specter's Special, **Haunt**.

Haunt is a **single-target visual sequence**, not an AoE/full-screen effect.

This pass includes **runtime-ready modular pieces only**. No umbrella/preview `FX_Specter_Haunt` prefab is included, to avoid confusion with final binding.

Runtime should compose the pieces because **Sigil** and **Spirit** do different jobs:

```text
Sigil = target-anchored visual marker
Spirit = caster -> travel -> target projectile/possession visual
```

## Source sheets imported

```text
Assets/Art/FX/Attack/Specter/FX_Specter_Haunt_SigilSpawn.png
Assets/Art/FX/Attack/Specter/FX_Specter_Haunt_SigilIdle.png
Assets/Art/FX/Attack/Specter/FX_Specter_Haunt_SigilOut.png
Assets/Art/FX/Attack/Specter/FX_Specter_Haunt_SpiritSpawn.png
Assets/Art/FX/Attack/Specter/FX_Specter_Haunt_SpiritTravelLoop.png
Assets/Art/FX/Attack/Specter/FX_Specter_Haunt_PossessImpact.png
```

## Correct slicing

```text
SigilSpawn:        5 frames, 96x64, 12 fps
SigilIdle:         4 frames, 96x64, 12 fps, loop
SigilOut:          5 frames, 96x64, 12 fps
SpiritSpawn:       7 frames, 64x48, 12 fps
SpiritTravelLoop:  4 frames, 64x48, 12 fps, loop
PossessImpact:     6 frames, 64x48, 12 fps
```

## Runtime-ready modular pieces

```text
Assets/Prefabs/VFX/FX_Specter_Haunt_SigilSpawn.prefab
Assets/Prefabs/VFX/FX_Specter_Haunt_SigilIdle.prefab
Assets/Prefabs/VFX/FX_Specter_Haunt_SigilOut.prefab
Assets/Prefabs/VFX/FX_Specter_Haunt_SpiritSpawn.prefab
Assets/Prefabs/VFX/FX_Specter_Haunt_SpiritTravel.prefab
Assets/Prefabs/VFX/FX_Specter_Haunt_PossessImpact.prefab
```

Recommended runtime interpretation:

```text
SigilSpawn:     target anchored to the marked lobster, curse/sigil mark appears; render below character
SigilIdle:      target anchored to the marked lobster, loop while the sigil visual should remain active; follows target when it moves; render below character
SigilOut:       target anchored to the marked lobster, play when the sigil visual should disappear; render below character
SpiritSpawn:    caster anchored, ghost detaches
SpiritTravel:   moving projectile/travel loop, caster -> target; runtime controls lifetime/distance
PossessImpact:  target anchored, possession/impact visual beat
```

Looping pieces intentionally do **not** include `OneShotVfx`:

```text
FX_Specter_Haunt_SigilIdle
FX_Specter_Haunt_SpiritTravel
```

Runtime should stop/destroy those loops when their lifecycle ends.

## Layering / follow behavior

```text
Sigil pieces should be attached to the marked target, not fixed to the original hex/world position.
If the target moves hex, SigilIdle should follow the target until the sigil visual is stopped/removed.
Sigil render layer/order should stay below the target character so it reads as a floor/under-body curse mark, not an overlay covering the lobster.
Current sigil prefab SpriteRenderer sortingOrder: -5.
Spirit pieces stay over/above character as projectile/possession VFX.
```

## Visual binding notes

```text
Class index: 4
Class: Specter
Special visual: Haunt
Targeting shape: single target visual
Layering: mixed — Spirit over, Sigil below character
```

No scripts, BattleVfxLibrary asset, or runtime binder changes were made in this designer-side visual pass.
