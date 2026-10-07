using System;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks the drift clouds without a scene: the planner's guarantees over many seeds (Nzib's rules — random
/// variants, slow, one wind per battle, 2–3 clouds, lanes inside the sky band and never below the sea's
/// horizon or above the frame for the variant's height, respawn gaps in range, deterministic), the designer's
/// six assets, and what CloudDriftInstaller wrote into ArenaArt_Evolved.prefab (and that running it again
/// changes nothing; his Static_Clouds layer and the Birds child are still there).
/// Menu: Clawbada ▸ Verify Drift Clouds. Headless:
///   Unity -batchmode -nographics -quit -executeMethod CloudDriftSmokeTest.Run
/// Throws on any violated guard so batch exits non-zero.
/// </summary>
public static class CloudDriftSmokeTest
{
    [MenuItem("Clawbada/Verify Drift Clouds")]
    public static void Run()
    {
        int plans = CheckPlanner();
        CheckInstalledPrefab();
        string msg = $"[CloudDriftSmokeTest] OK — {plans} plans (2–3 clouds, both winds, all six variants, lanes in the sky band and clear of the horizon/frame, slow, deterministic), assets valid, prefab installed and idempotent.";
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }

    private static int CheckPlanner()
    {
        var cfg = new CloudDriftConfig();
        float yLo = Mathf.Min(cfg.laneYMin, cfg.laneYMax), yHi = Mathf.Max(cfg.laneYMin, cfg.laneYMax);
        // The sky: the Sea band tops out at 2.125 and the frame at 2.8125; the biggest cloud is 0.42 u tall.
        if (cfg.horizonY < 2.125f) throw new Exception($"horizonY {cfg.horizonY} is inside the animated Sea band (top 2.125)");
        if (cfg.frameTopY > 2.8125f + 1e-4f) throw new Exception($"frameTopY {cfg.frameTopY} is above the frame");
        if (yLo < cfg.horizonY || yHi > cfg.frameTopY) throw new Exception($"default lane band [{yLo},{yHi}] leaves the sky ({cfg.horizonY}..{cfg.frameTopY})");
        if (cfg.speedMax > 0.12f) throw new Exception($"speedMax {cfg.speedMax} u/s is not \"slow\" (a crossing under ~80 s)");

        int plans = 0, windL = 0, windR = 0;
        var variants = new bool[CloudDriftPlanner.VariantCount];
        var counts = new bool[8];
        for (int i = 0; i < 1000; i++)
        {
            uint seed = ObstacleLayoutGenerator.Fnv1a($"cloud|p_{i}|evolved");
            var a = CloudDriftPlanner.Plan(seed, cfg);
            var b = CloudDriftPlanner.Plan(seed, cfg);
            string ka = a.Key(), kb = b.Key();
            if (ka != kb) throw new Exception($"Non-deterministic plan for seed {seed}: {ka} vs {kb}");
            if (a.windDir != 1 && a.windDir != -1) throw new Exception($"wind {a.windDir} ({ka})");
            if (a.windDir > 0) windR++; else windL++;
            int n = a.first.Length;
            if (n < cfg.minClouds || n > cfg.maxClouds) throw new Exception($"{n} clouds; the config says {cfg.minClouds}–{cfg.maxClouds} ({ka})");
            counts[n] = true;
            for (int s = 0; s < n; s++)
            {
                var c = a.first[s];
                if (c.cloudIndex != s || c.passIndex != 0) throw new Exception($"first pass indexes {c.cloudIndex}/{c.passIndex} ({ka})");
                if (!c.StartsInView) throw new Exception($"first pass of slot {s} does not start in view ({ka})");
                if (Mathf.Abs(c.startFraction) > cfg.firstPassViewFraction + 1e-4f) throw new Exception($"start fraction {c.startFraction} ({ka})");
                if (c.delay != 0f) throw new Exception($"first pass delayed {c.delay} s ({ka})");
                Check(c, cfg, yLo, yHi, ka);
                variants[c.variant] = true;
                for (int k = 1; k <= 3; k++)
                {
                    var later = CloudDriftPlanner.PlanPass(seed, s, k, cfg);
                    var again = CloudDriftPlanner.PlanPass(seed, s, k, cfg);
                    if (later.Key() != again.Key()) throw new Exception($"Non-deterministic pass {k} of slot {s} for seed {seed}");
                    if (later.StartsInView) throw new Exception($"pass {k} of slot {s} starts in view; only the first may ({later.Key()})");
                    if (later.delay < cfg.respawnGapMin - 1e-4f || later.delay > cfg.respawnGapMax + 1e-4f) throw new Exception($"respawn gap {later.delay} outside [{cfg.respawnGapMin},{cfg.respawnGapMax}] ({later.Key()})");
                    Check(later, cfg, yLo, yHi, later.Key());
                    variants[later.variant] = true;
                }
            }
            plans++;
        }
        if (windL == 0 || windR == 0) throw new Exception($"wind over 1000 plans: {windL} R→L, {windR} L→R — the direction is not randomized");
        for (int n = cfg.minClouds; n <= cfg.maxClouds; n++) if (!counts[n]) throw new Exception($"over 1000 plans a sky of {n} clouds never happened");
        for (int v = 0; v < variants.Length; v++) if (!variants[v]) throw new Exception($"variant {v + 1} never picked over 1000 plans — Nzib's variations are not all used");
        return plans;
    }

