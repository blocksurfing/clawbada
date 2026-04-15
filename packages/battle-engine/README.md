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

Build output goes to the web app so React can load it:

1. File → Build Settings → select **Web** platform
2. Player Settings:
   - Compression Format: **Brotli**
   - Data Caching: **Enabled**
   - Memory Size: **256MB**
3. Build to: `../../apps/web/public/unity-build/`

Expected output files:
```
apps/web/public/unity-build/Build/
├── battle.loader.js
├── battle.data.br
├── battle.framework.js.br
└── battle.wasm.br
```

The React app is already wired up to load these files via `react-unity-webgl`.

### How Communication Works

**React → Unity** (game state pushed in):
React calls `SendMessage("BattleBridge", "MethodName", jsonString)`. The BattleBridge script receives it and drives BattleManager/HexGrid.

| Method | When | What It Does |
|--------|------|-------------|
| `InitBattle` | Match starts | Sets up arena, spawns lobsters, shows badges |
| `StartPhase` | Each phase begins | Switches to positioning or combat mode |
| `UpdateTimer` | Every second | Updates countdown |
| `PlayRound` | After both reveals | Triggers movement + combat animations |
| `BattleEnd` | Match over | Shows victory/defeat |

**Unity → React** (player input sent out):
Unity calls JS functions via `JSBridge.jslib` → `window.__clawbada.*`

| Callback | When | What It Sends |
|----------|------|--------------|
| `onPositioningCommit` | Player locks in movement | Destination hex per lobster |
| `onCombatCommit` | Player locks in actions | Attack/Defend/Special per lobster + targets |
| `onUnityReady` | Scene loaded | (nothing — just a signal) |
| `onAnimationComplete` | Round animation done | Round number |

### Key Specs

- **Grid**: 6×5 pointy-top offset hexes, ~20% blocked
- **Movement ranges**: 1 hex (Bulwark, Leviathan), 2 hex (Sentinel, Abyss, Kraken, Reaver), 3 hex (Mantis, Tempest, Specter, Ember)
- **Attack distance scaling**: adjacent 100%, 2 hex 75%, 3 hex 50%, 4+ miss
- **Phase timing**: 60 seconds per phase, proceeds when both players commit
- **Hex highlight colors**: stone = in range (movement in phase 1, attack max range in phase 2), blue = selected character, red = enemy target, green = ally target (heal/buff)

### Designer Workflow

1. Open the project in Unity
2. Work on arena art, hex tile sprites, lobster animations, VFX
3. Test in Unity Editor (BattleBridge logs to console instead of calling JS in editor mode)
4. When ready to test in the web app: Build → Web → output to the path above
5. The web app loads the build automatically on the battle page
