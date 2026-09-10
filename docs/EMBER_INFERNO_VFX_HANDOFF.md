# Ember — Inferno VFX handoff

## Status

Designer-side Unity VFX assets are prepared for Ember's Special, **Inferno**.

Inferno should be treated as a **single-target projectile special**, not an AoE/full-screen effect like Tempest Maelstrom.

## Visual sequence

```text
caster forms/spawns Inferno
→ fireball/projectile travels toward the selected target
→ projectile reaches target
→ out/impact explosion triggers immediately on arrival
```

The current Unity clip is a fixed-timeline preview/handoff asset that combines those beats into one one-shot VFX:

```text
Spawn → TravelLoop cycles → Impact/Out
```

## Added Unity assets

Sprite sheets:

```text
Assets/Art/FX/Attack/Ember/FX_Ember_Inferno_Spawn.png
Assets/Art/FX/Attack/Ember/FX_Ember_Inferno_TravelLoop.png
Assets/Art/FX/Attack/Ember/FX_Ember_Inferno_Impact.png
```

Prefab / clip / controller:

```text
Assets/Prefabs/VFX/FX_Ember_Inferno.prefab
Assets/Prefabs/VFX/Clips/FX_Ember_Inferno.anim
Assets/Prefabs/VFX/Clips/AC_FX_Ember_Inferno.controller
```

## Clip composition

```text
FX_Ember_Inferno.anim
sample rate: 24 fps
duration: ~2.08s
loop: false
sprite keys: 50
```

Composition:

```text
Spawn sheet:       23 frames
TravelLoop sheet:  5 frames × 3 cycles
Impact/Out sheet:  12 frames
```

The source sheets themselves are sliced as 128×128 frames:

```text
Spawn:       2944×128 = 23 frames
TravelLoop:   640×128 = 5 frames
Impact/Out:  1536×128 = 12 frames
```

## Suggested runtime interpretation

For the current designer handoff, `FX_Ember_Inferno.prefab` can be treated as a single one-shot Special VFX candidate.

For final gameplay integration, Inferno ideally behaves as a projectile lifecycle:

```text
1. Spawn/form the Inferno at the caster / ActorAttackFx.
2. Move the projectile from caster to target using runtime positions.
3. Keep the travel/fireball visual alive while travelling.
4. Trigger the Impact/Out explosion when the projectile reaches the target.
5. Apply damage on arrival / first explosion beat.
```

If runtime keeps using one `specialByClass` prefab slot only, this asset can be bound as:

```text
BattleVfxLibrary.specialByClass[9] = FX_Ember_Inferno
anchor = ActorAttackFx
mirrorWithFacing = true
impactAt ≈ when the Impact/Out section begins
```

Ember class index is `9`.

## Self-damage note

Inferno's gameplay includes caster self-damage. The current pass does **not** add a separate caster self-damage VFX hook or modify gameplay scripts.

If dev wants a distinct caster burn/self-hit visual, it likely needs either:

```text
- a class-specific runtime hook for Inferno self-damage, or
- a dedicated caster-side Special impact slot
```

No `Assets/Scripts/**`, battle runtime, web, API, or `BattleVfxLibrary.asset` changes were made in this pass.
