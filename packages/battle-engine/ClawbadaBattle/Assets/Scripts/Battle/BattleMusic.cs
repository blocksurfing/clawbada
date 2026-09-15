using System.Collections;
using UnityEngine;

/// <summary>
/// Looping arena music. One AudioSource, separate from BattleSfx's one-shot source so the
/// bed sits at its own gain under the effects. Started when the arena tier is known at
/// battle init, faded out when the battle ends.
///
/// Track lookup, in order:
///   1. the bound library — Assets/Audio/Music/BGM_Arena[_&lt;Tier&gt;].wav (licensed, committed)
///   2. a PLACEHOLDER — Resources/Placeholders/BGM_Arena[_&lt;Tier&gt;] under Assets/Audio/Music/
/// Placeholders are gitignored and BuildScript refuses to ship them without
/// -allowPlaceholderAudio; they exist so candidate tracks can be auditioned locally
/// without entering git, LFS or a production bundle until one is chosen (a 3-minute WAV
/// is ~30 MB in LFS history per candidate). The same locks cover unlicensed material. Binding one logs a warning on
/// every battle so it cannot be mistaken for the real thing.
/// </summary>
public static class BattleMusic
{
    /// <summary>Bed gain — well under BattleSfx's 0.5 so hits read over the music.</summary>
    private const float Gain = 0.35f;
    private const float FadeInSeconds = 1.5f;
    private const float FadeOutSeconds = 2.0f;

    private static AudioSource source;
    private static BattleSfxRunner runner;
    private static Coroutine fade;

    /// <summary>Arena tier as BattleInitData carries it ("evolved" / "elite" / "apex", any case).</summary>
    public static void PlayArena(string tierName)
    {
        int tier = string.Equals(tierName, "apex", System.StringComparison.OrdinalIgnoreCase) ? 3
                 : string.Equals(tierName, "elite", System.StringComparison.OrdinalIgnoreCase) ? 2
                 : 1;
        PlayArena(tier);
    }

    public static void PlayArena(int tier)
    {
        if (!Application.isPlaying) return;
        string tierName = LobsterPrefabLibrary.TierName(tier);
        AudioClip clip = BattleSfx.LibraryOrNull?.ArenaMusicFor(tier);
        bool placeholder = false;
        if (clip == null)
        {
            clip = Resources.Load<AudioClip>($"Placeholders/BGM_Arena_{tierName}")
                ?? Resources.Load<AudioClip>("Placeholders/BGM_Arena");
            placeholder = clip != null;
        }
        if (clip == null)
        {
            Debug.Log($"[BattleMusic] no arena track for {tierName} — silent");
            return;
        }
        if (placeholder)
            Debug.LogWarning($"[BattleMusic] AUDITION track '{clip.name}' for {tierName} — from Resources/Placeholders, not committed. " +
                             "Gitignored; BuildWebGL refuses to ship it without -allowPlaceholderAudio. Promote it to Audio/Music/ to keep it.");

        Ensure();
        if (source.clip == clip && source.isPlaying) return;
        source.clip = clip;
        source.loop = true;
        source.volume = 0f;
        source.Play();
        StartFade(Gain, FadeInSeconds, stopAfter: false);
        Debug.Log($"[BattleMusic] {clip.name} ({tierName}) loop {clip.length:F1}s → fade to {Gain:F2} over {FadeInSeconds:F1}s");
    }

    public static void Stop()
    {
        if (source == null || !source.isPlaying) return;
        Debug.Log($"[BattleMusic] fade out over {FadeOutSeconds:F1}s");
        StartFade(0f, FadeOutSeconds, stopAfter: true);
    }

    private static void StartFade(float target, float seconds, bool stopAfter)
    {
        if (fade != null) runner.StopCoroutine(fade);
        fade = runner.StartCoroutine(Fade(target, seconds, stopAfter));
    }

    private static IEnumerator Fade(float target, float seconds, bool stopAfter)
    {
        float from = source.volume, t = 0f;
        while (t < seconds)
        {
            t += Time.deltaTime;
            source.volume = Mathf.Lerp(from, target, Mathf.Clamp01(t / seconds));
            yield return null;
        }
        source.volume = target;
        if (stopAfter) source.Stop();
        fade = null;
    }

    private static void Ensure()
    {
        if (source != null) return;
        var go = new GameObject("BattleMusic") { hideFlags = HideFlags.HideAndDontSave };
        Object.DontDestroyOnLoad(go);
        source = go.AddComponent<AudioSource>();
        source.playOnAwake = false;
        source.spatialBlend = 0f;
        runner = go.AddComponent<BattleSfxRunner>();
    }
}
