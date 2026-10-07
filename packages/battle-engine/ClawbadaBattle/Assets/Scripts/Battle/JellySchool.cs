using System.Collections;
using UnityEngine;

/// <summary>
/// Ambient jellyfish for the Elite arena (Nzib's drop, 2026-10-07). Lives on the "Jellies" child of
/// ArenaArt_Elite.prefab (installed by JellySchoolInstaller), so every battle's arena instance brings its own
/// school and loses it when BattleManager swaps the arena. The designer's note, as implemented:
///   - "it moves diagonally and just one way, it doesn't have turn movement": each jellyfish rises on a
///     straight diagonal with a gentle sway and never turns;
///   - "a group of jellyfish (3 jellyfish max) that swim diagonally from the bottom to the top": groups of
///     1–3 share a heading and a spot, surface a moment apart, rise together and leave above the frame; the
///     next group comes later;
///   - where a PLAYER can see them: the water band right of x ≈ 0.2 sits under the opponent's HUD panels
///     and left of ≈ −2.3 behind the ruined wall, so groups surface in x −1.7…−0.5 and never drift out of
///     −2.0…−0.1 (the first probe run put one straight under the HUD);
///   - "from the bottom": the floor plate (Ground, Background/0) is painted below y ≈ 1.72 and this sprite
///     sorts above it, so a jellyfish fades in AT the floor line as if surfacing from behind the plate — a
///     literal start at the frame bottom would float it over the sand beside the board.
/// Depth: Nzib's prefab sorts Background/2, level with his BG - 2.1 layer and the angler fish; a small
/// negative z puts the jellyfish just in front of both and still behind the ruined walls (Background/3).
/// The JellyFish animator has one looping state (Swim); playback starts at a random phase so a group does
/// not pulse in sync. Scaled time throughout, so BattleBridge.SetSpeed speeds them up with the battle.
/// Deterministic per battle: JellySchoolPlanner seeded with the battle id.
/// Browser probes grep the "[JellySchool]" log lines (one at start, one per group, one per rise enter/exit).
/// </summary>
public class JellySchool : MonoBehaviour
{
    public const string ChildName = "Jellies";

    [Header("Assets")]
    [Tooltip("Art/Arenas/Elite/Decoration/Jelly Fish/JellyFish.prefab (sprite + animator, no scripts).")]
    public GameObject jellyPrefab;

    [Header("Depth")]
    [Tooltip("Sorting order on the Background layer. 2 = Nzib's prefab value: in front of the water (BG - 3 at 1), behind the ruined walls (BG - 2 at 3).")]
    public int sortingOrder = 2;
    [Tooltip("Local z of every jellyfish. Negative = nearer the camera: at the same sorting order it draws AFTER " +
             "BG - 2.1 and the angler fish (z 0), i.e. just in front of them.")]
    public float depthZ = -0.01f;

    [Header("School")]
    public JellySchoolConfig config = new JellySchoolConfig();

    [Header("Debug")]
    [Tooltip("Non-empty: replaces the battle-id seed (probes).")]
    public string seedOverride;
    public bool verbose;

    private static readonly int HSwim = Animator.StringToHash("Swim");
    private const float TwoPi = 6.2831853f;

    private sealed class Jelly
    {
        public GameObject go;
        public Transform t;
        public SpriteRenderer sr;
        public Animator anim;
        public bool busy;
    }

    private BattleManager manager;
    private Jelly[] pool;
    private string seedKey;
    private uint seed;
    private int active;

    private void Start()
    {
        if (!Application.isPlaying) return;
        if (jellyPrefab == null) { Debug.LogWarning("[JellySchool] no jellyfish prefab assigned — no jellyfish"); return; }
        manager = FindAnyObjectByType<BattleManager>();
        StartCoroutine(SchoolLoop());
    }

    private void OnDisable() { StopAllCoroutines(); }

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
        seed = ObstacleLayoutGenerator.Fnv1a("jelly|" + seedKey);

