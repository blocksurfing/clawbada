using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks the seagull flock without a scene: the planner's guarantees over many seeds (the designer's
/// rules — balanced sides, one bird per rock, departures in sequence), the default perch table, and
/// what BirdFlockInstaller wrote into ArenaArt_Evolved.prefab (and that running it again changes nothing).
/// Menu: Clawbada ▸ Verify Bird Flock. Headless:
///   Unity -batchmode -nographics -quit -executeMethod BirdFlockSmokeTest.Run
/// Throws on any violated guard so batch exits non-zero.
/// </summary>
public static class BirdFlockSmokeTest
{
    [MenuItem("Clawbada/Verify Bird Flock")]
    public static void Run()
    {
        var perches = BirdFlock.DefaultPerches();
        int plans = CheckPlanner(perches);
        CheckPerchTable(perches);
        CheckClamp(perches);
        CheckInstalledPrefab();
        string msg = $"[BirdFlockSmokeTest] OK — {plans} plans over n=3..5, perch table sane, prefab installed and idempotent.";
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }

    private static int CheckPlanner(List<BirdPerch> perches)
    {
        int enabled = 0;
        foreach (var p in perches) if (!p.disabled) enabled++;
        int plans = 0;
        for (int n = 3; n <= 5; n++)
        {
            foreach (bool nearest in new[] { false, true })
            {
                var cfg = new BirdFlockConfig { minBirds = n, maxBirds = n, exitNearestEdge = nearest };
                for (int i = 0; i < 300; i++)
                {
                    uint seed = ObstacleLayoutGenerator.Fnv1a($"birds|p_{i}|evolved|{n}|{nearest}");
                    var a = BirdFlockPlanner.Plan(seed, perches, cfg);
                    var b = BirdFlockPlanner.Plan(seed, perches, cfg);
                    string ka = a.Key(), kb = b.Key();
                    if (ka != kb) throw new Exception($"Non-deterministic plan for seed {seed}: {ka} vs {kb}");
                    int expected = Math.Min(n, enabled);
                    if (a.birds.Length != expected) throw new Exception($"n={n}: planned {a.birds.Length} birds, expected {expected} ({ka})");

                    int right = 0, left = 0;
                    var used = new HashSet<int>();
                    var free = new List<int>();
                    for (int k = 0; k < perches.Count; k++) if (!perches[k].disabled) free.Add(k);
                    float lastArrival = -1f;
                    for (int k = 0; k < a.birds.Length; k++)
                    {
                        var bird = a.birds[k];
                        if (bird.entrySide == 1) right++; else if (bird.entrySide == -1) left++; else throw new Exception($"entry side {bird.entrySide} ({ka})");
                        if (!used.Add(bird.perch)) throw new Exception($"perch {bird.perch} used twice ({ka})");
                        if (perches[bird.perch].disabled) throw new Exception($"disabled perch {bird.perch} used ({ka})");
                        // Same-side preference: a free perch on the entry side at this bird's turn must have been taken.
                        bool sameSideFree = false;
                        foreach (int f in free) if (perches[f].Side == bird.entrySide) { sameSideFree = true; break; }
                        if (sameSideFree && perches[bird.perch].Side != bird.entrySide)
                            throw new Exception($"bird {k} crossed although a same-side perch was free ({ka})");
                        free.Remove(bird.perch);
                        if (bird.arrivalDelay < lastArrival) throw new Exception($"arrival delays not monotone ({ka})");
                        if (k == 0 && bird.arrivalDelay != 0f) throw new Exception($"first arrival delay {bird.arrivalDelay} ({ka})");
                        lastArrival = bird.arrivalDelay;
                        if (bird.cruiseY > cfg.cruiseMaxY + 1e-5f) throw new Exception($"cruise {bird.cruiseY} above cap ({ka})");
                        if (bird.cruiseY < perches[bird.perch].y) throw new Exception($"cruise below the perch ({ka})");
                        if (bird.exitSide != 1 && bird.exitSide != -1) throw new Exception($"exit side {bird.exitSide} ({ka})");
                        if (nearest && bird.exitSide != perches[bird.perch].Side) throw new Exception($"nearest-edge exit wrong ({ka})");
                        if (!nearest && bird.exitSide != a.exitSide) throw new Exception($"flock exit side not shared ({ka})");
                    }
                    if (Math.Abs(right - left) > 1) throw new Exception($"sides {right}:{left} unbalanced ({ka})");
                    if (n == 3 && !((right == 2 && left == 1) || (right == 1 && left == 2))) throw new Exception($"n=3 must split 2:1 ({ka})");

                    // Departure: a permutation with non-decreasing cumulative delays.
                    var seen = new bool[a.birds.Length];
                    var byOrder = new BirdPlan[a.birds.Length];
                    foreach (var bird in a.birds)
                    {
                        if (bird.departOrder < 0 || bird.departOrder >= a.birds.Length || seen[bird.departOrder]) throw new Exception($"departure order not a permutation ({ka})");
                        seen[bird.departOrder] = true;
                        byOrder[bird.departOrder] = bird;
                    }
                    float lastDepart = -1f;
                    for (int j = 0; j < byOrder.Length; j++)
                    {
                        if (j == 0 && byOrder[j].departDelay != 0f) throw new Exception($"first departure delay {byOrder[j].departDelay} ({ka})");
                        if (j > 0 && byOrder[j].departDelay <= byOrder[j - 1].departDelay) throw new Exception($"departures not in sequence ({ka})");
                        lastDepart = byOrder[j].departDelay;
                    }
                    if (a.dwellSeconds < cfg.dwellMin || a.dwellSeconds > cfg.dwellMax) throw new Exception($"dwell {a.dwellSeconds} out of range ({ka})");
                    plans++;
                }
            }
        }
        return plans;
    }