    private static void Check(CloudPass c, CloudDriftConfig cfg, float yLo, float yHi, string key)
    {
        if (c.variant < 0 || c.variant >= CloudDriftPlanner.VariantCount) throw new Exception($"variant {c.variant} ({key})");
        float half = CloudDriftPlanner.HalfHeight(c.variant);
        if (c.laneY < yLo - 1e-4f || c.laneY > yHi + 1e-4f) throw new Exception($"lane y {c.laneY} outside [{yLo},{yHi}] ({key})");
        if (c.laneY - half < cfg.horizonY - 1e-4f) throw new Exception($"variant {c.variant + 1} at y {c.laneY} dips below the horizon {cfg.horizonY} ({key})");
        if (c.laneY + half > cfg.frameTopY + 1e-4f) throw new Exception($"variant {c.variant + 1} at y {c.laneY} pokes above the frame {cfg.frameTopY} ({key})");
        if (c.speed < cfg.speedMin - 1e-4f || c.speed > cfg.speedMax + 1e-4f) throw new Exception($"speed {c.speed} outside the config ({key})");
        if (c.bobPeriod < cfg.bobPeriodMin - 1e-4f || c.bobPeriod > cfg.bobPeriodMax + 1e-4f) throw new Exception($"bob period {c.bobPeriod} outside the config ({key})");
    }

    private static void CheckInstalledPrefab()
    {
        var arena = AssetDatabase.LoadAssetAtPath<GameObject>(CloudDriftInstaller.ArenaPrefabPath);
        if (arena == null) throw new Exception($"{CloudDriftInstaller.ArenaPrefabPath} missing");
        var child = arena.transform.Find(CloudDrift.ChildName);
        if (child == null) throw new Exception("ArenaArt_Evolved has no Clouds child — run CloudDriftInstaller.Install");
        if (child.localPosition != Vector3.zero) throw new Exception("Clouds child is not at local zero");
        var drift = child.GetComponent<CloudDrift>();
        if (drift == null) throw new Exception("Clouds child has no CloudDrift component");
        var clouds = CloudDriftInstaller.LoadClouds();
        if (drift.cloudPrefabs == null || drift.cloudPrefabs.Count != clouds.Length) throw new Exception($"CloudDrift references {(drift.cloudPrefabs == null ? 0 : drift.cloudPrefabs.Count)} prefabs, expected {clouds.Length}");
        for (int i = 0; i < clouds.Length; i++) if (drift.cloudPrefabs[i] != clouds[i]) throw new Exception($"CloudDrift.cloudPrefabs[{i}] is not Drift_Cloud_0{i + 1}");
        if (drift.config == null) throw new Exception("CloudDrift has no config");
        if (drift.sortingOrder != 1) throw new Exception($"CloudDrift.sortingOrder {drift.sortingOrder}: the clouds share Static_Clouds' order (Background/1)");
        if (drift.depthZ >= 0f) throw new Exception($"CloudDrift.depthZ {drift.depthZ}: must be negative so, at the same order, the drift clouds draw in front of Static_Clouds");

        // Nzib's layers and the gulls must still be there (the installer touches only the Clouds child).
        if (arena.transform.Find("Static_Clouds") == null) throw new Exception("ArenaArt_Evolved lost Nzib's Static_Clouds layer");
        if (arena.transform.Find(BirdFlock.ChildName) == null) throw new Exception("ArenaArt_Evolved lost the Birds child");
        var staticClouds = arena.transform.Find("Static_Clouds").GetComponent<SpriteRenderer>();
        if (staticClouds == null || staticClouds.sortingLayerName != "Background" || staticClouds.sortingOrder != 1)
            throw new Exception("Static_Clouds is no longer Background/1 — CloudDrift.depthZ reasoning assumes it");

        byte[] before = File.ReadAllBytes(CloudDriftInstaller.ArenaPrefabPath);
        bool changed = CloudDriftInstaller.InstallInto();
        byte[] after = File.ReadAllBytes(CloudDriftInstaller.ArenaPrefabPath);
        if (changed) throw new Exception("installer reported a change on a second run");
        if (before.Length != after.Length) throw new Exception("installer rewrote the prefab on a second run");
        for (int i = 0; i < before.Length; i++) if (before[i] != after[i]) throw new Exception("installer rewrote the prefab on a second run");
    }
}
