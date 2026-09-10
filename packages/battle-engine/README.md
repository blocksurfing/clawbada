# Clawbada Battle Engine — Unity Project

## Getting Started

The Unity project is at `packages/battle-engine/ClawbadaBattle/`. Open it in Unity Hub (Unity 6.4 / 6000.4.2f1 with Web Build Support).

### First Open
1. Unity Hub → Open → navigate to `packages/battle-engine/ClawbadaBattle/`
2. Unity will import assets and compile scripts on first open
3. Create a new Scene: `Assets/Scenes/BattleScene.unity`
4. Add an empty GameObject named **"BattleBridge"** — attach `BattleBridge.cs`
5. Add an empty GameObject named **"HexGrid"** — attach `HexGrid.cs`
6. Add an empty GameObject named **"BattleManager"** — attach `BattleManager.cs`

### What's Already Built

**Scripts** (all compile and ready):
- `Scripts/Bridge/BattleBridge.cs` — React <-> Unity communication. Receives game state from React, sends player input back. All JSON data classes are defined here.
- `Scripts/Bridge/JSBridge.jslib` (in `Plugins/WebGL/`) — JavaScript interop layer for WebGL builds
- `Scripts/Grid/HexGrid.cs` — Stores arena layout metadata and spawns HexTile overlays on demand for the current selection state (LKR-style — no persistent grid of tiles)
- `Scripts/Grid/HexTile.cs` — Individual hex tile overlay with 4 highlight states (stone = in range, blue = selected character, red = enemy target, green = ally target). Spawned by HexGrid.ShowSelection; fades out on ClearHighlights.
- `Scripts/Grid/HexCoord.cs` — Hex math utilities (offset <-> cube coordinates, distance calculation, neighbor finding, range queries)
- `Scripts/Battle/BattleManager.cs` — Battle state machine (positioning/combat phases, round management, timer)

**Asset directories** (empty, ready for art):
- `Art/Arenas/{Evolved,Elite,Apex}/` — per-tier arena backgrounds
- `Art/Characters/` — lobster sprite sheets (10 classes × tiers)
- `Art/HexTiles/` — hex tile sprites (playable, blocked, highlight variants)
- `Art/Obstacles/` — blocked hex terrain (rocks, coral, lava)
- `Art/UI/` — HUD elements, buttons, badges
- `Prefabs/Lobsters/` — per-class lobster prefabs
- `Prefabs/VFX/` — particle system prefabs per class Special
- `Audio/Music/` — per-tier battle music
- `Audio/SFX/` — hit sounds, movement, specials

### WebGL Build

Build output goes to the web app so React can load it. The folder is **gitignored**
(a 30–60 MB binary); build locally and deploy with the Vercel CLI (`apps/web/.vercelignore`
lets the artifact upload).

Headless (recommended):

```bash
/Applications/Unity/Hub/Editor/6000.4.2f1/Unity.app/Contents/MacOS/Unity \
  -batchmode -nographics -quit \
  -projectPath packages/battle-engine/ClawbadaBattle \
  -executeMethod BuildScript.BuildWebGL \
  -logFile /tmp/clawbada-webgl.log
```

`BuildScript.BuildWebGL` (Assets/Scripts/Editor/BuildScript.cs; also **Clawbada → Build WebGL**
in the editor menu) sets Brotli compression with the decompression fallback, data caching,
256 MB initial memory, and writes to `../../../apps/web/public/unity-build` (relative to the
Unity project folder). Unity names the artifacts after the folder; with the decompression
fallback on, compressed files carry the `.unityweb` suffix and need no server headers:

```
apps/web/public/unity-build/Build/
├── unity-build.loader.js
├── unity-build.data.unityweb
├── unity-build.framework.js.unityweb
└── unity-build.wasm.unityweb
```

The web app loads these via `react-unity-webgl` (`apps/web/src/components/battle/BattleStage.tsx`)
and falls back to a plain SVG board when the loader is missing, so playtesting never blocks on a build.

### How Communication Works (V3 — one lobster per turn)

**React → Unity** (authoritative state pushed in; Unity only renders):
React calls `SendMessage("BattleBridge", "MethodName", jsonString)`. The BattleBridge script
receives it and drives BattleManager/HexGrid. TypeScript twin of every payload:
`apps/web/src/components/battle/unity-bridge.ts`.