    private static void CheckPerchTable(List<BirdPerch> perches)
    {
        for (int i = 0; i < perches.Count; i++)
        {
            var p = perches[i];
            if (string.IsNullOrEmpty(p.id)) throw new Exception($"perch {i} has no id");
            if (p.disabled) continue;
            if (p.y < 1.6f || p.y > 2.5f) throw new Exception($"perch {p.id} y={p.y} outside the rock band 1.6..2.5");
            if (Mathf.Abs(p.x) + p.walkHalfWidth > 4.75f) throw new Exception($"perch {p.id} reaches the frame edge");
            for (int j = i + 1; j < perches.Count; j++)
            {
                var q = perches[j];
                if (q.disabled) continue;
                float gap = Mathf.Abs(p.x - q.x) - p.walkHalfWidth - q.walkHalfWidth;
                if (gap < 0.45f) throw new Exception($"perches {p.id} and {q.id} too close ({gap:F2} < 0.45 after walk spans)");
            }
        }
    }

    /// <summary>With only two perches usable, a flock of three shrinks to two; with none, to zero.</summary>
    private static void CheckClamp(List<BirdPerch> perches)
    {
        var two = new List<BirdPerch>();
        int kept = 0;
        foreach (var p in perches) { var c = p; c.disabled = p.disabled || kept >= 2; if (!c.disabled) kept++; two.Add(c); }
        var cfg = new BirdFlockConfig { minBirds = 3, maxBirds = 3 };
        var plan = BirdFlockPlanner.Plan(123u, two, cfg);
        if (plan.birds.Length != 2) throw new Exception($"clamp: planned {plan.birds.Length} birds with 2 perches");
        var none = new List<BirdPerch>();
        foreach (var p in perches) { var c = p; c.disabled = true; none.Add(c); }
        if (BirdFlockPlanner.Plan(123u, none, cfg).birds.Length != 0) throw new Exception("clamp: planned birds with no perches");
        if (BirdFlockPlanner.Plan(123u, perches, new BirdFlockConfig { minBirds = 0, maxBirds = 0 }).birds.Length != 0) throw new Exception("clamp: maxBirds 0 planned birds");
    }

    private static void CheckInstalledPrefab()
    {
        var arena = AssetDatabase.LoadAssetAtPath<GameObject>(BirdFlockInstaller.ArenaPrefabPath);
        if (arena == null) throw new Exception($"{BirdFlockInstaller.ArenaPrefabPath} missing");
        var birds = arena.transform.Find(BirdFlock.ChildName);
        if (birds == null) throw new Exception("ArenaArt_Evolved has no Birds child — run BirdFlockInstaller.Install");
        if (birds.localPosition != Vector3.zero) throw new Exception("Birds child is not at local zero");
        var flock = birds.GetComponent<BirdFlock>();
        if (flock == null) throw new Exception("Birds child has no BirdFlock component");
        var bird = AssetDatabase.LoadAssetAtPath<GameObject>(BirdFlockInstaller.BirdPrefabPath);
        if (flock.birdPrefab != bird) throw new Exception("BirdFlock.birdPrefab is not Bird.prefab");
        if (flock.perches == null || flock.perches.Count == 0) throw new Exception("BirdFlock has no perches");
        int enabled = 0;
        foreach (var p in flock.perches) if (!p.disabled) enabled++;
        if (enabled < 3) throw new Exception($"only {enabled} perches enabled — a flock of three cannot land");
        BirdFlockInstaller.ValidateBird(bird);

        byte[] before = File.ReadAllBytes(BirdFlockInstaller.ArenaPrefabPath);
        bool changed = BirdFlockInstaller.Install(false);
        byte[] after = File.ReadAllBytes(BirdFlockInstaller.ArenaPrefabPath);
        if (changed) throw new Exception("installer reported a change on a second run");
        if (before.Length != after.Length) throw new Exception("installer rewrote the prefab on a second run");
        for (int i = 0; i < before.Length; i++) if (before[i] != after[i]) throw new Exception("installer rewrote the prefab on a second run");
    }
}
