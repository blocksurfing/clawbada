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

    /// <summary>Site-wide SFX preference, pushed from React via BattleBridge.SetAudioPrefs. Off = every Play is a
    /// no-op, and a movement loop already playing stops.</summary>
    public static bool Enabled
    {
        get => enabled;
        set { enabled = value; if (!value && moveSource != null && moveSource.isPlaying) moveSource.Stop(); }
    }
    private static bool enabled = true;

    private static BattleSfxLibrary library;
    private static AudioSource source;
    /// <summary>Dedicated, looping: a walk is ONE sound that lasts exactly as long as the walk (see StartMove).</summary>
    private static AudioSource moveSource;
    private static Coroutine moveFade;
    private static float moveStartedAt;
    private static BattleSfxRunner runner;
    private static bool libraryMissingLogged;

    public static void PlayAttack(int classId) => Play(Library?.AttackFor(classId), "attack");

    /// <summary>
    /// The lobster starts walking: a random clip from the bound set, looped, until <see cref="StopMove"/>.
    /// One sound per walk rather than one per hop — the takes (1.9 s) are longer than a hop (0.7 s), and
    /// stacking one per hop spilled well past the moment the lobster stopped, on short walks and long.
    /// </summary>
    public static void StartMove()
    {
        var lib = Library;
        if (!Enabled || lib == null || !Application.isPlaying) return;
        var clip = lib.RandomMove();
        if (clip == null) return;
        EnsureSource();
        if (moveFade != null) { runner.StopCoroutine(moveFade); moveFade = null; }
        moveSource.clip = clip;
        moveSource.volume = Headroom;
        moveSource.loop = true;
        moveSource.Play();
        moveStartedAt = Time.unscaledTime;
        Debug.Log($"[BattleSfx] {clip.name} (move) start @ {Headroom:F2}");
    }

    /// <summary>The walk ended: a few frames of fade so the cut isn't a click, then stop.</summary>
    public static void StopMove()
    {
        if (moveSource == null || !moveSource.isPlaying || runner == null) return;
        if (moveFade != null) runner.StopCoroutine(moveFade);
        moveFade = runner.StartCoroutine(FadeOutMove(0.12f));
    }

    private static IEnumerator FadeOutMove(float seconds)
    {
        string name = moveSource.clip != null ? moveSource.clip.name : "?";
        float played = Time.unscaledTime - moveStartedAt;
        float v0 = moveSource.volume;
        float t = 0f;
        while (t < seconds && moveSource.isPlaying)
        {
            t += Time.unscaledDeltaTime;
            moveSource.volume = Mathf.Lerp(v0, 0f, t / seconds);
            yield return null;
        }
        moveSource.Stop();
        moveSource.volume = Headroom;
        moveFade = null;
        Debug.Log($"[BattleSfx] {name} (move) stop after {played:F2}s");
    }

    /// <summary>Defend stance, on the read. Per-class clip when bound, else the shared one.</summary>
    public static void PlayDefend(int classId) => Play(Library?.DefendFor(classId), "defend");

    /// <summary>A lobster going down, on the death read. Per-class clip when bound, else a random pick from the pool.</summary>
    public static void PlayDeath(int classId) => Play(Library?.DeathFor(classId), "death");

    /// <summary>An in-game panel opening (options menu, confirm step) / closing. Same two clips for every panel.</summary>
    public static void PlayUiOpen() => Play(Library?.uiOpen, "ui-open");
    /// <summary>Battle-start intro beats (optional clips).</summary>
    public static void PlayIntroReady() => Play(Library?.introReady, "intro-ready");
    public static void PlayIntroFight() => Play(Library?.introFight, "intro-fight");
    public static void PlayUiClose() => Play(Library?.uiClose, "ui-close");

    /// <summary>Cast phase — fires with the windup and underscores the whole sequence. Returns the beat inside the
    /// chosen clip (seconds; 0 when none or unmeasured) so a plain Special can time its contact frame to it.</summary>
    public static float PlaySpecial(int classId, int tier)
    {
        var slot = Library?.SpecialSlot(classId);
        float beat = 0f;
        var clip = slot?.cast?.Pick(tier, out beat);
        Play(clip, "cast");
        return clip != null ? beat : 0f;
    }

    /// <summary>Choose the cast clip for a Special without playing it — for a branch that must know the clip's
    /// length before it starts (the projectile fits its flight to the audio). Play it with <see cref="PlayCast"/>.
    /// Returns null (length 0) when no cast clip is bound.</summary>
    public static AudioClip PeekSpecialCast(int classId, int tier, out float beat, out float length)
    {
        beat = 0f; length = 0f;
        var slot = Library?.SpecialSlot(classId);
        var clip = slot?.cast?.Pick(tier, out beat);
        if (clip == null) { beat = 0f; return null; }
        length = clip.length;
        return clip;
    }

    /// <summary>Play a cast clip from <see cref="PeekSpecialCast"/>, <paramref name="delay"/> seconds from now (scaled time).</summary>
    public static void PlayCast(AudioClip clip, float delay = 0f)
    {
        if (clip == null) return;
        if (delay <= 0.01f) { Play(clip, "cast"); return; }
        if (!Enabled || !Application.isPlaying) return;
        EnsureSource();
        runner.StartCoroutine(PlayAfter(clip, delay, "cast"));
    }

    /// <summary>True when a Special impact clip is bound for this class/tier.</summary>
    public static bool HasSpecialImpact(int classId, int tier) => Library?.SpecialImpactFor(classId, tier) != null;

    // The impact take chosen for the Special being cast. Numbered takes crack at different points
    // (Crush: 0.19 s vs 0.04 s in), so the take is picked ONCE, up front — the timing (SpecialImpactHit)
    // and the playback (PlaySpecialImpact / PlaySpecialImpactIn) then agree on the same file.
    private static int chosenClass = -1;
    private static AudioClip chosenImpact;
    private static float chosenHit;

    /// <summary>Pick this cast's impact take (random among numbered takes) and remember it with its own hit time.</summary>
    public static void ChooseSpecialImpact(int classId, int tier)
    {
        chosenClass = -1; chosenImpact = null; chosenHit = 0f;
        var slot = Library?.SpecialSlot(classId);
        if (slot?.impact == null) return;
        var clip = slot.impact.Pick(tier, out float beat);
        if (clip == null) return;
        chosenClass = classId; chosenImpact = clip;
        // A numbered take's measured hit may be exactly 0 (Fortify _02 cracks on its first frame): trust it, don't
        // mistake it for "unmeasured" and borrow take _01's.
        var t = slot.impact;
        bool measuredTake = t.variants != null && t.variantBeats != null && t.variantBeats.Length == t.variants.Length
                            && System.Array.IndexOf(t.variants, clip) >= 0;
        chosenHit = measuredTake || beat > 0f ? beat : slot.impactLead;
        Debug.Log($"[BattleSfx] impact take {clip.name} (hit {chosenHit:F2}s in)");
    }

    private static AudioClip ImpactClip(int classId, int tier, out float hit)
    {
        if (chosenClass == classId && chosenImpact != null) { hit = chosenHit; return chosenImpact; }
        hit = Library?.SpecialImpactLead(classId) ?? 0f;
        return Library?.SpecialImpactFor(classId, tier);
    }

    /// <summary>The class's impact lands near the end of its cast clip, not on the effect's beat (Fortify).</summary>
    public static bool ImpactAtCastEnd(int classId) => Library?.SpecialSlot(classId)?.impactAtCastEnd ?? false;

    /// <summary>Seconds into this cast's impact take where its hit sits (the binder's measured loudest moment).</summary>
    public static float SpecialImpactHit(int classId) => chosenClass == classId && chosenImpact != null ? chosenHit : Library?.SpecialImpactLead(classId) ?? 0f;

    /// <summary>True when a heal clip is bound for this class's Special.</summary>
    public static bool HasSpecialHeal(int classId, int tier) => Library?.SpecialHealFor(classId, tier) != null;

    /// <summary>The Special's restorative, as HP is actually restored (Devour's heal at the end of the soul-suck).</summary>
    public static void PlaySpecialHeal(int classId, int tier) => Play(Library?.SpecialHealFor(classId, tier), "heal");

    /// <summary>Impact phase, right now. For the plain branch, where the beat is the swing's own contact frame.</summary>
    public static void PlaySpecialImpact(int classId, int tier) => Play(ImpactClip(classId, tier, out _), "impact");

    /// <summary>
    /// Impact phase against a beat that is <paramref name="secondsUntilBeat"/> away: starts
    /// `impactLead` seconds early so the clip's loudest moment coincides with the hit. Waits in
    /// scaled time, the same clock the battle timeline runs on, so ?speed=N keeps them aligned.
    /// </summary>
    public static void PlaySpecialImpactIn(int classId, int tier, float secondsUntilBeat)
    {
        var lib = Library;
        if (!Enabled || lib == null || !Application.isPlaying) return;
        var clip = ImpactClip(classId, tier, out float lead);
        if (clip == null) return;
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

    private static IEnumerator PlayAfter(AudioClip clip, float delay, string phase = "impact")
    {
        if (delay > 0f) yield return new WaitForSeconds(delay);
        Play(clip, phase);
    }

    private static void EnsureSource()
    {
        if (source != null) return;
        var go = new GameObject("BattleSfx") { hideFlags = HideFlags.HideAndDontSave };
        Object.DontDestroyOnLoad(go);
        source = go.AddComponent<AudioSource>();
        source.playOnAwake = false;
        source.spatialBlend = 0f; // 2D: the board is small and not meaningfully panned
        moveSource = go.AddComponent<AudioSource>();
        moveSource.playOnAwake = false;
        moveSource.spatialBlend = 0f;
        runner = go.AddComponent<BattleSfxRunner>();
    }
}

/// <summary>Coroutine host for BattleSfx's scheduled plays. Lives on the hidden BattleSfx object.</summary>
internal class BattleSfxRunner : MonoBehaviour { }
