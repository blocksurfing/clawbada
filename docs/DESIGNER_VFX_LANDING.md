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
per-target impacts wait for it; 0 = the caster's swing timing) and **`hideChildrenPrefix`**
(children such as `Hit_A/B/C` timing guides are disabled at spawn).

`CameraCenter` is for full-screen layers (Maelstrom's storm): the prefab is placed at the
camera centre — a 10 × 5.625 unit sprite fills the frame exactly — never mirrored, and sorted
above the arena's front decor and every lobster (the HUD stays on top). Per-target hit effects
go in **`specialImpactByClass[classId]`**: spawned on every enemy the Special damages, at the
impact beat (falls back to the generic `attackImpact`).

Worked example — Tempest Maelstrom (`Clawbada ▸ VFX ▸ Bind Tempest Maelstrom` does this):
`specialByClass[3]` = `FX_Tempest_Maelstrom` (CameraCenter, impactAt 3.9 s = the lightning
flash, hide `Hit_`), `specialImpactByClass[3]` = `FX_Tempest_Maelstrom_Hit` (TargetImpactFx).
The turn holds until the storm is nearly done; the web watchdog allows 12 s per turn. Effects spawn in world
space, sorted just above their owner, so rig mirroring and corpse tints never distort
them. The Elite/Apex "enhanced" versions of a Special can be a second prefab later;
for this drop one prefab per class is the target.

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