        int poolSize = Mathf.Clamp(Mathf.Max(config.minJellies, config.maxJellies), 1, 8);
        pool = new Jelly[poolSize];
        for (int i = 0; i < poolSize; i++)
        {
            var go = Instantiate(jellyPrefab, transform);
            go.name = "Jelly_" + i;
            go.SetActive(false);
            var sr = go.GetComponent<SpriteRenderer>();
            if (sr != null) { sr.sortingLayerName = "Background"; sr.sortingOrder = sortingOrder; }
            pool[i] = new Jelly { go = go, t = go.transform, sr = sr, anim = go.GetComponent<Animator>() };
        }
        Debug.Log($"[JellySchool] seed={seedKey} max={config.maxJellies} spawnY={config.spawnY:F2} exitY={config.exitY:F2} rise=[{config.riseSpeedMin:F3},{config.riseSpeedMax:F3}] order=Background/{sortingOrder} z={depthZ:F2}");

        for (int g = 0; ; g++)
        {
            var group = JellySchoolPlanner.PlanGroup(seed, g, config);
            yield return new WaitForSeconds(group.delay);
            Debug.Log($"[JellySchool] group {g} count={group.members.Length} heading={(group.dir > 0 ? "→" : "←")} baseX={group.baseX:F2} plan={group.Key()}");
            for (int i = 0; i < group.members.Length; i++)
            {
                var jelly = Free();
                if (jelly == null) break;              // pool exhausted (cannot happen with maxJellies slots)
                jelly.busy = true;
                active++;
                StartCoroutine(Rise(jelly, group.members[i]));
            }
            // The gap starts when the last member has left.
            while (active > 0) yield return null;
        }
    }

    private Jelly Free()
    {
        foreach (var j in pool) if (!j.busy) return j;
        return null;
    }

    private IEnumerator Rise(Jelly j, JellyRise m)
    {
        if (m.delay > 0f) yield return new WaitForSeconds(m.delay);

        float x = m.startX, y = config.spawnY;
        j.t.localScale = new Vector3(m.scale, m.scale, 1f);
        j.t.localPosition = new Vector3(x, y, depthZ);
        if (j.sr != null) j.sr.flipX = m.drift < 0f;   // lean the way it travels
        SetAlpha(j, 0f);
        j.go.SetActive(true);
        if (j.anim != null) { j.anim.Play(HSwim, 0, m.swayPhase / TwoPi); j.anim.Update(0f); }
        Debug.Log($"[JellySchool] jelly g{m.groupIndex}.{m.memberIndex} enter x={x:F2} y={y:F2} up={m.riseSpeed:F3} dx={m.drift:+0.000;-0.000} scale={m.scale:F2}");

        float t = 0f;
        float fade = Mathf.Max(0.01f, config.fadeInSeconds);
        while (true)
        {
            float dt = Time.deltaTime;
            t += dt;
            y += m.riseSpeed * dt;
            x += m.drift * dt;
            float sway = config.swayAmplitude * Mathf.Sin(m.swayPhase + TwoPi * t / m.swayPeriod);
            j.t.localPosition = new Vector3(x + sway, y, depthZ);
            if (t < fade) SetAlpha(j, Mathf.Clamp01(t / fade));
            else if (t - dt < fade) SetAlpha(j, 1f);
            if (y > config.exitY) break;
            yield return null;
        }
        j.go.SetActive(false);
        j.busy = false;
        active--;
        Debug.Log($"[JellySchool] jelly g{m.groupIndex}.{m.memberIndex} exit x={x:F2} after {t:F1}s");
    }

    private static void SetAlpha(Jelly j, float a)
    {
        if (j.sr == null) return;
        var c = j.sr.color;
        c.a = a;
        j.sr.color = c;
    }

    private void OnDrawGizmosSelected()
    {
        if (config == null) return;
        Gizmos.color = new Color(0.9f, 0.5f, 1f, 0.9f);
        var a = transform.TransformPoint(new Vector3(config.spawnXCenter - config.spawnXHalfWidth, config.spawnY, 0f));
        var b = transform.TransformPoint(new Vector3(config.spawnXCenter + config.spawnXHalfWidth, config.spawnY, 0f));
        Gizmos.DrawLine(a, b);
        var c = transform.TransformPoint(new Vector3(config.visibleXMin, config.exitY, 0f));
        var d = transform.TransformPoint(new Vector3(config.visibleXMax, config.exitY, 0f));
        Gizmos.DrawLine(c, d);
    }
}
