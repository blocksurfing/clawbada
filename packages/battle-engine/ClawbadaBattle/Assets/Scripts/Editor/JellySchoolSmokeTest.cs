using System;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks the jellyfish school without a scene: the planner's guarantees over many seeds (Nzib's rules —
/// groups of 1–3 and never more, one heading per group with no turn, members surface at the floor line
/// between the walls and leave above the frame still in front of the walls, slow, gaps in range,
/// deterministic), the designer's asset, and what JellySchoolInstaller wrote into ArenaArt_Elite.prefab
/// (and that running it again changes nothing; his BG - 2.1 layer, the Fish child and the seaweed are still
/// there).
/// Menu: Clawbada ▸ Verify Jellyfish. Headless:
///   Unity -batchmode -nographics -quit -executeMethod JellySchoolSmokeTest.Run
/// Throws on any violated guard so batch exits non-zero.
/// </summary>
public static class JellySchoolSmokeTest
{
    [MenuItem("Clawbada/Verify Jellyfish")]
    public static void Run()
    {
        int groups = CheckPlanner();
        CheckFixedCount();
        CheckInstalledPrefab();
        string msg = $"[JellySchoolSmokeTest] OK — {groups} groups (1–3 jellyfish, every count seen, both headings, surfacing at the floor line in the player's window, leaving inside it, slow, deterministic), asset valid, prefab installed and idempotent.";
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }

    private static int CheckPlanner()
    {
        var cfg = new JellySchoolConfig();
        // The Elite floor plate is painted from y ≈ 1.72 down; a 0.5 u jellyfish centred at 2.0 just touches it.
        if (cfg.spawnY < 1.72f + 0.25f - 1e-3f) throw new Exception($"spawnY {cfg.spawnY} puts the jellyfish over the floor plate (edge ≈ 1.72, half-height 0.25)");
        if (cfg.exitY < 2.8125f + 0.25f) throw new Exception($"exitY {cfg.exitY} is not past the frame top (2.8125) plus a half-height");
        float xMin = Mathf.Min(cfg.visibleXMin, cfg.visibleXMax), xMax = Mathf.Max(cfg.visibleXMin, cfg.visibleXMax);
        // The player's window on the water: the left wall (≈ −2.3) and the opponent's HUD panels (≈ +0.2), less a half-width.
        if (xMin < -2.05f) throw new Exception($"visibleXMin {xMin} reaches the left ruined wall (x ≲ −2.3 with a 0.3 half-width)");
        if (xMax > -0.05f) throw new Exception($"visibleXMax {xMax} reaches the opponent's HUD panels (x ≳ +0.2 with a 0.3 half-width)");
        if (cfg.spawnXCenter - cfg.spawnXHalfWidth - cfg.memberXSpread < xMin - 1e-4f || cfg.spawnXCenter + cfg.spawnXHalfWidth + cfg.memberXSpread > xMax + 1e-4f)
            throw new Exception("members can surface outside the visible window");
        if (cfg.riseSpeedMax > 0.25f) throw new Exception($"riseSpeedMax {cfg.riseSpeedMax} u/s is not a jellyfish's drift");

        int groups = 0, left = 0, right = 0, steep = 0;
        var seen = new bool[4];
        for (int i = 0; i < 1000; i++)
        {
            uint seed = ObstacleLayoutGenerator.Fnv1a($"jelly|p_{i}|elite");
            for (int g = 0; g < 3; g++)
            {
                var a = JellySchoolPlanner.PlanGroup(seed, g, cfg);
                var b = JellySchoolPlanner.PlanGroup(seed, g, cfg);
                string ka = a.Key(), kb = b.Key();
                if (ka != kb) throw new Exception($"Non-deterministic group {g} for seed {seed}: {ka} vs {kb}");
                int n = a.members.Length;
                if (n < 1 || n > 3) throw new Exception($"group of {n}; Nzib said 3 max ({ka})");
                seen[n] = true;
                if (a.dir != 1 && a.dir != -1) throw new Exception($"heading {a.dir} ({ka})");
                if (a.dir > 0) right++; else left++;
                if (Mathf.Abs(a.baseX - cfg.spawnXCenter) > cfg.spawnXHalfWidth + 1e-4f) throw new Exception($"base x {a.baseX} outside {cfg.spawnXCenter} ± {cfg.spawnXHalfWidth} ({ka})");
                float dLo = g == 0 ? cfg.firstGroupDelayMin : cfg.groupGapMin, dHi = g == 0 ? cfg.firstGroupDelayMax : cfg.groupGapMax;
                if (a.delay < dLo - 1e-4f || a.delay > dHi + 1e-4f) throw new Exception($"group delay {a.delay} outside [{dLo},{dHi}] ({ka})");
                for (int m = 0; m < n; m++)
                {
                    var r = a.members[m];
                    if (r.groupIndex != g || r.memberIndex != m) throw new Exception($"member indexes {r.groupIndex}/{r.memberIndex} ({ka})");
                    if (Mathf.Abs(r.startX - a.baseX) > cfg.memberXSpread + 1e-4f) throw new Exception($"member x {r.startX} strays from base {a.baseX} ({ka})");
                    if (!JellySchoolPlanner.Fits(r.startX, cfg)) throw new Exception($"member surfaces at x {r.startX}, outside the visible window ({ka})");
                    float vLo = cfg.riseSpeedMin * (1f - cfg.memberSpeedJitter), vHi = cfg.riseSpeedMax * (1f + cfg.memberSpeedJitter);
                    if (r.riseSpeed < vLo - 1e-4f || r.riseSpeed > vHi + 1e-4f) throw new Exception($"rise speed {r.riseSpeed} outside [{vLo},{vHi}] ({ka})");
                    if (Mathf.Sign(r.drift) != a.dir) throw new Exception($"member drifts {r.drift} against the group's heading {a.dir} — a turn ({ka})");
                    float ratio = Mathf.Abs(r.drift) / r.riseSpeed;
                    // Capped by the room in the window on the chosen side; never steeper than the config.
                    if (ratio < -1e-3f || ratio > cfg.driftRatioMax + 1e-3f) throw new Exception($"drift ratio {ratio} outside [0,{cfg.driftRatioMax}] ({ka})");
                    if (ratio > 1e-3f) steep++;
                    float exitX = JellySchoolPlanner.ExitX(r, cfg);
                    if (!JellySchoolPlanner.Fits(exitX, cfg)) throw new Exception($"member leaves at x {exitX}, outside the visible window (under the HUD or behind the wall) ({ka})");
                    if (r.scale < cfg.scaleMin - 1e-4f || r.scale > cfg.scaleMax + 1e-4f) throw new Exception($"scale {r.scale} outside the config ({ka})");
                    if (r.delay < 0f || r.delay > cfg.memberDelayMax + 1e-4f) throw new Exception($"member delay {r.delay} outside [0,{cfg.memberDelayMax}] ({ka})");
                    if (m == 0 && r.delay != 0f) throw new Exception($"the first member waits {r.delay} s ({ka})");
                }
                groups++;
            }
        }
        if (!seen[1] || !seen[2] || !seen[3]) throw new Exception($"over 3000 groups the counts seen were 1:{seen[1]} 2:{seen[2]} 3:{seen[3]} — the quantity is not randomized");
        if (left == 0 || right == 0) throw new Exception($"headings over 3000 groups: {left} left, {right} right — the direction is not randomized");
        if (steep == 0) throw new Exception("no member ever rose on a diagonal — the window cap zeroed every drift");
        return groups;
    }

