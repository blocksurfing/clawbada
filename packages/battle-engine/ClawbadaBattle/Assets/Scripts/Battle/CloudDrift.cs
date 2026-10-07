using System.Collections;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Ambient drift clouds for the Evolved arena (Nzib's drop, 2026-10-07). Lives on the "Clouds" child of
/// ArenaArt_Evolved.prefab (installed by CloudDriftInstaller), so every battle's arena instance brings its own
/// sky and loses it when BattleManager swaps the arena. The designer's note, as implemented:
///   - "make it appear randomly using a script, I've created multiple cloud variations": each pass picks one
///     of the six Drift_Cloud prefabs at random, a random lane in the sky band and a random (slow) speed;
///   - "make the movement slow": 0.04–0.09 u/s — a cloud needs two to four minutes to cross;
///   - one wind per battle: every cloud drifts the same way; the 2–3 slots start IN VIEW so the sky is never
///     empty, and a cloud that leaves re-enters from the upwind edge after a pause.
/// Depth: the prefabs sort Background/1 like Nzib's Static_Clouds and the sea body (BG_2); the drift clouds
/// get a small negative z (nearer the camera) so, at the same order, they draw in front of the painted
/// clouds — moving clouds in front of still ones reads as parallax. No scaling (pixel art stays crisp).
/// Scaled time throughout, so BattleBridge.SetSpeed speeds the sky up with the battle, like the sea and the
/// gulls. Deterministic per battle: CloudDriftPlanner seeded with the battle id.
/// Browser probes grep the "[CloudDrift]" log lines (one at start, one per pass enter/exit).
/// </summary>
public class CloudDrift : MonoBehaviour
{
    public const string ChildName = "Clouds";

    [Header("Assets")]
    [Tooltip("Art/Arenas/Evolved/Decoration/Clouds/Drift_Cloud_01 … _06.prefab (a sprite each, no scripts). Index = variant.")]
    public List<GameObject> cloudPrefabs = new List<GameObject>();

    [Header("Depth")]
    [Tooltip("Sorting order on the Background layer. 1 = the layer of Static_Clouds and the sea body (BG_2).")]
    public int sortingOrder = 1;
    [Tooltip("Local z of every cloud. Negative = nearer the camera: at the same sorting order it draws AFTER " +
             "Static_Clouds (z 0), i.e. in front of the painted clouds. 0 would leave the order undefined.")]
    public float depthZ = -0.1f;

    [Header("Sky")]
    public CloudDriftConfig config = new CloudDriftConfig();
    [Tooltip("Spawn/exit this far beyond the visible half-width plus the cloud's half-width (covers CameraShake).")]
    public float offscreenMargin = 0.3f;

    [Header("Debug")]
    [Tooltip("Non-empty: replaces the battle-id seed (probes).")]
    public string seedOverride;
    public bool verbose;

    private const float TwoPi = 6.2831853f;

    private BattleManager manager;
    private string seedKey;
    private uint seed;
    private int windDir = 1;

    private void Start()
    {
        if (!Application.isPlaying) return;
        if (cloudPrefabs == null || cloudPrefabs.Count == 0) { Debug.LogWarning("[CloudDrift] no cloud prefabs assigned — no clouds"); return; }
        manager = FindAnyObjectByType<BattleManager>();
        StartCoroutine(SkyLoop());
    }

    private void OnDisable() { StopAllCoroutines(); }

    /// <summary>Visible half-width in arena-local units from the live camera, plus the margin.</summary>
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

    private IEnumerator SkyLoop()
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
        seed = ObstacleLayoutGenerator.Fnv1a("cloud|" + seedKey);
        var plan = CloudDriftPlanner.Plan(seed, config);
        windDir = plan.windDir;
        int n = Mathf.Clamp(plan.first.Length, 1, 8);

        float yLo = Mathf.Min(config.laneYMin, config.laneYMax), yHi = Mathf.Max(config.laneYMin, config.laneYMax);
        Debug.Log($"[CloudDrift] seed={seedKey} wind={(windDir > 0 ? "L→R" : "R→L")} count={n} band=[{yLo:F2},{yHi:F2}] speed=[{config.speedMin:F3},{config.speedMax:F3}] order=Background/{sortingOrder} z={depthZ:F2} view=±{ViewHalfWidthLocal():F2} plan={plan.Key()}");
        for (int i = 0; i < n; i++) StartCoroutine(SlotRoutine(i, plan.first[i]));
    }

    private IEnumerator SlotRoutine(int slot, CloudPass c)
    {
        for (int k = c.passIndex; ; k++)
        {
            if (k != c.passIndex) c = CloudDriftPlanner.PlanPass(seed, slot, k, config);
            if (c.delay > 0f) yield return new WaitForSeconds(c.delay);

            var prefab = cloudPrefabs[Mathf.Clamp(c.variant, 0, cloudPrefabs.Count - 1)];
            if (prefab == null) { Debug.LogWarning($"[CloudDrift] variant {c.variant + 1} prefab missing — slot {slot} skips"); yield return new WaitForSeconds(10f); continue; }
            var go = Instantiate(prefab, transform);
            go.name = $"Cloud_{slot}_v{c.variant + 1}";
            var sr = go.GetComponent<SpriteRenderer>();
            if (sr != null) { sr.sortingLayerName = "Background"; sr.sortingOrder = sortingOrder; }
            float halfW = sr != null && sr.sprite != null ? sr.sprite.bounds.extents.x : 0.6f;

            float viewHalf = ViewHalfWidthLocal();
            float edge = viewHalf + halfW;
            float x = c.StartsInView ? c.startFraction * viewHalf : -windDir * edge;
            go.transform.localPosition = new Vector3(x, c.laneY, depthZ);
            Debug.Log($"[CloudDrift] cloud {slot} pass {k} enter variant={c.variant + 1} {(c.StartsInView ? $"inview x={x:F2}" : (windDir > 0 ? "from L" : "from R"))} y={c.laneY:F2} speed={c.speed:F3}");

            float t = 0f;
            while (true)
            {
                t += Time.deltaTime;
                x += windDir * c.speed * Time.deltaTime;
                float bob = config.bobAmplitude * Mathf.Sin(c.bobPhase + TwoPi * t / c.bobPeriod);
                go.transform.localPosition = new Vector3(x, c.laneY + bob, depthZ);
                if (windDir * x > edge) break;         // whole cloud off-screen on the downwind side
                yield return null;
            }
            Destroy(go);
            Debug.Log($"[CloudDrift] cloud {slot} pass {k} exit {(windDir > 0 ? "R" : "L")} after {t:F0}s");
        }
    }

    private void OnDrawGizmosSelected()
    {
        if (config == null) return;
        float yLo = Mathf.Min(config.laneYMin, config.laneYMax), yHi = Mathf.Max(config.laneYMin, config.laneYMax);
        Gizmos.color = new Color(1f, 1f, 1f, 0.8f);
        var a = transform.TransformPoint(new Vector3(-5f, yLo, 0f));
        var b = transform.TransformPoint(new Vector3(5f, yHi, 0f));
        Gizmos.DrawWireCube((a + b) * 0.5f, new Vector3(Mathf.Abs(b.x - a.x), Mathf.Abs(b.y - a.y), 0f));
        Gizmos.color = new Color(0.2f, 0.6f, 1f, 0.8f);
        var h0 = transform.TransformPoint(new Vector3(-5f, config.horizonY, 0f));
        var h1 = transform.TransformPoint(new Vector3(5f, config.horizonY, 0f));
        Gizmos.DrawLine(h0, h1);
    }
}
