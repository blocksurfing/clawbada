# Audio

Import settings are enforced by `Scripts/Editor/AudioImportRules.cs` — drop a file in the
right folder and it gets the right settings. Don't hand-tune the importer unless you mean
to deviate.

| Folder | Profile |
|---|---|
| `Audio/Music/` | Vorbis q0.5, **Streaming**, stereo kept, decoded on a worker thread, not preloaded — **but arena music does NOT live here**, see below |
| `Audio/SFX/` (and anything else under `Audio/`) | Vorbis q0.7, **Decompress On Load**, **forced to mono**, preloaded |

**Put long cues in `Music/`.** The split is by folder, not by duration, so a two-minute
ambience left in `SFX/` would be decompressed into memory whole.

## Source format

Work from **16-bit / 48 kHz**. The browser's AudioContext runs at the device rate (48 kHz
nearly everywhere) and Unity re-encodes to Vorbis on import, so 24/96 sources are
discarded twice before anyone hears them — keep those as an archive outside the repo if
you want re-master headroom. Everything is pinned to 48 kHz at import regardless, so a
44.1 kHz pack converts once here rather than resampling on every playback.

## SFX naming — the binder finds clips by filename

`Scripts/Editor/BattleSfxBinder.cs` (**Clawbada ▸ Audio ▸ Bind Battle SFX**, headless
`-executeMethod BattleSfxBinder.Bind`) fills `Resources/BattleSfxLibrary.asset` from these
paths. A misnamed file binds nothing and that sound is simply silent — no error.

| Sound | Path under `Assets/Audio/` |
|---|---|
| Basic attack, per class | `SFX/Attack/SFX_<Class>_Attack.wav` |
| Special cast, per class, optional per tier | `SFX/Special/SFX_<Class>_<Ability>[_<Tier>].wav` |
| Special impact (lands on the hit beat) | `SFX/Special/SFX_<Class>_<Ability>_Impact[_<Tier>].wav` |
| Special, alternate takes | `SFX/Special/SFX_<Class>_<Ability>_01.wav`, `_02`, … (and `_Impact_01`, …) — one picked at random each cast, for any tier without its own clip |
| Movement, one walk | `SFX/Move/SFX_Move_01.wav`, `SFX_Move_02.wav`, … — any number; one is picked at random per walk and looped for exactly as long as the lobster moves, so a take can be any length |
| Defend stance | `SFX/Defend/SFX_Defend_01.wav`, `SFX_Defend_02.wav`, … (or a single `SFX_Defend.wav`) — shared by every class, one picked at random per Defend; drop `SFX/Defend/SFX_<Class>_Defend.wav` to give a class its own |
| Death | `SFX/Death/SFX_Death_01.wav`, `SFX_Death_02.wav`, … (or a single `SFX_Death.wav`) — shared by every class, one picked at random as a lobster goes down; drop `SFX/Death/SFX_<Class>_Death.wav` to give a class its own |
| In-game UI opening / closing | `SFX/UI/SFX_UI_Open.wav`, `SFX/UI/SFX_UI_Close.wav` — the options menu and its confirm step today; every future in-game panel uses the same pair |

`<Class>` = Bulwark Mantis Leviathan Tempest Specter Sentinel Reaver Abyss Kraken Ember ·
`<Ability>` = Fortify Ambush Crush Maelstrom Haunt Rally Rend Devour Bind Inferno ·
`<Tier>` = Evolved Elite Apex. Re-run the bind after every drop.

## How a Special's sounds line up with its animation

The binder measures each file's loudest 50 ms (its "hit") and the engine times the picture to
it, so the files are authored freely and the game adapts:

- **Swing Specials (Bind, Ambush, Crush, Rend):** one cast file — the engine delays the swing so
  the contact frame lands on the cast file's hit (Bind's takes: hit at 1.00 s / 0.70 s). With a
  separate `_Impact` file (Ambush) the two play **back to back**: the impact starts the instant the
  cast ends, its hit is the contact frame, and the lunge is held until then (a cast shorter than
  the swing's own contact starts late instead).
- **Inferno (projectile):** two files that play **back to back** — `SFX_Ember_Inferno.wav`
  (charge-up + travel) then `SFX_Ember_Inferno_Impact.wav` (the burst). The impact file starts
  the instant the cast file ends, and the engine fits the fireball's flight so the explosion
  frame lands on the impact file's hit. The picture cannot explode earlier than **2.37 s** after
  the cast begins (1.83 s charge-up animation + 0.12 s shortest flight + 0.42 s until the burst
  sprite pops), so a cast file shorter than that starts late by the difference (a 2.0 s cast
  starts 0.32 s into the charge-up) rather than leaving silence before the hit. Casts up to
  ~3.0 s stretch the flight instead. Either file may be a numbered take set.
- **Cinematic Specials (Maelstrom, Fortify, Devour):** the cast file starts with the effect; the
  impact file is started early by its own hit offset so the hit lands on the effect's beat
  (Maelstrom's lightning at 3.9 s).

## Budget

The WebGL build is ~8 MB today. The landing-page theme is 41 MB as WAV. Audio will
dominate the download unless music streams and SFX are mono — which is what these rules
enforce. Check the build size after any large drop.

## Arena music is outside the Unity bundle

Battle music is played by **React** through an HTML5 `<audio>` element (like the landing-page
theme), not by Unity. Masters go in `audio-masters/music/BGM_Arena_<Tier>.wav` at the repo root
(gitignored); `bun scripts/build-music.ts` encodes them to content-hashed AAC under
`apps/web/public/audio/music/` and regenerates `apps/web/src/lib/arena-music.generated.ts`.
Why: the bundle stays ~2.4 MB, only the arena you enter is downloaded, it streams within a
second, and it's cached for a year independently of Unity rebuilds. Dropping a music file
in this Unity folder would put it back in the bundle — don't.