| Method | When | What It Does |
|--------|------|-------------|
| `InitBattle` | Snapshot received | Builds the board from `arena` (blocked hexes come from the server), spawns both teams (DNA part swap via `partClassIds`) |
| `StartTurn` | Server `turn_started` (after the previous animation) | Faces the acting lobster; `deadlineMs`, `isPlayer` for cues |
| `PlayTurn` | Server `turn_resolved` | Animates the path, the action with every damage/heal event at the impact frame, then deaths; ends with `onTurnAnimationComplete` |
| `UpdateBar` | With each `StartTurn` | Upcoming turn order (the HUD strip itself is React) |
| `SyncUnits` | After `InitBattle` and after each animated turn | Server truth for every unit (hp, alive, charge, defending, statuses, cell) — feeds the in-canvas HUD |
| `SetSelection` | On every change of the player's selection | Action-bar state: armed action, legality, hint; a non-player turn hides the bar |
| `PreviewMove` | When the player picks / undoes a move cell | Slide the acting lobster to the cell (or back); PlayTurn reconciles with the server's path |
| `SetClock` | Optional | Remaining shot-clock ms for a visual pulse |
| `BattleEnd` | Server `battle_ended` | Defeat read for the losing side (`winner` may be `"draw"`) |
| `ShowSelection` / `ClearHighlights` | Player is choosing | Atomic highlight state (origin > enemy > ally > range) |

**Unity → React** (clicks out, via `JSBridge.jslib` → `window.__clawbada.*`):

| Callback | When | What It Sends |
|----------|------|--------------|
| `onUnityReady` | Scene loaded | (signal) |
| `onLobsterSelected` | Click on a living lobster's hex | `{ lobsterId }` |
| `onHexClicked` | Click on an empty hex | `{ col, row }` |
| `onTurnAnimationComplete` | PlayTurn finished | `{ turn }` |

React decides what a click means (move destination, attack target, ally target), repaints
highlights, and submits the turn to the server. `PlayRound` / `onAnimationComplete` remain
only for the in-editor `BattleDemoLoop`.

### Key Specs

- **Grid**: 6×5 pointy-top offset hexes, 5–6 blocked hexes placed by the server from the battle's VRF seed
- **Movement ranges**: 1 hex (Bulwark, Leviathan), 2 hex (Sentinel, Abyss, Kraken, Reaver), 3 hex (Mantis, Tempest, Specter, Ember)
- **Attack distance scaling**: adjacent 100%, 2 hex 75%, 3 hex 50%, 4+ miss (Specter: 4 hexes at 40%)
- **Turn timing**: 60-second shot clock per lobster turn; auto-Defend on expiry; three in a row forfeits
- **Hex highlight colors**: stone = movement range, blue = selected lobster, red = enemy target, green = ally target

### Designer Workflow

Special VFX drop (2026-09): see `docs/DESIGNER_VFX_LANDING.md` — branch `design/vfx-specials`
(cut from `main`), folders, `BattleVfxLibrary.asset` slots, Play-mode preview, do-not-touch list.


1. Open the project in Unity
2. Work on arena art, hex tile sprites, lobster animations, VFX
3. Test in Unity Editor (BattleBridge logs to console instead of calling JS in editor mode)
4. When ready to test in the web app: Build → Web → output to the path above
5. The web app loads the build automatically on the battle page

### In-canvas HUD (Assets/Scripts/UI)

The battle HUD is drawn inside the Unity canvas (Legends-of-Kingdom-Rush style) and
built entirely in code at runtime by `BattleHud`, attached from `BattleManager.Awake`
when `Assets/Resources/UI/HudSkin.asset` exists — no scene or prefab wiring:

- `TurnStrip` (top): the acting lobster first, then the next turns from `UpdateBar`,
  as LOKR-style character cards (`CardView`): bevelled frame, team-coloured header
  band, the portrait composited from each lobster's Carapace/Antennae/Eyes sprites
  (`LobsterPartLibrary`), and a segmented HP bar inside the card. The active card is
  scaled up, rimmed gold and carries a pennant.
- `UnitOverlay` (per lobster, follows the rig): HP bar, charge pips, defend shield,
  status icons, KO skull, gold ring on the active unit. `ActiveMarker` draws the
  animated `hex_selector` under the actor in world space.
