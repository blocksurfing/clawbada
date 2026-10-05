using System;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks the angler fish school without a scene: the planner's guarantees over many seeds (Nzib's rules —
/// 1–3 fish, random sides, lanes inside the open-water band, a turn only where it can be seen, respawn gaps
/// in range, deterministic), the designer's asset, and what AnglerSchoolInstaller wrote into
/// ArenaArt_Elite.prefab (and that running it again changes nothing).
/// Menu: Clawbada ▸ Verify Angler School. Headless:
///   Unity -batchmode -nographics -quit -executeMethod AnglerSchoolSmokeTest.Run
/// Throws on any violated guard so batch exits non-zero.
/// </summary>
public static class AnglerSchoolSmokeTest
{
    [MenuItem("Clawbada/Verify Angler School")]
    public static void Run()
    {
        int plans = CheckPlanner();
        CheckFixedCount();
        CheckInstalledPrefab();
        string msg = $"[AnglerSchoolSmokeTest] OK — {plans} plans (1–3 fish, every count seen, lanes in band, turns between the walls, deterministic), asset valid, prefab installed and idempotent.";
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }

    private static int CheckPlanner()
    {
        var cfg = new AnglerSchoolConfig();
        float yLo = Mathf.Min(cfg.laneYMin, cfg.laneYMax), yHi = Mathf.Max(cfg.laneYMin, cfg.laneYMax);
        // The open-water band above the Elite floor (Ground paints to 82 % → y 1.81; frame top 2.81; fish ~0.56 u tall).
        if (yLo < 1.81f + 0.28f || yHi > 2.8125f - 0.28f) throw new Exception($"default lane band [{yLo},{yHi}] leaves the open water (1.81..2.81) with a 0.56 u fish");
        if (cfg.turnHalfWidth > 2.2f) throw new Exception($"turnHalfWidth {cfg.turnHalfWidth} reaches the ruined walls (|x| ≳ 2.3) — a turn there is hidden");

        int plans = 0, left = 0, right = 0, turns = 0;
        var seen = new bool[4];
        for (int i = 0; i < 1000; i++)
        {
            uint seed = ObstacleLayoutGenerator.Fnv1a($"fish|p_{i}|elite");
            var a = AnglerSchoolPlanner.Plan(seed, cfg);
            var b = AnglerSchoolPlanner.Plan(seed, cfg);
            string ka = a.Key(), kb = b.Key();
            if (ka != kb) throw new Exception($"Non-deterministic plan for seed {seed}: {ka} vs {kb}");
            int n = a.first.Length;
            if (n < 1 || n > 3) throw new Exception($"school of {n} fish; Nzib's randomized quantity is 1–3 ({ka})");
            seen[n] = true;
            for (int f = 0; f < n; f++)
            {
                var c = a.first[f];
                if (c.fishIndex != f || c.crossingIndex != 0) throw new Exception($"first crossing indexes {c.fishIndex}/{c.crossingIndex} ({ka})");
                Check(c, cfg, yLo, yHi, 0f, cfg.startDelayMax, ka);
                if (c.entrySide > 0) right++; else left++;
                if (c.Turns) turns++;
                for (int k = 1; k <= 3; k++)
                {
                    var later = AnglerSchoolPlanner.PlanCrossing(seed, f, k, cfg);
                    var again = AnglerSchoolPlanner.PlanCrossing(seed, f, k, cfg);
                    if (later.Key() != again.Key()) throw new Exception($"Non-deterministic crossing {k} of fish {f} for seed {seed}");
                    Check(later, cfg, yLo, yHi, cfg.respawnGapMin, cfg.respawnGapMax, later.Key());
                }
            }
            plans++;
        }
        if (!seen[1] || !seen[2] || !seen[3]) throw new Exception($"over 1000 plans the counts seen were 1:{seen[1]} 2:{seen[2]} 3:{seen[3]} — the quantity is not randomized");
        if (left == 0 || right == 0) throw new Exception($"entry sides over 1000 plans: {left} left, {right} right — the direction is not randomized");
        if (turns == 0) throw new Exception("no crossing ever turns");
        return plans;
    }

