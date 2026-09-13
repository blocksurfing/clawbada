using UnityEngine;

/// <summary>
/// One-line playback for battle sounds: BattleSfx.PlayAttack(classId) at the moment the
/// hit lands. Owns a single 2D AudioSource created on first use, so nothing has to be
/// wired into the scene or carried through BattleManager.
///
/// Headroom matters more than it looks. Sound-pack files are mastered to 0 dBFS, and an
/// ATB battle overlaps hits freely — six lobsters, bleed ticks, counters — so playing them
/// at unity gain sums past full scale and clips. Volume sits at <see cref="Headroom"/> to
/// leave room for that. If overlap still clips once more sound classes land, the fix is an
/// AudioMixer group with a limiter, not quieter files: re-rendering the source loses the
/// pack's own mastering and has to be redone for every future drop.
///
/// WebGL note: browsers refuse audio until the page has seen a user gesture. Starting a
/// battle requires clicks, so by the first attack the context is unlocked — but a sound
/// fired before any interaction would be silently dropped by the browser, not by this.
/// </summary>
public static class BattleSfx
{
    /// <summary>Playback gain for every battle SFX. ~-6 dB, room for roughly four overlapping hits.</summary>
    private const float Headroom = 0.5f;

    private static BattleSfxLibrary library;
    private static AudioSource source;
    private static bool libraryMissingLogged;

    public static void PlayAttack(int classId) => Play(Library?.AttackFor(classId));

    private static BattleSfxLibrary Library
    {
        get
        {
            if (library != null) return library;
            library = Resources.Load<BattleSfxLibrary>("BattleSfxLibrary");
            if (library == null && !libraryMissingLogged)
            {
                libraryMissingLogged = true;
                Debug.LogWarning("[BattleSfx] No Resources/BattleSfxLibrary.asset — battle audio is silent. " +
                                 "Run Clawbada ▸ Audio ▸ Bind Battle SFX.");
            }
            return library;
        }
    }

    private static void Play(AudioClip clip)
    {
        if (clip == null || !Application.isPlaying) return;
        if (source == null)
        {
            var go = new GameObject("BattleSfx") { hideFlags = HideFlags.HideAndDontSave };
            Object.DontDestroyOnLoad(go);
            source = go.AddComponent<AudioSource>();
            source.playOnAwake = false;
            source.spatialBlend = 0f; // 2D: the board is small and not meaningfully panned
        }
        source.PlayOneShot(clip, Headroom);
        Debug.Log($"[BattleSfx] {clip.name} @ {Headroom:F2}");
    }
}