- `ActivePanel` (bottom-left, 176×108): card, name, tier/team, HP numbers, pips — sized to
  stay clear of the board's bottom-left cell. The shot clock (`BattleHud.Clock`, counts
  down from `SetClock`) lives in its own bottom-right box, above the React fullscreen
  button in the corner.
- `DamageFloat`, `ResultBanner`, `BadgeView` (Human/Agent/Bot per team).
- `ActionBar` (bottom-centre): Attack / Special / Defend / Wait + Undo. Presses reach React
  via `onActionSelected {action}` / `onUndoMove`; React validates and submits on tap
  (LOKR-style: tap an enemy to attack, tap a hex to move first, Undo to return).

Art: `Clawbada/Generate HUD Placeholder Art` writes placeholder sprites to
`Assets/Art/UI` (hex frames, card frame/header, pennant, bevelled hex button, HP
segments, icons, badges) and seeds `HudSkin` (only empty slots — designer swaps
survive). Verify headlessly with `-executeMethod HudSmokeTest.Run` (no `-nographics`).
The editor demo loop feeds the same signals, so the HUD shows in play mode too.

Click mapping: the board is authored tilted 30° about X while units, highlights and the
pointer ray live on the flattened z = 0 plane, so `HexGrid.WorldToHex` maps a click to
the nearest visible cell centre (not `Tilemap.WorldToCell`, which drifts by a row away
from the pivot). `-executeMethod HexInputSmokeTest.Run` round-trips every cell of a 6×5
board on all three tiers. Range highlights are tinted per kind (teal reachable, coral
enemy, green ally, gold actor) so they stand out on the dark Apex arena.

Animation timing (2026-09-08): `BattleManager.attackDuration` / `hitDuration` are floors —
`LobsterController.PlayAttack` and `PlayHit` stretch to the rig's own clip length
(`ClipLength("Attack")` / `"Hit"`), so a 1.5 s Mantis swing or Evolved's 1.0 s hit read is
never cut off; the impact frame lands at `AttackImpactFraction` (0.5) of the swing.

Playtest tunables (2026-09-06): `HexGrid.obstacleScale` (0.8 — obstacles 20 % smaller),
`BattleManager.decorScale` (keep 1 — the decor layers are full-frame sprites, so scaling
them about the centre floats rocks/shells off the arena edge; shrinking decoration needs
separate edge-anchored sprites from the designer). Cards: `HudSkin.cardSize` 54×64,
`activePortrait` 72; team tags are compact bands with no letter tile. Evolved `Idle`
state speed 0.75 in `AC_Evolved.controller`. Death: `LobsterController.PlayDeath` plays
`Die` once, then `FreezeAsCorpse` holds the last frame with the Animator disabled (dead
lobsters never move) and tints to `CorpseTint` (near-black, ~26 % alpha). A death that
arrives only via `SyncUnits` (turn not animated locally) runs the same routine. The Elite
`Die.anim` no longer loops.

Cinematic Specials (2026-09-09, Tempest Maelstrom first): a Special slot with `impactAt > 0`
owns the turn's timing — `BattleManager` plays the caster's swing, waits for the effect's
impact beat, then applies damage / hit reads / `specialImpactByClass` per-target effects, and
holds until the effect is nearly done (`BattleVfxLibrary.ClipLength`). `AnchorPoint.CameraCenter`
places full-screen layers at the camera centre above arena + lobsters; `hideChildrenPrefix`
disables designer timing-guide children. `MaelstromVfxBinder` builds the electric-hit prefab
and binds the library. Web animation watchdog: 12 s.

Projectile Specials (2026-09-10, Ember Inferno first): a Special slot with a `travelPrefab` is a
projectile — `BattleManager` faces the caster at its target, spawns the formation windup at the
caster's `AttackFX` while the cast swing plays, waits `launchAt`, then `BattleVfxLibrary.Fly`
moves the looping travel prefab from the windup's position to the target's `ImpactFX` at
`travelSpeed` (the loop runs for exactly the flight time — distance / speed — mirrored for
leftward shots and pitched along the path, sorted above the board). On arrival the per-target
impact spawns and damage / hit reads land `impactLead` later (the burst frame). `VfxSlot.onTop`
sorts per-target impacts above full-screen layers (the Maelstrom hit was drawn behind the storm's
dim overlay). `InfernoVfxBinder` builds the three prefabs from the designer's sheets at 12 fps
(`BindAll` also re-runs the Maelstrom binder). Windups now spawn after the caster turns to face
its target, so a mirrored windup faces the right way.

