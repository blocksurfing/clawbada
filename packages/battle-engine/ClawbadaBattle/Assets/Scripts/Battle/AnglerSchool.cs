using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Ambient angler fish for the Elite arena (Nzib's drop, 2026-10-05). Lives on the "Fish" child of
/// ArenaArt_Elite.prefab (installed by AnglerSchoolInstaller), so every battle's arena instance brings its
/// own school and loses it when BattleManager swaps the arena. The designer's note, as implemented:
///   - "just swimming around in the background": each fish crosses the open water above the floor on its
///     own lane, with a slow bob, and sometimes turns back mid-way (the Turn clip) where it can be seen;
///   - "randomize the quantity and the direction": 1–3 fish per battle, each entering from a random edge,
///     at a random speed and size, staggered; a fish that leaves comes back later on a new pass;
///   - "stay on background": the sprites sort on the Background layer at `sortingOrder` (2 = in front of the
///     water, behind the ruined walls — see the field), under the floor, the actors and every HUD element.
/// The AnglerFish animator has no parameters or transitions — playback is driven by Animator.Play to state
/// names (Swim loops; Turn is a one-shot timed by clip length). Scaled time throughout, so
/// BattleBridge.SetSpeed speeds the fish up with the battle, like the sea and the gulls.
/// Deterministic per battle: AnglerSchoolPlanner seeded with the battle id.
/// Browser probes grep the "[AnglerSchool]" log lines (one at start, one per crossing, one per turn/exit).
/// </summary>
public class AnglerSchool : MonoBehaviour
{
    public const string ChildName = "Fish";

    [Header("Assets")]
    [Tooltip("Art/Arenas/Elite/Decoration/Angler Fish/AnglerFish.prefab (sprite + animator, no scripts).")]
    public GameObject fishPrefab;
    [Tooltip("The sheets draw the fish facing right; flipX is derived from this.")]
    public bool artFacesRight = true;

    [Header("Depth")]
    [Tooltip("Sorting order on the Background layer. 2 = in front of the water (BG - 3 at 1) and BEHIND the ruined " +
             "walls (BG - 2 at 3): the fish is seen between the walls and slips behind them at the corners. Nzib's " +
             "prefab carries 3 (level with the walls); set 3 here to match it instead.")]
    public int sortingOrder = 2;

    [Header("School")]
    public AnglerSchoolConfig config = new AnglerSchoolConfig();
    [Tooltip("Spawn/exit this far beyond the visible half-width (covers CameraShake).")]
    public float offscreenMargin = 0.6f;

    [Header("Debug")]
    [Tooltip("Non-empty: replaces the battle-id seed (probes).")]
    public string seedOverride;
    public bool verbose;

    private static readonly int HSwim = Animator.StringToHash("Swim");
    private static readonly int HTurn = Animator.StringToHash("Turn");
    private const float TwoPi = 6.2831853f;

    private sealed class Fish
    {
        public int index;
        public GameObject go;
        public Transform t;
        public SpriteRenderer sr;
        public Animator anim;
    }

    private readonly Dictionary<int, float> clipLength = new Dictionary<int, float>();
    private BattleManager manager;
    private Fish[] pool;
    private string seedKey;
    private uint seed;

    private void Start()
    {
        if (!Application.isPlaying) return;
        if (fishPrefab == null) { Debug.LogWarning("[AnglerSchool] no fish prefab assigned — no fish"); return; }
        CacheClipLengths();
        manager = FindAnyObjectByType<BattleManager>();
        StartCoroutine(SchoolLoop());
    }

    private void OnDisable() { StopAllCoroutines(); }

    private void CacheClipLengths()
    {
        var animator = fishPrefab.GetComponent<Animator>();
        var controller = animator != null ? animator.runtimeAnimatorController : null;
        if (controller == null) return;
        // The installer checks each state's clip carries the state's name, so clip names index the states.
        foreach (var clip in controller.animationClips) clipLength[Animator.StringToHash(clip.name)] = clip.length;
    }

    private float Len(int hash) => clipLength.TryGetValue(hash, out float l) ? l : 0.4f;

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

    private IEnumerator SchoolLoop()
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
        seed = ObstacleLayoutGenerator.Fnv1a("fish|" + seedKey);
        var plan = AnglerSchoolPlanner.Plan(seed, config);
        int n = Mathf.Clamp(plan.first.Length, 1, 8);

        pool = new Fish[n];
        for (int i = 0; i < n; i++)
        {
            var go = Instantiate(fishPrefab, transform);
            go.name = "Fish_" + i;
            go.SetActive(false);
            var sr = go.GetComponent<SpriteRenderer>();
            if (sr != null) { sr.sortingLayerName = "Background"; sr.sortingOrder = sortingOrder; }
            pool[i] = new Fish { index = i, go = go, t = go.transform, sr = sr, anim = go.GetComponent<Animator>() };
        }

        float viewHalf = ViewHalfWidthLocal();
        float yLo = Mathf.Min(config.laneYMin, config.laneYMax), yHi = Mathf.Max(config.laneYMin, config.laneYMax);
        Debug.Log($"[AnglerSchool] seed={seedKey} count={n} band=[{yLo:F2},{yHi:F2}] order=Background/{sortingOrder} view=±{viewHalf:F2} plan={plan.Key()}");
        for (int i = 0; i < n; i++) StartCoroutine(FishRoutine(pool[i], plan.first[i]));
    }

    private IEnumerator FishRoutine(Fish f, FishCrossing c)
    {
        for (int k = c.crossingIndex; ; k++)
        {
            if (k != c.crossingIndex) c = AnglerSchoolPlanner.PlanCrossing(seed, f.index, k, config);
            yield return new WaitForSeconds(c.delay);

            float viewHalf = ViewHalfWidthLocal();
            int dir = -c.entrySide;                 // in from the right → swims left
            float x = c.entrySide * viewHalf;
            f.t.localScale = new Vector3(c.scale, c.scale, 1f);
            f.t.localPosition = new Vector3(x, c.laneY, 0f);
            Face(f, dir);
            f.go.SetActive(true);
            Play(f, HSwim, c.bobPhase / TwoPi);     // random fin phase: two fish do not beat in sync
            Debug.Log($"[AnglerSchool] fish {f.index} crossing {k} enter {(c.entrySide > 0 ? "R→L" : "L→R")} y={c.laneY:F2} speed={c.speed:F2} scale={c.scale:F2} {(c.Turns ? $"turn@x={c.turnAtX:F2}" : "straight")}");

            bool turned = false;
            float t = 0f;
            while (true)
            {
                t += Time.deltaTime;
                x += dir * c.speed * Time.deltaTime;
                float bob = config.bobAmplitude * Mathf.Sin(c.bobPhase + TwoPi * t / c.bobPeriod);
                f.t.localPosition = new Vector3(x, c.laneY + bob, 0f);
                if (!turned && c.Turns && dir * (x - c.turnAtX) >= 0f)
                {
                    turned = true;
                    yield return Turn(f, dir);
                    dir = -dir;
                    Debug.Log($"[AnglerSchool] fish {f.index} turned at x={x:F2}, now heading {(dir > 0 ? "R" : "L")}");
                }
                if (dir * x > viewHalf) break;      // off-screen on the exit side
                yield return null;
            }
            f.go.SetActive(false);
            Debug.Log($"[AnglerSchool] fish {f.index} exit {(dir > 0 ? "R" : "L")}");
        }
    }

    /// <summary>The Turn clip natively swings a right-facing fish round to face left. Heading right it plays
    /// as drawn; heading left (mirrored) it plays mirrored, so it ends facing right. The fish holds its spot
    /// for the clip's length, then swims the other way.</summary>
    private IEnumerator Turn(Fish f, int dir)
    {
        Play(f, HTurn, 0f);
        float hold = Len(HTurn);
        float t = 0f;
        while (t < hold) { t += Time.deltaTime; yield return null; }
        Face(f, -dir);
        Play(f, HSwim, 0f);
    }

    private void Face(Fish f, int dir) { if (f.sr != null) f.sr.flipX = artFacesRight ? dir < 0 : dir > 0; }

    /// <summary>Sprite-curve clips do not blend, so Play (not CrossFade); Update(0) evaluates the state machine
    /// now, so a re-activated fish shows the right frame on its first render.</summary>
    private static void Play(Fish f, int hash, float normalizedTime)
    {
        if (f.anim == null) return;
        f.anim.Play(hash, 0, normalizedTime);
        f.anim.Update(0f);
    }

    private void OnDrawGizmosSelected()
    {
        if (config == null) return;
        float yLo = Mathf.Min(config.laneYMin, config.laneYMax), yHi = Mathf.Max(config.laneYMin, config.laneYMax);
        Gizmos.color = new Color(0.3f, 0.9f, 1f, 0.9f);
        var a = transform.TransformPoint(new Vector3(-5f, yLo, 0f));
        var b = transform.TransformPoint(new Vector3(5f, yHi, 0f));
        Gizmos.DrawWireCube((a + b) * 0.5f, new Vector3(Mathf.Abs(b.x - a.x), Mathf.Abs(b.y - a.y), 0f));
        Gizmos.color = new Color(1f, 0.8f, 0.2f, 0.9f);
        var ta = transform.TransformPoint(new Vector3(-config.turnHalfWidth, yLo, 0f));
        var tb = transform.TransformPoint(new Vector3(config.turnHalfWidth, yHi, 0f));
        Gizmos.DrawWireCube((ta + tb) * 0.5f, new Vector3(Mathf.Abs(tb.x - ta.x), Mathf.Abs(tb.y - ta.y), 0f));
    }
}
