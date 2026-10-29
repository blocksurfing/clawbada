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

    private Animator anim;
    private int stateHash;
    private BattleManager manager;
    private bool battleUnderway;
    private void OnTurnStarted(TurnStartData _, int __) { battleUnderway = true; }

    private void Awake()
    {
        anim = GetComponent<Animator>();
        stateHash = Animator.StringToHash(stateName);
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
