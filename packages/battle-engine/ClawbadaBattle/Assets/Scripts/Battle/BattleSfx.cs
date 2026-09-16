using System.Collections;
using UnityEngine;

/// <summary>
/// One-line playback for battle sounds. Owns a single 2D AudioSource created on first use,
/// so nothing has to be wired into the scene or carried through BattleManager.
///
/// Attacks fire on the contact frame. Specials have two phases: the cast clip starts with
/// the windup, and the impact clip is scheduled against the hit beat so that its loudest
/// moment — the crack of the strike — lands ON the beat rather than after it. The lead
/// for that comes from the library (measured from the file by the binder).
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

    /// <summary>Site-wide SFX preference, pushed from React via BattleBridge.SetAudioPrefs. Off = every Play is a no-op.</summary>
    public static bool Enabled = true;

    private static BattleSfxLibrary library;
    private static AudioSource source;
    private static BattleSfxRunner runner;
    private static bool libraryMissingLogged;

    public static void PlayAttack(int classId) => Play(Library?.AttackFor(classId), "attack");

    /// <summary>One hex step of movement — a random pick from the bound set (see BattleSfxLibrary.move).</summary>
    public static void PlayMove() => Play(Library?.RandomMove(), "move");

    /// <summary>Cast phase — fires with the windup and underscores the whole sequence.</summary>
    public static void PlaySpecial(int classId, int tier) => Play(Library?.SpecialCastFor(classId, tier), "cast");

    /// <summary>Impact phase, right now. For the plain branch, where the beat is the swing's own contact frame.</summary>
    public static void PlaySpecialImpact(int classId, int tier) => Play(Library?.SpecialImpactFor(classId, tier), "impact");

    /// <summary>
    /// Impact phase against a beat that is <paramref name="secondsUntilBeat"/> away: starts
    /// `impactLead` seconds early so the clip's loudest moment coincides with the hit. Waits in
    /// scaled time, the same clock the battle timeline runs on, so ?speed=N keeps them aligned.
    /// </summary>
    public static void PlaySpecialImpactIn(int classId, int tier, float secondsUntilBeat)
    {
        var lib = Library;
        if (!Enabled || lib == null || !Application.isPlaying) return;
        var clip = lib.SpecialImpactFor(classId, tier);
        if (clip == null) return;
        float lead = lib.SpecialImpactLead(classId);
        float delay = Mathf.Max(0f, secondsUntilBeat - lead);
        Debug.Log($"[BattleSfx] {clip.name} (impact) scheduled: beat in {secondsUntilBeat:F2}s, lead {lead:F2}s → starts in {delay:F2}s");
        EnsureSource();
        runner.StartCoroutine(PlayAfter(clip, delay));
    }

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

    private static void Play(AudioClip clip, string phase)
    {
        if (!Enabled || clip == null || !Application.isPlaying) return;
        EnsureSource();
        source.PlayOneShot(clip, Headroom);
        Debug.Log($"[BattleSfx] {clip.name} ({phase}) @ {Headroom:F2}");
    }

    private static IEnumerator PlayAfter(AudioClip clip, float delay)
    {
        if (delay > 0f) yield return new WaitForSeconds(delay);
        Play(clip, "impact");
    }

    private static void EnsureSource()
    {
        if (source != null) return;
        var go = new GameObject("BattleSfx") { hideFlags = HideFlags.HideAndDontSave };
        Object.DontDestroyOnLoad(go);
        source = go.AddComponent<AudioSource>();
        source.playOnAwake = false;
        source.spatialBlend = 0f; // 2D: the board is small and not meaningfully panned
        runner = go.AddComponent<BattleSfxRunner>();
    }
}

/// <summary>Coroutine host for BattleSfx's scheduled plays. Lives on the hidden BattleSfx object.</summary>
internal class BattleSfxRunner : MonoBehaviour { }
