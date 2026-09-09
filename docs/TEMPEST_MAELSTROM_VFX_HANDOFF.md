# Tempest — Maelstrom VFX handoff

## Direction

Tempest Maelstrom is a full-screen battlefield storm animation, not a tornado/vortex anchored to the enemy team.

The designer-owned Unity animation should be a layered prefab/clip. Dev can later attach/spawn it through battle runtime.

Visual sequence:

1. `CloudLeft` starts outside the left side of the screen and moves into screen center / point zero.
2. `CloudRight` starts outside the right side of the screen and moves into screen center / point zero.
3. `Leaves` starts after the cloud buildup and flies through the storm.
4. A cyan/white screen flash marks the AoE impact beat.
5. `Hit` plays as a small electric hit animation on each affected living enemy after the flash.

## Source assets

Unity folder:

```text
Assets/Art/FX/Attack/Tempest/
```

Files:

```text
FX_Tempest_Maelstrom_CloudLeft.png          # original horizontal source sheet
FX_Tempest_Maelstrom_CloudRight.png         # original horizontal source sheet
FX_Tempest_Maelstrom_Leaves.png             # original horizontal source sheet
FX_Tempest_Maelstrom_CloudLeft_Atlas.png    # Unity animation input atlas
FX_Tempest_Maelstrom_CloudRight_Atlas.png   # Unity animation input atlas
FX_Tempest_Maelstrom_Leaves_Atlas.png       # Unity animation input atlas
FX_Tempest_Maelstrom_Hit.png
FX_Tempest_Maelstrom_Flash.png
```

Source layer sheet specs:

```text
FX_Tempest_Maelstrom_CloudLeft.png   15360x360 = 24 frames @ 640x360
FX_Tempest_Maelstrom_CloudRight.png  15360x360 = 24 frames @ 640x360
FX_Tempest_Maelstrom_Leaves.png      15360x360 = 24 frames @ 640x360
```

Unity atlas specs:

```text
FX_Tempest_Maelstrom_CloudLeft_Atlas.png   3840x1440 = 24 frames packed 6x4 @ 640x360
FX_Tempest_Maelstrom_CloudRight_Atlas.png  3840x1440 = 24 frames packed 6x4 @ 640x360
FX_Tempest_Maelstrom_Leaves_Atlas.png      3840x1440 = 24 frames packed 6x4 @ 640x360
```

Hit sheet spec:

```text
FX_Tempest_Maelstrom_Hit.png         160x32 = 5 frames @ 32x32
```

Flash spec:

```text
FX_Tempest_Maelstrom_Flash.png       640x360 single sprite, cyan/white fullscreen flash overlay
```

## Unity animation asset

Designer/assistant builds the actual layered animation asset in Unity:

```text
Assets/Prefabs/VFX/FX_Tempest_Maelstrom.prefab
Assets/Prefabs/VFX/Clips/FX_Tempest_Maelstrom.anim
Assets/Prefabs/VFX/Clips/AC_FX_Tempest_Maelstrom.controller
```

Prefab child structure:

```text
FX_Tempest_Maelstrom
├── Cloud_Left
├── Cloud_Right
├── Leaves
├── Flash
├── Hit_A   # designer timing guide only
├── Hit_B   # designer timing guide only
└── Hit_C   # designer timing guide only
```

The `Hit_A/B/C` children are only to preview the intended hit beat inside the Unity animation. Final runtime should spawn the hit animation per actual affected enemy.

## Timing

Recommended clip timing:

```text
Total: ~8.0s @ 24fps

0.00s - 2.00s: Cloud_Left moves from off-screen left to center / point zero
0.00s - 2.00s: Cloud_Right moves from off-screen right to center / point zero
2.00s - 7.00s: storm hold; cloud sheets keep looping and Leaves starts/loops through the storm
7.00s - 7.30s: cyan/white lightning flash
7.25s - 7.55s: Hit.png 5-frame electric animation plays on enemy hit markers
7.45s - 8.00s: storm fades/dissipates
```

Important: the storm layers should not all start in parallel. The intended sequence is cloud entrance first, then 5-second storm hold with looping clouds/leaves, then flash, then enemy hit.

## Gameplay

```text
Class: Tempest
Special: Maelstrom
Target: all living enemies / AoE
Effect: all living enemies should receive damage/hit reaction on the flash/electric-hit beat
```

## Runtime integration request

Current `BattleVfxLibrary` anchors are actor/target based:

```text
ActorAttackFx
TargetImpactFx
ActorFeet
TargetFeet
```

Those anchors are not appropriate for the full-screen storm layer. The storm should not be attached to `ActorFeet` or `TargetFeet`.

Requested support:

```text
ScreenOverlay / CameraCenter / ArenaCenter placement for the full-screen storm layer
mirrorWithFacing = false
high sorting order, above arena/lobsters but not HUD unless intentionally desired
```

Electric hit behavior:

```text
Spawn FX_Tempest_Maelstrom_Hit.png as a 5-frame 32x32 animation per affected living enemy after the flash.
```

## Build helper

Optional editor-only builder:

```text
Assets/Scripts/Editor/TempestMaelstromVfxBuilder.cs
```

Unity menu:

```text
Clawbada > VFX > Build Tempest Maelstrom Animation Asset
```

This helper creates the layered prefab/clip/controller above. It intentionally does not bind `BattleVfxLibrary`, edit `BattleScene`, or change runtime battle scripts.