    /// <summary>A designer who pins minJellies = maxJellies gets exactly that many, every group.</summary>
    private static void CheckFixedCount()
    {
        for (int n = 1; n <= 3; n++)
        {
            var cfg = new JellySchoolConfig { minJellies = n, maxJellies = n };
            for (int i = 0; i < 50; i++)
            {
                var g = JellySchoolPlanner.PlanGroup(ObstacleLayoutGenerator.Fnv1a($"jelly|fixed{n}|{i}"), 0, cfg);
                if (g.members.Length != n) throw new Exception($"minJellies = maxJellies = {n} planned {g.members.Length} jellyfish");
            }
        }
    }

    private static void CheckInstalledPrefab()
    {
        var arena = AssetDatabase.LoadAssetAtPath<GameObject>(JellySchoolInstaller.ArenaPrefabPath);
        if (arena == null) throw new Exception($"{JellySchoolInstaller.ArenaPrefabPath} missing");
        var child = arena.transform.Find(JellySchool.ChildName);
        if (child == null) throw new Exception("ArenaArt_Elite has no Jellies child — run JellySchoolInstaller.Install");
        if (child.localPosition != Vector3.zero) throw new Exception("Jellies child is not at local zero");
        var school = child.GetComponent<JellySchool>();
        if (school == null) throw new Exception("Jellies child has no JellySchool component");
        var jelly = AssetDatabase.LoadAssetAtPath<GameObject>(JellySchoolInstaller.JellyPrefabPath);
        if (school.jellyPrefab != jelly) throw new Exception("JellySchool.jellyPrefab is not JellyFish.prefab");
        if (school.config == null) throw new Exception("JellySchool has no config");
        if (school.sortingOrder < 1 || school.sortingOrder > 2) throw new Exception($"JellySchool.sortingOrder {school.sortingOrder}: the jellyfish must stay between the water (Background/1) and the walls (Background/3)");
        if (school.depthZ >= 0f) throw new Exception($"JellySchool.depthZ {school.depthZ}: must be negative so, at the same order, it draws in front of BG - 2.1 and the fish");
        JellySchoolInstaller.ValidateJelly(jelly);

        // Nzib's layers, the fish and the seaweed must still be there (the installer touches only the Jellies child).
        if (arena.transform.Find("BG - 2.1") == null) throw new Exception("ArenaArt_Elite lost Nzib's BG - 2.1 layer");
        if (arena.transform.Find(AnglerSchool.ChildName) == null) throw new Exception("ArenaArt_Elite lost the Fish child");
        int seaweed = 0;
        foreach (var t in arena.GetComponentsInChildren<Transform>(true)) if (t.name.StartsWith("Seaweed") || t.name.StartsWith("FG_Seaweed")) seaweed++;
        if (seaweed < 9) throw new Exception($"only {seaweed} seaweed instances in ArenaArt_Elite — Nzib placed 9");

        byte[] before = File.ReadAllBytes(JellySchoolInstaller.ArenaPrefabPath);
        bool changed = JellySchoolInstaller.InstallInto();
        byte[] after = File.ReadAllBytes(JellySchoolInstaller.ArenaPrefabPath);
        if (changed) throw new Exception("installer reported a change on a second run");
        if (before.Length != after.Length) throw new Exception("installer rewrote the prefab on a second run");
        for (int i = 0; i < before.Length; i++) if (before[i] != after[i]) throw new Exception("installer rewrote the prefab on a second run");
    }
}
