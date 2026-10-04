using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Ambient seagulls for the Evolved arena (Nzib's drop, 2026-10-04). Lives on the "Birds" child of
/// ArenaArt_Evolved.prefab (installed by BirdFlockInstaller), so every battle's arena instance brings its
/// own flock and loses it when BattleManager swaps the arena. The designer's notes, as implemented:
///   - a flock of 3 (up to 5) enters from off-screen, sides balanced (2 from one edge, 1 from the other);
///   - each bird lands on a free rock (Landing clip), then idles at random (Idle_1/2/3, or Walk along the
///     rock's flat crest);
///   - after a while they leave ONE AFTER ANOTHER: Jump, then Fly out to one edge; the next flock comes later.
/// The Bird animator has no parameters or transitions — playback is driven by Animator.Play to state names,
/// one-shots (Jump, Landing) timed by clip length. Everything runs on scaled time (coroutines +
/// Normal-mode animators), so BattleBridge.SetSpeed speeds the birds up with the battle, like the sea.
/// Deterministic per battle: the plan comes from BirdFlockPlanner seeded with the battle id.
/// Browser probes grep the "[BirdFlock]" log lines (one per flock, one per landing, one per departure).
/// </summary>
public class BirdFlock : MonoBehaviour
{
    public const string ChildName = "Birds";

    [Header("Assets")]
    [Tooltip("Art/Arenas/Evolved/Decoration/Bird/Bird.prefab (sprite + animator, no scripts).")]
    public GameObject birdPrefab;
    [Tooltip("The sheets draw the bird facing right; flipX is derived from this.")]
    public bool artFacesRight = true;

    [Header("Perches — arena-local feet positions on the rocks (designer-owned; ±3 px, Nzib reviews)")]
    public List<BirdPerch> perches = DefaultPerches();

    [Header("Flock")]
    public BirdFlockConfig config = new BirdFlockConfig();
    [Tooltip("After the intro, before the first flock.")]
    public float firstFlockDelayMin = 6f;
    public float firstFlockDelayMax = 12f;
    [Tooltip("From the last departure to the next flock.")]
    public float flockGapMin = 20f;
    public float flockGapMax = 45f;

    [Header("Motion (units/s, seconds)")]
    public float flySpeed = 2.2f;
    [Tooltip("Eased drop from cruise height to the perch at the end of the flight.")]
    public float descentSeconds = 1.0f;
    [Tooltip("The Landing clip starts this long before touchdown (its first frames are airborne). 0 = play it on the rock.")]
    public float landingLead = 0.3f;
    [Tooltip("Eased rise from the perch to cruise height after the Jump.")]
    public float climbSeconds = 0.8f;
    public float walkSpeed = 0.25f;
    [Tooltip("Spawn/exit this far beyond the visible half-width (covers CameraShake).")]
    public float offscreenMargin = 0.6f;

    [Header("On the perch (relative weights; Walk only where the perch has a walk span)")]
    public float idle1Weight = 4f;
    public float idle2Weight = 2.5f;
    public float idle3Weight = 2f;
    public float walkWeight = 1.5f;
    [Tooltip("An idle plays this many whole loops, so switches land on a loop boundary.")]
    public int idleCyclesMin = 1;
    public int idleCyclesMax = 3;
    [Range(0f, 1f)] public float turnChance = 0.2f;

    [Header("Debug")]
    [Tooltip("Non-empty: replaces the battle-id seed (probes).")]
    public string seedOverride;
    public bool verbose;

    private static readonly int HIdle1 = Animator.StringToHash("Idle_1");
    private static readonly int HIdle2 = Animator.StringToHash("Idle_2");
    private static readonly int HIdle3 = Animator.StringToHash("Idle_3");
    private static readonly int HJump = Animator.StringToHash("Jump");
    private static readonly int HFly = Animator.StringToHash("Fly");
    private static readonly int HLanding = Animator.StringToHash("Landing");
    private static readonly int HWalk = Animator.StringToHash("Walk");
    /// <summary>The sheets' feet pivot: 7 of 32 px above the frame's bottom edge (0.5 units tall).</summary>
    private const float FeetAboveBottom = 0.21875f * 0.5f;

    private sealed class Bird
    {
        public int index;
        public GameObject go;
        public Transform t;
        public SpriteRenderer sr;
        public Animator anim;
        public BirdPlan plan;
        public BirdRng rng;
        public bool landed, departSignal, done;
    }

    private readonly Dictionary<int, float> clipLength = new Dictionary<int, float>();
    private BattleManager manager;
    private Bird[] pool;
    private string seedKey;
    private int flockIndex;

    public static List<BirdPerch> DefaultPerches() => new List<BirdPerch>
    {
        // Nzib's own example bird (ArenaAuthoring.unity): the crest of the big right rock. Off by default:
        // in battle the opponent team panels (top-right HUD) sit exactly over it, so a gull there is hidden.
        new BirdPerch { id = "RightBig", x = 3.21875f, y = 2.046875f, walkHalfWidth = 0.2f, disabled = true },
        new BirdPerch { id = "RightSmall", x = 2.1875f, y = 1.6875f, walkHalfWidth = 0.1f },
        // Steep, at the frame edge and probably under the HUD: off until the designer says otherwise.
        new BirdPerch { id = "RightFar", x = 4.4f, y = 2.1875f, walkHalfWidth = 0f, disabled = true },
        new BirdPerch { id = "LeftA", x = -2.5f, y = 1.9375f, walkHalfWidth = 0.1f },
        new BirdPerch { id = "LeftB", x = -3.1f, y = 1.9375f, walkHalfWidth = 0f },
        // Off by default: the top-left HUD (timer / settings hexes) sits over the wreck's bow in battle.
        new BirdPerch { id = "BoatBow", x = -3.65f, y = 2.0f, walkHalfWidth = 0f, disabled = true },
    };

    private void Start()
    {
        if (!Application.isPlaying) return;
        if (birdPrefab == null) { Debug.LogWarning("[BirdFlock] no bird prefab assigned — no gulls"); return; }
        CacheClipLengths();
        manager = FindAnyObjectByType<BattleManager>();
        StartCoroutine(FlockLoop());
    }

    private void OnDisable() { StopAllCoroutines(); }

    private void CacheClipLengths()
    {
        var animator = birdPrefab.GetComponent<Animator>();
        var controller = animator != null ? animator.runtimeAnimatorController : null;
        if (controller == null) return;
        // The installer checks each state's clip carries the state's name, so clip names index the states.
        foreach (var clip in controller.animationClips) clipLength[Animator.StringToHash(clip.name)] = clip.length;
    }

    private float Len(int hash) => clipLength.TryGetValue(hash, out float l) ? l : 0.5f;

    /// <summary>Off-screen x in arena-local units: the visible half-width from the live camera (the
    /// pixel-perfect camera can show a little more than 640×360) plus the margin.</summary>
    private float ViewHalfWidthLocal()
    {
        var cam = Camera.main;
        if (cam == null) return 5f + offscreenMargin;
        float half = cam.orthographicSize * cam.aspect;
        float cx = cam.transform.position.x;
        float right = Mathf.Abs(transform.InverseTransformPoint(new Vector3(cx + half, 0f, 0f)).x);
        float left = Mathf.Abs(transform.InverseTransformPoint(new Vector3(cx - half, 0f, 0f)).x);
        return Mathf.Max(right, left) + offscreenMargin;
    }

    private static float Round64(float v) => Mathf.Round(v * 64f) / 64f;

    private IEnumerator FlockLoop()
    {
        // The scene's pre-battle arena preview carries this component too: it idles here until
        // BattleManager.Initialize replaces it (and the real instance starts its own loop).
        while (manager != null && manager.InitData == null) yield return new WaitForSeconds(0.5f);
        while (manager != null && manager.IntroPlaying) yield return null;

        string battleId = manager != null && manager.InitData != null ? manager.InitData.battleId : null;
        string tier = manager != null && manager.InitData != null && manager.InitData.arena != null ? manager.InitData.arena.tier : "";
        seedKey = !string.IsNullOrEmpty(seedOverride) ? seedOverride
            : !string.IsNullOrEmpty(battleId) ? battleId + "|" + tier
            : "nobattle|" + System.Environment.TickCount;
        var rng = new BirdRng(ObstacleLayoutGenerator.Fnv1a("birds|" + seedKey));

        int poolSize = Mathf.Clamp(config.maxBirds, 1, 8);
        pool = new Bird[poolSize];
        for (int i = 0; i < poolSize; i++)
        {
            var go = Instantiate(birdPrefab, transform);
            go.name = "Bird_" + i;
            go.SetActive(false);
            pool[i] = new Bird { index = i, go = go, t = go.transform, sr = go.GetComponent<SpriteRenderer>(), anim = go.GetComponent<Animator>() };
        }

        int enabledPerches = 0;
        foreach (var p in perches) if (!p.disabled) enabledPerches++;
        float viewHalf = ViewHalfWidthLocal();
        float first = rng.Range(firstFlockDelayMin, firstFlockDelayMax);
        Debug.Log($"[BirdFlock] seed={seedKey} perches={enabledPerches} enabled view=±{viewHalf:F2} first flock in {first:F1}s");
        yield return new WaitForSeconds(first);

        for (flockIndex = 0; ; flockIndex++)
        {
            uint seed = ObstacleLayoutGenerator.Fnv1a($"birds|{seedKey}|{flockIndex}");
            var plan = BirdFlockPlanner.Plan(seed, perches, config);
            if (plan.birds.Length == 0) { Debug.LogWarning("[BirdFlock] no usable perches — no gulls"); yield break; }
            viewHalf = ViewHalfWidthLocal();
            Debug.Log($"[BirdFlock] flock {flockIndex}: {plan.Key()} dwell={plan.dwellSeconds:F1}s");

            var birds = new List<Bird>(plan.birds.Length);
            for (int k = 0; k < plan.birds.Length && k < pool.Length; k++)
            {
                var b = pool[k];
                b.plan = plan.birds[k];
                b.rng = new BirdRng(b.plan.idleSeed);
                b.landed = false; b.departSignal = false; b.done = false;
                birds.Add(b);
                StartCoroutine(BirdRoutine(b, viewHalf));
            }

            // All down (crossing the whole view is ~5 s at 2.2 u/s).
            float lastArrival = plan.birds[plan.birds.Length - 1].arrivalDelay;
            float waited = 0f;
            while (!AllLanded(birds) && waited < lastArrival + 25f) { waited += Time.deltaTime; yield return null; }

            yield return new WaitForSeconds(plan.dwellSeconds);

            // Leave one after another, in the plan's departure order.
            var ordered = new List<Bird>(birds);
            ordered.Sort((a, c) => a.plan.departOrder.CompareTo(c.plan.departOrder));
            float prev = 0f;
            foreach (var b in ordered)
            {
                float gap = b.plan.departDelay - prev;
                if (gap > 0f) yield return new WaitForSeconds(gap);
                prev = b.plan.departDelay;
                b.departSignal = true;
            }
            waited = 0f;
            while (!AllDone(birds) && waited < 30f) { waited += Time.deltaTime; yield return null; }
            foreach (var b in birds) if (!b.done) { b.go.SetActive(false); b.done = true; } // safety net

            yield return new WaitForSeconds(rng.Range(flockGapMin, flockGapMax));
        }
    }

    private static bool AllLanded(List<Bird> birds) { foreach (var b in birds) if (!b.landed) return false; return true; }
    private static bool AllDone(List<Bird> birds) { foreach (var b in birds) if (!b.done) return false; return true; }

    private IEnumerator BirdRoutine(Bird b, float viewHalf)
    {
        var p = b.plan;
        var perch = perches[p.perch];
        yield return new WaitForSeconds(p.arrivalDelay);

        // In from the entry edge at cruise height, facing the way it flies.
        float startX = p.entrySide * viewHalf;
        b.t.localPosition = new Vector3(startX, p.cruiseY, 0f);
        Face(b, perch.x < startX ? -1 : 1);
        b.go.SetActive(true);
        Play(b, HFly, b.rng.NextFloat()); // random flap phase: three birds do not beat in sync
        bool landingStarted = false;
        yield return FlyTo(b, startX, p.cruiseY, perch.x, perch.y, true, v => landingStarted = v);

        b.t.localPosition = new Vector3(Round64(perch.x), Round64(perch.y), 0f);
        if (!landingStarted) { Play(b, HLanding, 0f); yield return new WaitForSeconds(Len(HLanding)); }
        else { float rest = Len(HLanding) - landingLead; if (rest > 0f) yield return new WaitForSeconds(rest); }
        b.landed = true;
        Debug.Log($"[BirdFlock] flock {flockIndex} bird {b.index} landed {p.perchId} ({perch.x:F2},{perch.y:F2})");

        while (!b.departSignal) yield return IdleStep(b, perch);

        // Jump first, then Fly (Nzib): the Jump's last frames are airborne, so the climb starts after it.
        Face(b, p.exitSide);
        Play(b, HJump, 0f);
        yield return new WaitForSeconds(Len(HJump));
        Play(b, HFly, 0f);
        float fromX = b.t.localPosition.x;
        yield return FlyTo(b, fromX, perch.y, p.exitSide * viewHalf, p.cruiseY, false, null);
        b.go.SetActive(false);
        b.done = true;
        Debug.Log($"[BirdFlock] flock {flockIndex} bird {b.index} departed {(p.exitSide > 0 ? "R" : "L")}");
    }

    /// <summary>Straight flight at flySpeed with an eased vertical move: arriving, the drop to the perch fills the
    /// last descentSeconds (and the Landing clip starts landingLead before touchdown); leaving, the rise to
    /// cruise height fills the first climbSeconds.</summary>
    private IEnumerator FlyTo(Bird b, float x0, float y0, float x1, float y1, bool arriving, System.Action<bool> landingStarted)
    {
        float duration = Mathf.Max(0.05f, Mathf.Abs(x1 - x0) / Mathf.Max(0.01f, flySpeed));
        bool started = false;
        float t = 0f;
        while (t < duration)
        {
            t += Time.deltaTime;
            float u = Mathf.Clamp01(t / duration);
            float x = Mathf.Lerp(x0, x1, u);
            float y;
            if (arriving)
            {
                float window = Mathf.Min(descentSeconds, duration);
                float remain = duration - t;
                y = remain >= window ? y0 : Mathf.Lerp(y0, y1, Mathf.SmoothStep(0f, 1f, 1f - remain / window));
                if (!started && landingLead > 0f && remain <= landingLead)
                {
                    started = true;
                    Play(b, HLanding, 0f);
                    landingStarted?.Invoke(true);
                }
            }
            else
            {
                float window = Mathf.Min(climbSeconds, duration);
                y = t >= window ? y1 : Mathf.Lerp(y0, y1, Mathf.SmoothStep(0f, 1f, t / window));
            }
            b.t.localPosition = new Vector3(x, y, 0f);
            yield return null;
        }
    }

    /// <summary>One idle choice on the perch: a few whole loops of an idle (maybe turning first), or a walk
    /// along the crest. Returns the moment the departure signal arrives.</summary>
    private IEnumerator IdleStep(Bird b, BirdPerch perch)
    {
        float wWalk = perch.walkHalfWidth > 0f ? walkWeight : 0f;
        float total = idle1Weight + idle2Weight + idle3Weight + wWalk;
        float r = b.rng.NextFloat() * total;
        if (r < idle1Weight) yield return Idle(b, HIdle1);
        else if (r < idle1Weight + idle2Weight) yield return Idle(b, HIdle2);
        else if (r < idle1Weight + idle2Weight + idle3Weight || wWalk <= 0f) yield return Idle(b, HIdle3);
        else yield return Walk(b, perch);
    }

    private IEnumerator Idle(Bird b, int hash)
    {
        if (b.rng.NextFloat() < turnChance) b.sr.flipX = !b.sr.flipX;
        Play(b, hash, 0f);
        int cycles = b.rng.Range(Mathf.Max(1, idleCyclesMin), Mathf.Max(idleCyclesMin, idleCyclesMax) + 1);
        float duration = Len(hash) * cycles;
        if (verbose) Debug.Log($"[BirdFlock] bird {b.index} idle {hash} ×{cycles}");
        float t = 0f;
        while (!b.departSignal && t < duration) { t += Time.deltaTime; yield return null; }
    }

    private IEnumerator Walk(Bird b, BirdPerch perch)
    {
        float hw = perch.walkHalfWidth;
        float curX = b.t.localPosition.x;
        float targetX = Round64(perch.x + b.rng.Range(-hw, hw));
        if (Mathf.Abs(targetX - curX) < 0.08f) targetX = Round64(perch.x + (curX >= perch.x ? -hw : hw));
        Face(b, targetX >= curX ? 1 : -1);
        Play(b, HWalk, 0f);
        if (verbose) Debug.Log($"[BirdFlock] bird {b.index} walk {curX:F2}→{targetX:F2}");
        while (!b.departSignal && Mathf.Abs(b.t.localPosition.x - targetX) > 0.0001f)
        {
            var pos = b.t.localPosition;
            pos.x = Mathf.MoveTowards(pos.x, targetX, walkSpeed * Time.deltaTime);
            b.t.localPosition = pos;
            yield return null;
        }
        if (!b.departSignal) { var pos = b.t.localPosition; pos.x = targetX; b.t.localPosition = pos; }
    }

    private void Face(Bird b, int dir) { b.sr.flipX = artFacesRight ? dir < 0 : dir > 0; }

    /// <summary>Sprite-curve clips do not blend, so Play (not CrossFade); Update(0) makes the state machine
    /// evaluate now, so a re-activated bird shows the right frame on its first render instead of Idle_1.</summary>
    private static void Play(Bird b, int hash, float normalizedTime)
    {
        b.anim.Play(hash, 0, normalizedTime);
        b.anim.Update(0f);
    }

    private void OnDrawGizmosSelected()
    {
        if (perches == null) return;
        foreach (var p in perches)
        {
            Gizmos.color = p.disabled ? new Color(1f, 0.3f, 0.3f, 0.9f) : new Color(0.3f, 0.9f, 1f, 0.9f);
            var feet = transform.TransformPoint(new Vector3(p.x, p.y, 0f));
            var centre = feet + new Vector3(0f, 0.25f - FeetAboveBottom, 0f);
            Gizmos.DrawWireCube(centre, new Vector3(0.5f, 0.5f, 0f));
            if (p.walkHalfWidth > 0f)
                Gizmos.DrawLine(feet + new Vector3(-p.walkHalfWidth, 0f, 0f), feet + new Vector3(p.walkHalfWidth, 0f, 0f));
        }
    }
}
