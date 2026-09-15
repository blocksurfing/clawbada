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
