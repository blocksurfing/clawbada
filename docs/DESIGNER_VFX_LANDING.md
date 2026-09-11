# Landing the Special VFX in Unity — designer guide (updated 2026-09-11)

Everything the battle engine needs is already wired: the server triggers Specials
in playtests, Unity plays the class Special at the right frame, and every gameplay
moment has an empty VFX slot waiting for a prefab. Your job is to drop the art into
those slots. No code changes are needed for the standard delivery.

## 0. Where we are — three Specials are live

Maelstrom, Haunt and Inferno are integrated and playable on the deployed build. Every
drop so far needed **no** change to your workflow: sheets + clip + prefab, pushed to
`design/vfx-specials`, and we bind and time them.

| Slot | Bound | Still empty |
|---|---|---|
| `specialByClass` / `specialImpactByClass` | Tempest (Maelstrom), Specter (Haunt), Ember (Inferno) | Bulwark, Mantis, Leviathan, Sentinel, Reaver, Abyss, Kraken |
| `statusVisuals` | `haunt` (Specter's sigil) | `bleed`, `stun`, `slow`, `fortify`, `shield`, `reflect`, `taunt` |
| Generic moments | `attackImpact` (HitSpark), `moveStep` (StepDust) | `attackWindup`, `defend`, `death`, `status` |

`FX_Generic_ImpactDust`, `FX_Generic_GroundCrack` and `FX_Generic_Shockwave` exist in the
project but are not bound to anything — tell us where you want them and we will wire them,
or drop replacements into the empty generic slots.

Three things learned from the drops so far, worth knowing before the next one:

- **We read the committed clip, not the handoff note.** Inferno's note said 24 fps while
  `FX_Ember_Inferno.anim` was authored at 12; we followed the clip. If the two disagree,
  the clip wins.
- **A sheet's custom pivot only counts when its alignment is set to Custom.** The Maelstrom
  bolt had a tip pivot typed in but alignment left at Center, so Unity ignored it and we
  offset the bolt in code instead. Set alignment to Custom if you want to own the anchor.
- **Modular beats one fixed timeline** for anything that travels or persists — see the
  projectile and status-visual notes in section 3.

## 1. Branch — pull this first

The old `unity-setup` branch is **160 commits behind** and must not be used or merged
(it predates the tilemap grid, the in-canvas HUD and the live engine). A fresh branch
has been cut from `main` for you:

```bash
# save anything uncommitted you still want (exports, WIP scene edits)
git stash -u            # or copy the new files out of the project folder

git fetch origin
git checkout design/vfx-specials     # kept identical to main — last synced 2026-09-11
git pull                             # fast-forward; we push main here after every merge
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

`preset` picks the roster, `auto=1` lets the bot policy play your side so the battle runs
itself, and `speed=2` scales Unity's playback (any value 0.25–4). Both params carry through
"Start practice" to the battle page and can also be added to an existing `/battle/p_…` URL
and refreshed.

Rosters worth knowing: **`specials`** fields one Ember + one Tempest + one Specter, so every
finished Special shows up in a single battle (`specials_evolved` / `specials_apex` for the
other two arenas); `trio_<class>[_<tier>]` fields three of one class; `random_<tier>` rolls
three classes at random.

One thing that is deliberate and not a bug: **the hex grid is invisible until it is your
turn.** Between turns the board is painted arena art only, and the hexes appear for the
lobster that is about to act — its reachable cells, its own hex and its targets.

## 3c. Arena layers — what the engine now does to them

You author arenas as full-frame 640 × 360 layers in
`Assets/Art/Arenas/<Tier>/ArenaArt_<Tier>.prefab`. Two automatic rules apply to the
**Foreground** layers, so it is worth knowing how the engine reads them:

- **Decor is shrunk to 80 %** so the boards read less crowded. Each layer is scaled about
  the frame edge its painted content touches — a rock ledge along the bottom gets thinner
  and stays glued to the bottom, a clam at the left shrinks toward the left — and an axis
  whose content spans the whole canvas is left alone, so a full-width band never pulls in
  from the ends. That measurement comes from the layer's opaque pixels, not its canvas.
- **Only the bottom lip draws in front of the lobsters.** A layer whose content stops
  below 60 % of the frame height is treated as bottom-edge art and renders over the
  characters (a front-row lobster stands behind it). Anything taller is side art and
  renders behind them, so cliffs and rock columns no longer clip the outer columns.

Both rules read a small generated file. **After you add or repaint an arena layer, run
`Clawbada ▸ Arena ▸ Bake Decor Anchors`** (or just tell us and we will). An unbaked layer
is left at full size and drawn in front, which is the safe default for bottom-edge art but
wrong for anything tall.

Backdrop and ground (Background / Default sorting layers) are never scaled or re-sorted —
the hex board is aligned to them.

## 3d. HUD and UI art — the contract when you get to it

The action buttons, the gear and the glyphs currently in the build are **placeholder art we
generate procedurally**, so they are meant to be replaced. Two ways in, both no-code:

1. Drop PNGs over the generated ones in `Assets/Art/UI/` using the same names —
   `btn_attack`, `btn_special`, `btn_defend`, `btn_wait`, `btn_neutral`, `btn_gear`,
   `hex_glow`, `ic_attack`, `ic_special`, `ic_defend`, `ic_wait`, `ic_gear`, `ic_undo`.
   Plates are 96 × 110 (pointy-top hex), glyphs 64 × 64, `hex_glow` is the ring shown on the
   armed action.
2. Or assign your own sprites to the matching slots in `Assets/Resources/UI/HudSkin.asset`.

Don't run `Clawbada ▸ Generate HUD Button Art` after that — it overwrites the generated
names. Everything else in the HUD (cards, turn strip, bars, result banner) is built from
`HudSkin` too, so the same swap applies.

## 4. Automated playback for reviewing — two ways, no server needed

**In the editor (the quickest loop).** Open `Assets/Scenes/BattleScene.unity` and press Play.
`BattleDemoLoop` plays battle after battle on its own — moves, attacks, defends, deaths, and
**one Special per round from round 3** — so every slot fires within a minute and you can tune
`delay`, anchors and clip timing in the Inspector while it runs. It now drives the **same
per-turn playback the live game uses**, so a projectile Special really flies, a cinematic
Special owns its own timing, and per-target impacts and status marks appear exactly as they
will in a real battle. Knobs on the `BattleDemoLoop` component: `roundGap`, `battleGap`,
`maxRoundsPerBattle`, `tier` (which arena) and `randomObstacles`.

**In the browser (what the playtest actually runs).** Add `&auto=1` to a practice URL and the
battle plays itself — see section 3b — with `&speed=2` to run it faster.

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

For a **projectile** Special, deliver three pieces instead of one timeline — a spawn/format
one-shot, a looping travel prefab (no `OneShotVfx`), and an impact one-shot — and the runtime
decides how long the travel lasts from the caster→target distance. For a **persistent status**
mark, deliver spawn / loop / end and tell us which status it belongs to.

Visual spec per class (palettes, timing, enhanced variants): `docs/SPECIAL_MOVE_VFX_HANDOFF.md`.
