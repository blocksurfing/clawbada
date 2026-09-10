# Landing the Special VFX in Unity — designer guide (2026-09-06)

Everything the battle engine needs is already wired: the server triggers Specials
in playtests, Unity plays the class Special at the right frame, and every gameplay
moment has an empty VFX slot waiting for a prefab. Your job is to drop the art into
those slots. No code changes are needed for the standard delivery.

## 1. Branch — pull this first

The old `unity-setup` branch is **160 commits behind** and must not be used or merged
(it predates the tilemap grid, the in-canvas HUD and the live engine). A fresh branch
has been cut from `main` for you:

```bash
# save anything uncommitted you still want (exports, WIP scene edits)
git stash -u            # or copy the new files out of the project folder

git fetch origin
git checkout design/vfx-specials     # == main as of 2026-09-06 (7d8e700)
git lfs pull                         # PNGs inside packages/battle-engine are Git LFS
```

Open `packages/battle-engine/ClawbadaBattle` in Unity **6000.4.2f1**. The first open
rebuilds `Library/` (a few minutes). Then `git stash pop` / copy your exports back in.

Push to `design/vfx-specials` as often as you like. When a batch is ready, open a PR
to `main`; we run the headless smoke tests + WebGL build and merge. Small PRs (a few
classes at a time) land faster than one giant drop.

## 2. Where things go

| What | Path |
|---|---|
| Sprite sheets / frames | `Assets/Art/FX/<Moment>/<Class>/` — `Attack/<Class>/` already has a folder per class; `Death`, `Defense`, `Movement`, `Status` hold the `_Generic` sets |
| Animation clips + controllers | `Assets/Prefabs/VFX/Clips/` (`FX_<Class>_<Special>.anim`, `AC_FX_<Class>_<Special>.controller`) |
| Effect prefabs | `Assets/Prefabs/VFX/FX_<Class>_<Special>.prefab` |
| **The binding** | `Assets/Prefabs/VFX/BattleVfxLibrary.asset` — drag each prefab into its slot |

An effect prefab is just: **SpriteRenderer + Animator (one-shot clip) + `OneShotVfx`**.
`OneShotVfx` measures the clip and destroys the object when it ends — same setup as the
existing `FX_Generic_*` prefabs; copy one of those as a template. Import settings for
`Art/` are enforced automatically (Sprite, PPU 64, Point, no compression).

## 3. The slots (BattleVfxLibrary.asset)

| Slot | Fires | Default anchor |
|---|---|---|
| `attackWindup` | attacker starts a basic attack | attacker's `AttackFX` transform |
| `attackImpact` | contact frame of every damaging hit | target's `ImpactFX` transform |
| `specialByClass[0..9]` | class Special windup — 0 Bulwark, 1 Mantis, 2 Leviathan, 3 Tempest, 4 Specter, 5 Sentinel, 6 Reaver, 7 Abyss, 8 Kraken, 9 Ember | attacker's `AttackFX` (falls back to `attackWindup` when empty) |
| `defend` | lobster takes the Defense stance | actor feet |
| `death` | death animation starts | actor feet |
| `moveStep` | every hex hop while moving | actor feet |
| `status` | heal / buff / debuff lands | target feet |

