using UnityEditor;
using UnityEngine;

/// <summary>
/// Locks the audio import invariants for everything under Assets/Audio/ so a sound-pack
/// drop can't regress them, the same way ArtImportRules does for sprites.
///
/// Audio is about to be this project's largest asset class — the landing-page theme alone
/// is 41 MB of WAV, five times the entire WebGL build — so the defaults matter more here
/// than the source files' bit depth ever will:
///
///  • Assets/Audio/Music/ — long cues. Streaming (never loaded whole into memory),
///    stereo preserved, decoded on a worker thread, not preloaded.
///  • Assets/Audio/ (everything else) — short SFX. Forced to mono (the board is not
///    meaningfully panned, so stereo is double the bytes for nothing), decompressed on
///    load so a hit sound costs no CPU at the moment it fires, and preloaded.
///
/// Both are Vorbis: WebGL has no hardware codec, and PCM/ADPCM would bloat the download.
/// Both are pinned to 48 kHz — the browser's AudioContext runs at the device rate, which
/// is 48 kHz nearly everywhere, and the existing theme is 48 kHz. Pinning it here means a
/// stray 44.1 kHz pack converts once at import instead of resampling on every playback.
///
/// Per-clip choices (quality tuning on a specific cue, ambisonic, looping) are left alone
/// — this only enforces the invariants.
/// </summary>
public class AudioImportRules : AssetPostprocessor
{
    private const string AudioRoot = "Assets/Audio/";
    private const string MusicRoot = "Assets/Audio/Music/";
    private const uint TargetSampleRate = 48000;

    // Vorbis quality is 0..1. SFX keep more detail (transients are the whole point of a
    // hit sound); music can afford less per-sample because it is streamed, not resident.
    private const float SfxQuality = 0.7f;
    private const float MusicQuality = 0.5f;

    void OnPreprocessAudio()
    {
        if (!assetPath.StartsWith(AudioRoot, System.StringComparison.OrdinalIgnoreCase)) return;
        if (assetImporter is not AudioImporter importer) return;

        bool isMusic = assetPath.StartsWith(MusicRoot, System.StringComparison.OrdinalIgnoreCase);

        var settings = importer.defaultSampleSettings;
        settings.compressionFormat = AudioCompressionFormat.Vorbis;
        settings.loadType = isMusic ? AudioClipLoadType.Streaming : AudioClipLoadType.DecompressOnLoad;
        settings.quality = isMusic ? MusicQuality : SfxQuality;
        settings.sampleRateSetting = AudioSampleRateSetting.OverrideSampleRate;
        settings.sampleRateOverride = TargetSampleRate;
        settings.preloadAudioData = !isMusic;
        importer.defaultSampleSettings = settings;

        importer.forceToMono = !isMusic;
        importer.loadInBackground = isMusic;
    }
}
