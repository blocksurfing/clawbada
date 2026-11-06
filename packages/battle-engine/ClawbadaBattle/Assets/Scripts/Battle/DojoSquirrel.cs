using System.Collections;
using UnityEngine;

/// <summary>
/// Replays Nzib's ninja squirrel on the Dojo arena (design/vfx-specials c7c9039, 2026-10-29): it runs across the stones
/// above the doorway, jumps, vanishes, and three leaves fall where it went into the tree — the Animator state
/// RunJumpVanish (3.5 s, plays once). His prefab plays it once on enable; this component owns the timing instead
/// (owner 2026-10-29): hidden until the battle's first turn (after the loading screens and the intro — IntroPlaying is
/// still false while the loading/training scene covers the arena, so it is not the signal), the first run 10–20 s
/// later, then a random 30–60 s gap after each run — like the gulls and the angler fish on the other arenas.
///
/// Deterministic per battle (seeded with the battle id, as BirdFlock), so a replay of the same battle shows the squirrel
/// at the same moments. The arena preview before a battle carries this too: it stays hidden until a battle exists.
///
/// Owner 2026-11-06: it must come out from behind the doorway's wooden frame and run on the stones, not appear in the
/// air over the lower stones by the frame. So it now sorts between the stones (BG_Ground) and the wall (BG_Dojo, whose
/// doorway is a hole): the frame hides it and the wall above the doorway takes its leap. Before his clip, a run-in
/// (his six-pose run cycle, his speed) brings it from behind the right post along the top of the stones — following
/// their height, lower by the post — to the clip's start; then the clip plays as authored (run, leap into the tree,
/// leaves).
/// </summary>
[RequireComponent(typeof(Animator))]
public class DojoSquirrel : MonoBehaviour
{
    public string stateName = "RunJumpVanish";
    [Tooltip("After the battle intro, before the first run (seconds).")]
    public float firstDelayMin = 10f;
    public float firstDelayMax = 20f;
    [Tooltip("From the end of one run to the start of the next (seconds).")]
    public float gapMin = 30f;
    public float gapMax = 60f;
    [Tooltip("Non-empty: replaces the battle-id seed (probes).")]
    public string seedOverride;

    // Art geometry (640×360 layers centred at the origin, 64 px per unit): the doorway's right post starts at art x 416.
    private const float ArtPpu = 64f;
    private static float ArtX(float px) => (px - 320f) / ArtPpu;
    private static readonly float PostX = ArtX(416f);
    /// <summary>The stones' top (art row) under the squirrel, from art x 300 every 3 px: the highest stone within ±5 px of
    /// each point of BG_Ground.png, so the feet stay on the stones and never dip into the gaps between them. Row 66 at
    /// the clip's start (x 365); the lower stones by the post sit at 69–73 (owner 2026-11-06: no floating there).</summary>
    private const float StoneFromX = 300f, StoneStep = 3f, HomeFeetRow = 66f;
    // The post stretch reads 3 px lower than the colour scan finds (checked against a filmed run, 2026-11-06).
    private static readonly float[] StoneTop = {
        65, 65, 66, 65, 65, 64, 64, 64, 64, 64, 64, 66, 65, 65, 65, 65, 65, 65, 66, 66, 66, 66, 66, 66, 64, 63, 63, 63, 63, 63, 64, 67, 71, 73, 73, 73, 73, 73, 73, 75, 76, 76, 75, 73, 72, 72, 72, 72, 72, 73, 75 };
    /// <summary>His run: Visual moves 0.625 u/s; six poses of 0.1 s.</summary>
    private const float RunSpeed = 0.625f, RunCycle = 0.6f;
    /// <summary>Half the squirrel's drawn width (32 px of its 64-px frame) plus a margin: fully behind the post at the start.</summary>
    private const float HalfBody = 16f / ArtPpu + 0.06f;

    private Animator anim;
    private int stateHash;
    private Transform visual;
    private Vector3 home;
    private bool sorted;
    private BattleManager manager;
    private bool battleUnderway;
    private void OnTurnStarted(TurnStartData _, int __) { battleUnderway = true; }

    private void Awake()
    {
        anim = GetComponent<Animator>();
        stateHash = Animator.StringToHash(stateName);
        visual = transform.Find("Visual");
        home = transform.localPosition;
        PutBehindTheWall();
    }

