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

1. Open the project in Unity
2. Work on arena art, hex tile sprites, lobster animations, VFX
3. Test in Unity Editor (BattleBridge logs to console instead of calling JS in editor mode)
4. When ready to test in the web app: Build → Web → output to the path above
5. The web app loads the build automatically on the battle page