Maelstrom strike (2026-09-10): the designer's `FX_Tempest_Maelstrom_LightningBolt` (pivot at the
tip) is combined with the electric hit into `FX_Tempest_Maelstrom_Strike` — a root with
`OneShotVfx` (fallback lifetime = longest child clip) and two nested prefab instances, sparks
sorted above the bolt — bound as `specialImpactByClass[3]` with `onTop`, so every struck enemy
takes a bolt from above at the flash.

Status visuals (2026-09-10, Specter Haunt first): `BattleVfxLibrary.statusVisuals` binds an
engine status type to spawn / loop / end prefabs. `LobsterController.SetStatus` shows the spawn
one-shot then parents the loop under the rig (follows hex moves, mirrors with facing, sorted by
the prefab's own `sortingOrder` inside the rig's SortingGroup — Haunt's sigil is −5, under the
body) and plays the end one-shot when the status is removed (expiry at the target's turn or a
cleanse — both arrive as `applied:false` status events); `ApplySync` reconciles loops from
snapshots without the spawn animation; death clears them. Haunt's spirit reuses the projectile
slot (`HauntVfxBinder`; `InfernoVfxBinder.BindAll` runs every binder).

Reconnects (2026-09-08): the WS auth expires every 5 min and the client reconnects with a fresh
snapshot. `BattleStage` sends `InitBattle` once per battle and hands later snapshots of the same
battle to Unity as `SyncUnits` — re-initialising mid-battle respawned every rig (dead lobsters
came back as coloured idle rigs) and reset the HUD. Belt and braces on the Unity side: a lobster
spawned already dead is frozen as a corpse in `Setup`, `ApplySync` plays the death whenever the
death visuals have not run yet, and overlays whose rig was despawned are hidden.

Fullscreen: the React stage (`BattleStage`) offers a Full-screen toggle (bottom-right of the
canvas); the stage element goes fullscreen and the canvas stays 16:9, letterboxed.

Board on demand (2026-09-10, LOKR-style): the hex grid is invisible at rest. `HexGrid` no longer
pre-paints the plain tile on every open cell and `ClearHighlights` clears cells instead of
restoring it, so between turns the arena reads as painted ground and hexes appear only while a
selection is on screen — which React already scopes to the player's own actionable turn
(`highlights = canAct ? selection.highlights : null`). Clicks are unaffected: `HexInput` maps a
world point through `Tilemap.WorldToCell`, which is grid maths and needs no tile present. Set
`HexGrid.showBoardAtRest` in the Inspector to get the full grid back while authoring a layout.

HUD pass (2026-09-10): the action bar has painted plates instead of one shared bevel —
`HudButtonArt` (menu *Clawbada ▸ Generate HUD Button Art*, headless `-executeMethod
HudButtonArt.Generate`) rasterises six bevelled hex plates, an armed glow ring and six shaded
glyphs from polygon/SDF geometry at 4x and box-downsamples them, so `HudSkin.btn*` / `hexGlow` /
`icon*` are anti-aliased art rather than 1-bit stencils. `ActionBar` picks the plate per action
and shows the glow ring for the armed action (tinting a coloured plate just muddied it).
`OptionsMenu` adds the gear in the top-right corner with the in-battle forfeit (confirmed in the
canvas, then `BattleBridge.NotifyForfeit` → `window.__clawbada.onForfeit` → React calls
`POST /api/game/combat/:id/forfeit`); it is built for participants only and hidden once the
result banner shows. The `TEAM A · YOU` / `TEAM B` corner badges are gone — facing, the move
prompt and the active-lobster card already say whose turn it is, and the corner is now the gear's.
Status visuals keep the sorting layer the designer authored (see DESIGNER_VFX_LANDING): forcing
them onto Foreground put Haunt's sigil in front of the body.

Review tools (2026-09-10): `BattleBridge.SetSpeed({speed})` sets `Time.timeScale` (0.25–4) so a
designer can watch Specials faster or slower; the web sends it after `InitBattle` when the battle
URL carries `?speed=`. `?auto=1` on the web makes the balanced bot policy play the wallet's own
turns (client-side, same policy as the server bot) so a practice battle runs itself. Both carry
through `/game/battle?preset=…` → "Start practice". The in-canvas clock is unaffected (React
sends the remaining ms).