    /// <summary>Sort the squirrel (and its leaves) just above the stones and below the wall: everything in the arena at or
    /// above the wall's order moves up one, and the squirrel takes the wall's old order.</summary>
    private void PutBehindTheWall()
    {
        if (sorted) return;
        var arena = transform.parent;
        if (arena == null) return;
        SpriteRenderer ground = null, wall = null;
        var all = arena.GetComponentsInChildren<SpriteRenderer>(true);
        foreach (var sr in all)
        {
            if (sr.transform.IsChildOf(transform)) continue;
            if (sr.name == "BG_Ground") ground = sr;
            else if (sr.name == "BG_Dojo") wall = sr;
        }
        if (ground == null || wall == null) { Debug.LogWarning("[DojoSquirrel] no BG_Ground / BG_Dojo beside it — sorting unchanged"); return; }
        int order = wall.sortingOrder;
        foreach (var sr in all)
            if (!sr.transform.IsChildOf(transform) && sr.sortingLayerID == wall.sortingLayerID && sr.sortingOrder >= order) sr.sortingOrder += 1;
        foreach (var sr in GetComponentsInChildren<SpriteRenderer>(true)) { sr.sortingLayerID = wall.sortingLayerID; sr.sortingOrder = order; }
        sorted = true;
        Debug.Log($"[DojoSquirrel] sorted between the stones ({ground.sortingOrder}) and the wall ({wall.sortingOrder}) at {order}");
    }

    /// <summary>How far (world units) the stones' top at world x is above the clip's start height (negative = lower).</summary>
    private static float StoneOffset(float x)
    {
        float i = Mathf.Clamp((x * ArtPpu + 320f - StoneFromX) / StoneStep, 0f, StoneTop.Length - 1);
        int a = Mathf.FloorToInt(i), b = Mathf.Min(a + 1, StoneTop.Length - 1);
        float row = Mathf.Lerp(StoneTop[a], StoneTop[b], i - a);
        return (HomeFeetRow - row) / ArtPpu;
    }

    /// <summary>From behind the right post to the clip's start, in his run cycle; then the clip takes over at home.</summary>
    private IEnumerator RunIn(float clipLength)
    {
        float startX = PostX + HalfBody;
        float dist = startX - home.x;
        if (dist <= 0f || clipLength <= 0f) yield break;
        float dur = dist / RunSpeed;
        anim.speed = 0f;
        for (float t = 0f; t < dur; t += Time.deltaTime)
        {
            float x = startX - RunSpeed * t;
            anim.Play(stateHash, 0, (t % RunCycle) / clipLength);
            anim.Update(0f);
            float vx = visual != null ? visual.localPosition.x : 0f;
            transform.localPosition = new Vector3(x - vx, home.y + StoneOffset(x), home.z);
            yield return null;
        }
        transform.localPosition = home;
        anim.speed = 1f;
    }

    private void OnEnable()
    {
        if (!Application.isPlaying || anim == null) return;
        HideNow();
        StartCoroutine(Loop());
    }

    private void OnDisable()
    {
        StopAllCoroutines();
        if (anim != null) anim.speed = 1f;
        transform.localPosition = home;
        if (manager != null) manager.TurnStarted -= OnTurnStarted;
    }

    /// <summary>Jump to the end of the sequence: squirrel and leaves hidden (the clip's last frame).</summary>
    private void HideNow()
    {
        anim.Play(stateHash, 0, 1f);
        anim.Update(0f);
    }

    private IEnumerator Loop()
    {
        manager = FindAnyObjectByType<BattleManager>();
        while (manager == null || manager.InitData == null)
        {
            yield return new WaitForSeconds(0.5f);
            if (manager == null) manager = FindAnyObjectByType<BattleManager>();
        }
        battleUnderway = false;
        manager.TurnStarted += OnTurnStarted;
        while (!battleUnderway) yield return null;   // the first turn: the arena is on screen and the intro is done

        string battleId = manager.InitData.battleId;
        string seedKey = !string.IsNullOrEmpty(seedOverride) ? seedOverride
            : !string.IsNullOrEmpty(battleId) ? battleId : "nobattle|" + System.Environment.TickCount;
        var rng = new System.Random(unchecked((int)ObstacleLayoutGenerator.Fnv1a("squirrel|" + seedKey)));
        float Range(float a, float b) => a + (float)rng.NextDouble() * (b - a);

        float clip = ClipLength();
        float wait = Range(firstDelayMin, firstDelayMax);
        int run = 0;
        while (true)
        {
            yield return new WaitForSeconds(wait);
            run++;
            Debug.Log($"[DojoSquirrel] run {run} (after {wait:0.0} s)");
            yield return RunIn(clip);
            anim.Play(stateHash, 0, 0f);
            yield return new WaitForSeconds(clip);
            wait = Range(gapMin, gapMax);
        }
    }

    private float ClipLength()
    {
        var controller = anim.runtimeAnimatorController;
        if (controller != null)
            foreach (var c in controller.animationClips)
                if (c != null && c.length > 0f) return c.length;
        return 3.5f;
    }
}