    private static void Check(FishCrossing c, AnglerSchoolConfig cfg, float yLo, float yHi, float delayLo, float delayHi, string key)
    {
        if (c.entrySide != 1 && c.entrySide != -1) throw new Exception($"entry side {c.entrySide} ({key})");
        if (c.laneY < yLo - 1e-4f || c.laneY > yHi + 1e-4f) throw new Exception($"lane y {c.laneY} outside [{yLo},{yHi}] ({key})");
        if (c.speed < cfg.speedMin - 1e-4f || c.speed > cfg.speedMax + 1e-4f) throw new Exception($"speed {c.speed} outside the config ({key})");
        if (c.scale < cfg.scaleMin - 1e-4f || c.scale > cfg.scaleMax + 1e-4f) throw new Exception($"scale {c.scale} outside the config ({key})");
        if (c.Turns && Mathf.Abs(c.turnAtX) > cfg.turnHalfWidth + 1e-4f) throw new Exception($"turn at x={c.turnAtX} is outside the visible middle ±{cfg.turnHalfWidth} ({key})");
        if (c.delay < delayLo - 1e-4f || c.delay > delayHi + 1e-4f) throw new Exception($"delay {c.delay} outside [{delayLo},{delayHi}] ({key})");
        if (c.bobPeriod < cfg.bobPeriodMin - 1e-4f || c.bobPeriod > cfg.bobPeriodMax + 1e-4f) throw new Exception($"bob period {c.bobPeriod} outside the config ({key})");
    }

    /// <summary>A designer who pins minFish = maxFish gets exactly that many, every battle.</summary>
    private static void CheckFixedCount()
    {
        for (int n = 1; n <= 3; n++)
        {
            var cfg = new AnglerSchoolConfig { minFish = n, maxFish = n };
            for (int i = 0; i < 50; i++)
            {
                var p = AnglerSchoolPlanner.Plan(ObstacleLayoutGenerator.Fnv1a($"fish|fixed{n}|{i}"), cfg);
                if (p.first.Length != n) throw new Exception($"minFish = maxFish = {n} planned {p.first.Length} fish");
            }
        }
    }

    private static void CheckInstalledPrefab()
    {
        var arena = AssetDatabase.LoadAssetAtPath<GameObject>(AnglerSchoolInstaller.ArenaPrefabPath);
        if (arena == null) throw new Exception($"{AnglerSchoolInstaller.ArenaPrefabPath} missing");
        var child = arena.transform.Find(AnglerSchool.ChildName);
        if (child == null) throw new Exception("ArenaArt_Elite has no Fish child — run AnglerSchoolInstaller.Install");
        if (child.localPosition != Vector3.zero) throw new Exception("Fish child is not at local zero");
        var school = child.GetComponent<AnglerSchool>();
        if (school == null) throw new Exception("Fish child has no AnglerSchool component");
        var fish = AssetDatabase.LoadAssetAtPath<GameObject>(AnglerSchoolInstaller.FishPrefabPath);
        if (school.fishPrefab != fish) throw new Exception("AnglerSchool.fishPrefab is not AnglerFish.prefab");
        if (school.config == null) throw new Exception("AnglerSchool has no config");
        if (school.sortingOrder < 1 || school.sortingOrder > 3) throw new Exception($"AnglerSchool.sortingOrder {school.sortingOrder}: the fish must stay between the water (Background/1) and the floor");
        AnglerSchoolInstaller.ValidateFish(fish);

        // Nzib's seaweed placements must still be there (the installer touches only the Fish child).
        int seaweed = 0;
        foreach (var t in arena.GetComponentsInChildren<Transform>(true)) if (t.name.StartsWith("Seaweed") || t.name.StartsWith("FG_Seaweed")) seaweed++;
        if (seaweed < 9) throw new Exception($"only {seaweed} seaweed instances in ArenaArt_Elite — Nzib placed 9 (4 Seaweed + 5 FG_Seaweed)");

        byte[] before = File.ReadAllBytes(AnglerSchoolInstaller.ArenaPrefabPath);
        bool changed = AnglerSchoolInstaller.InstallInto();
        byte[] after = File.ReadAllBytes(AnglerSchoolInstaller.ArenaPrefabPath);
        if (changed) throw new Exception("installer reported a change on a second run");
        if (before.Length != after.Length) throw new Exception("installer rewrote the prefab on a second run");
        for (int i = 0; i < before.Length; i++) if (before[i] != after[i]) throw new Exception("installer rewrote the prefab on a second run");
    }
}