Each slot has `anchor` (ActorAttackFx / TargetImpactFx / ActorFeet / TargetFeet /
**CameraCenter**), `delay` (seconds after the moment), `mirrorWithFacing`, and for Specials
**`impactAt`** (seconds after the effect starts when the hit beat lands — damage, hit reads and
per-target impacts wait for it; 0 = the caster's swing timing), **`hideChildrenPrefix`**
(children such as `Hit_A/B/C` timing guides are disabled at spawn) and **`onTop`** (sort the
effect above full-screen layers and front decor — per-target hits that must read over a storm).

**Projectile Specials** (Ember Inferno first) add four fields to the windup slot:
`travelPrefab` (a *looping* prefab — the fireball), `travelSpeed` (world units per second;
hex centres are ~1.73 units apart), `launchAt` (seconds into the windup when the projectile
leaves the caster, ≈ the formation clip's length) and `impactLead` (seconds after arrival
when the hit beat lands — the burst frame of the impact effect). The runtime plays the windup
at the caster's `AttackFX`, then flies `travelPrefab` from there to the target's `ImpactFX` at
`travelSpeed` — so the travel loop lasts exactly as long as the caster→target distance, whether
the target is adjacent (~0.25 s) or four hexes away (~1 s). The sheet is authored flying right;
the runtime mirrors it for leftward shots and pitches it along the path. On arrival the
`specialImpactByClass` effect spawns on the target and damage lands `impactLead` later.
Author projectile Specials as **three sheets** (formation / travel loop / impact) rather
than one fixed timeline: the runtime owns how long the middle part lasts.

**Status visuals** (Specter Haunt's sigil first) are persistent marks tied to an engine status
(`haunt`, `bleed`, `stun`, `slow`, `fortify`, `shield`…). `BattleVfxLibrary.statusVisuals` maps a
status to three prefabs: `spawn` (one-shot when it lands), `loop` (**no OneShotVfx**; shown while
the status is active) and `end` (one-shot when it expires or is cleansed). The runtime parents
the loop under the lobster, so it follows hex moves and mirrors with facing, and drops it on
death. Reconnects rebuild loops from the snapshot without the spawn animation.

**Depth of a status visual is the prefab's own business, and the sorting LAYER matters more than
the order.** The rig's body parts live on the **Default** layer at orders 0–15, all inside one
SortingGroup, and inside a group the layer is compared before the order — so a child on
Foreground draws in front of the body no matter how negative its order is. Author status prefabs
on **Default**: order below 0 puts the art under the body (Haunt's sigil is −5, a curse mark on
the ground), order above 15 puts it over (an overhead mark). The runtime no longer rewrites the
layer, so what you set in the prefab is what you get.

`CameraCenter` is for full-screen layers (Maelstrom's storm): the prefab is placed at the
camera centre — a 10 × 5.625 unit sprite fills the frame exactly — never mirrored, and sorted
above the arena's front decor and every lobster (the HUD stays on top). Per-target hit effects
go in **`specialImpactByClass[classId]`**: spawned on every enemy the Special damages, at the
impact beat (falls back to the generic `attackImpact`).

Worked example — Tempest Maelstrom (`Clawbada ▸ VFX ▸ Bind Tempest Maelstrom` does this):
`specialByClass[3]` = `FX_Tempest_Maelstrom` (CameraCenter, impactAt 3.9 s = the lightning
flash, hide `Hit_`), `specialImpactByClass[3]` = `FX_Tempest_Maelstrom_Strike` (TargetImpactFx,
onTop) — a composite the binder builds from the designer's `FX_Tempest_Maelstrom_LightningBolt`
(5 frames, 48 × 304; the binder offsets it so the tip lands on the target and the bolt rises
above — set the sheet's pivot to Custom/bottom if you want to author that yourself) plus the
electric sparks on the body. Drop a new bolt or hit sheet and re-run the binder; nothing else changes.
The turn holds until the storm is nearly done; the web watchdog allows 12 s per turn.

Worked example — Ember Inferno (`Clawbada ▸ VFX ▸ Bind Ember Inferno`): the binder slices the
designer's three 128 × 128 sheets into `FX_Ember_Inferno_Spawn` (23 frames, one-shot),
`FX_Ember_Inferno_Travel` (5 frames, loop) and `FX_Ember_Inferno_Impact` (12 frames, one-shot)
at 12 fps, then binds `specialByClass[9]` = Spawn (ActorAttackFx, mirrored, `travelPrefab` =
Travel, `travelSpeed` 7 u/s, `launchAt` 1.83 s = the strip's last frame, `impactLead` 0.42 s =
the burst on impact frame 5) and `specialImpactByClass[9]` = Impact (TargetImpactFx, onTop).
Ember's self-damage plays as the generic impact + hit read on the caster right after the burst.

Worked example — Specter Haunt (`Clawbada ▸ VFX ▸ Bind Specter Haunt`): modular drop, no
umbrella prefab. Spirit = projectile slot: `specialByClass[4]` = `FX_Specter_Haunt_SpiritSpawn`
(ActorAttackFx, mirrored, `travelPrefab` = `FX_Specter_Haunt_SpiritTravel`, 5.5 u/s, `launchAt`
0.5 s = the last spawn frame, `impactLead` 0.08 s), `specialImpactByClass[4]` =
`FX_Specter_Haunt_PossessImpact` (TargetImpactFx). Sigil = status visual `haunt`: SigilSpawn →
SigilIdle (loop, sortingOrder −5 = under the body) → SigilOut on expiry/cleanse.

Effects spawn in world
space, sorted just above their owner, so rig mirroring and corpse tints never distort
them. The Elite/Apex "enhanced" versions of a Special can be a second prefab later;
for this drop one prefab per class is the target.

## 3b. Review a Special in the browser without playing

On a build with practice presets enabled, open

```
/game/battle?preset=trio_specter&auto=1&speed=2
```

`preset` picks the trio (`trio_<class>[_<tier>]` or `random_<tier>`), `auto=1` lets the bot
policy play your side so the battle runs itself, and `speed=2` scales Unity's playback (any
value 0.25–4). Both params carry through "Start practice" to the battle page and can also be
added to an existing `/battle/p_…` URL and refreshed.

## 4. Preview without the server

Open `Assets/Scenes/BattleScene.unity` and press Play. `BattleDemoLoop` runs a fake
battle: attacks, defends, deaths, and **one Special per round from round 3**, so every
slot fires within a minute. Tune `delay` and anchors live in the Inspector.

## 5. Please don't touch (or tell us first)

- `Assets/Scenes/BattleScene.unity` — the scene carries engine wiring; scene diffs are
  the one thing we cannot merge safely. Scene mood / lighting / colour shifts belong in
  the arena prefabs (`Assets/Art/Arenas/<Tier>/ArenaArt_<Tier>.prefab`) or in the
  effect prefabs themselves. If a look needs a scene-level change, message us and we
  add a hook.
- `Assets/Scripts/**` — engine code. If an effect needs a new trigger (e.g. a
  class-specific hit read, or a colour shift on the target), describe it and we add the
  slot.
- `Assets/Resources/UI/HudSkin.asset` — HUD art lives here; a separate hand-off.

## 6. Checklist per Special

- [ ] Sheet in `Art/FX/Attack/<Class>/`, clip + controller in `Prefabs/VFX/Clips/`
- [ ] Prefab `FX_<Class>_<Special>` with SpriteRenderer + Animator + `OneShotVfx`
- [ ] Dragged into `BattleVfxLibrary.asset` → `specialByClass[classId]`
- [ ] Looks right in Play mode (`BattleDemoLoop`), both facings
- [ ] `git push origin design/vfx-specials` (LFS uploads the PNGs automatically)

Visual spec per class (palettes, timing, enhanced variants): `docs/SPECIAL_MOVE_VFX_HANDOFF.md`.
