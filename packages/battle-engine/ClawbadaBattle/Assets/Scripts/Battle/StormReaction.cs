using UnityEngine;

/// <summary>
/// The Evolved arena reacts to Tempest's Maelstrom (user + Nzib, 2026-10-07: "the environment could react to
/// the storm — the waves would get rougher, speed up the sea animation, and the birds in the background would
/// scatter and fly away"; no new art, "we just need to increase the speed"). Lives on the "Storm" child of
/// ArenaArt_Evolved.prefab (installed by StormReactionInstaller) and listens to BattleManager.SpecialEffectStarted:
///   - the sea: the Sea and FoamAnimated animators run at seaSpeedMultiplier (7 → 21 fps at ×3 — choppier
///     frames) with a small vertical jitter of the two bands (the chop), eased in over easeInSeconds, held for
///     the effect's clip, eased out over easeOutSeconds as the storm clears; a second Maelstrom during a storm
///     extends it;
///   - the gulls: BirdFlock.Panic — every gull on screen takes off at once, climbs in FRONT of the storm clouds
///     (the storm prefab sorts on Foreground; the gulls switch layer for the flight) and leaves fast.
/// Positions and speeds are restored exactly when the storm ends. Scaled time throughout (BattleBridge.SetSpeed
/// scales Time.time, the clip and this alike). Browser probes grep the "[StormReaction]" log lines.
/// </summary>
public class StormReaction : MonoBehaviour
{
    public const string ChildName = "Storm";

    [Header("Trigger")]
    [Tooltip("The class whose cinematic Special is a storm. Other cinematic Specials (Fortify, Devour) are ignored.")]
    public string specialClass = "Tempest";

    [Header("Sea (anywhere under the arena prefab: Sea sits under BG_2, FoamAnimated under Foam)")]
    public string seaChild = "Sea";
    public string foamChild = "FoamAnimated";
    [Tooltip("Animator speed of the sea and foam bands during the storm (1 = calm). 7 fps × 3 = 21 fps.")]
    public float seaSpeedMultiplier = 3f;
    [Tooltip("Seconds from the storm's start to full roughness.")]
    public float easeInSeconds = 0.6f;
    [Tooltip("Seconds after the storm's clip ends until the sea is calm again.")]
    public float easeOutSeconds = 2f;
    [Tooltip("Vertical chop of the sea and foam bands at full storm, arena units (1.5 px = 0.0234).")]
    public float jitterAmplitude = 0.0234375f;
    [Tooltip("Chop frequency, cycles per second.")]
    public float jitterHz = 6f;

    [Header("Gulls")]
    [Tooltip("Also scatter the BirdFlock on the sibling Birds child.")]
    public bool panicGulls = true;

    [Header("Debug")]
    public bool verbose;

    private const float TwoPi = 6.2831853f;

    private BattleManager manager;
    private Animator sea, foam;
    private Vector3 seaHome, foamHome;
    private bool homesCached;
    private float stormStartAt = -1f, stormEndAt = -1f;
    /// <summary>A storm is running (the envelope is driven from Update, not a coroutine, so nothing can stop it
    /// half-way without this flag being cleared — a stopped coroutine once left the sea rough and the next
    /// Maelstrom unanswered).</summary>
    private bool stormActive;

    private void OnEnable()
    {
        if (!Application.isPlaying) return;
        if (manager == null) manager = FindAnyObjectByType<BattleManager>();
        if (manager == null) { Debug.LogWarning("[StormReaction] no BattleManager — the arena will not react to storms"); return; }
        manager.SpecialEffectStarted -= OnSpecialEffectStarted;
        manager.SpecialEffectStarted += OnSpecialEffectStarted;
        if (verbose) Debug.Log("[StormReaction] enabled, listening");
    }

    private void OnDisable()
    {
        if (manager != null) manager.SpecialEffectStarted -= OnSpecialEffectStarted;
        if (stormActive) Debug.Log($"[StormReaction] disabled mid-storm after {Time.time - stormStartAt:F1}s — sea reset");
        stormActive = false;
        Apply(0f);
    }

    private void Update()
    {
        if (!stormActive) return;
        float now = Time.time;
        float env;
        if (now < stormEndAt) env = easeInSeconds <= 0f ? 1f : Mathf.Clamp01((now - stormStartAt) / easeInSeconds);
        else
        {
            env = easeOutSeconds <= 0f ? 0f : 1f - Mathf.Clamp01((now - stormEndAt) / easeOutSeconds);
            if (env <= 0f)
            {
                stormActive = false;
                Apply(0f);
                Debug.Log($"[StormReaction] storm end after {now - stormStartAt:F1}s — sea calm");
                return;
            }
        }
        Apply(env);
    }

    private void CacheBands()
    {
        if (homesCached) return;
        var parent = transform.parent;
        if (parent == null) return;
        var s = FindDeep(parent, seaChild);
        var f = FindDeep(parent, foamChild);
        sea = s != null ? s.GetComponent<Animator>() : null;
        foam = f != null ? f.GetComponent<Animator>() : null;
        if (sea != null) seaHome = sea.transform.localPosition;
        if (foam != null) foamHome = foam.transform.localPosition;
        homesCached = true;
        if (sea == null || foam == null) Debug.LogWarning($"[StormReaction] missing band animators (sea={(sea != null)} foam={(foam != null)}) — the chop will be partial");
    }

    /// <summary>Depth-first search by name (Transform.Find only sees direct children).</summary>
    public static Transform FindDeep(Transform root, string name)
    {
        if (root == null) return null;
        foreach (var t in root.GetComponentsInChildren<Transform>(true)) if (t != root && t.name == name) return t;
        return null;
    }

    private void OnSpecialEffectStarted(string className, float clipSeconds, float impactAt)
    {
        if (className != specialClass) return;
        CacheBands();
        float end = Time.time + Mathf.Max(0.5f, clipSeconds);
        bool extended = stormActive;
        if (!extended) stormStartAt = Time.time;
        stormEndAt = Mathf.Max(stormEndAt, end);
        stormActive = true;
        Debug.Log($"[StormReaction] storm {(extended ? "extended" : "start")} clip={clipSeconds:F2}s impactAt={impactAt:F2}s sea×{seaSpeedMultiplier:F1} chop={jitterAmplitude * 64f:F1}px@{jitterHz:F0}Hz");
        if (panicGulls && transform.parent != null)
        {
            var flock = transform.parent.GetComponentInChildren<BirdFlock>(true);
            if (flock != null) flock.Panic(clipSeconds);
        }
    }

    /// <summary>0 = calm (speeds 1, bands at home), 1 = full storm.</summary>
    private void Apply(float env)
    {
        float speed = 1f + (seaSpeedMultiplier - 1f) * env;
        float j = env > 0f ? jitterAmplitude * env * Mathf.Sin(Time.time * TwoPi * jitterHz) : 0f;
        if (sea != null) { sea.speed = speed; sea.transform.localPosition = seaHome + new Vector3(0f, j, 0f); }
        if (foam != null) { foam.speed = speed; foam.transform.localPosition = foamHome - new Vector3(0f, j * 0.7f, 0f); }
    }
}
