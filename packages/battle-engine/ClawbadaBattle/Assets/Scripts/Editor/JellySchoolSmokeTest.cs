using System;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks the jellyfish school without a scene: the planner's guarantees over many seeds (Nzib's rules —
/// groups of 1–3 and never more, one heading per group with no turn; the review's rules — members start
/// fully behind the floor plate, spaced apart in a line and surfacing one after another, every path inside
/// the player's window, leaving above the frame still in front of the walls, slow, gaps in range,
/// deterministic), the designer's asset, and what JellySchoolInstaller wrote into ArenaArt_Elite.prefab —
/// the Jellies child and the floor plate's SpriteMask that hides a jellyfish below the plate's edge — (and
/// that running it again changes nothing; his BG - 2.1 layer, the Fish child and the seaweed are still there).
/// Menu: Clawbada ▸ Verify Jellyfish. Headless:
///   Unity -batchmode -nographics -quit -executeMethod JellySchoolSmokeTest.Run
/// Throws on any violated guard so batch exits non-zero.
/// </summary>
public static class JellySchoolSmokeTest
{
    /// <summary>The floor plate's painted edge across the water band (Ground.png, PPU 64, measured 2026-10-08):
    /// y 1.594 at x −2.0, 1.672 at −1.6, 1.719 at −1.4, 1.766 at −1.2, 1.797 from −1.0 to −0.4 — lowest at the
    /// window's left end.</summary>
    public const float PlateEdgeMin = 1.594f;
    /// <summary>The jellyfish sheet paints 13 px above the sprite's centre and 28 px wide (frames 0–2).</summary>
    public const float PaintedTop = 13f / 64f, PaintedHalfWidth = 14f / 64f;

    [MenuItem("Clawbada/Verify Jellyfish")]
    public static void Run()
    {
        int groups = CheckPlanner();
        CheckFixedCount();
        CheckInstalledPrefab();
        string msg = $"[JellySchoolSmokeTest] OK — {groups} groups (1–3 jellyfish, every count seen, both headings, starting behind the floor plate, spaced in a line, staggered, every path in the player's window, slow, deterministic), asset valid, prefab installed with the floor mask and idempotent.";
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }

    private static int CheckPlanner()
    {
        var cfg = new JellySchoolConfig();
        // Masked by the plate, a jellyfish must START fully behind it anywhere in the window (2 px margin).
        if (cfg.spawnY + PaintedTop * cfg.scaleMax > PlateEdgeMin - 2f / 64f)
            throw new Exception($"spawnY {cfg.spawnY}: at scale {cfg.scaleMax} the sprite's top ({cfg.spawnY + PaintedTop * cfg.scaleMax:F3}) would show over the plate's edge ({PlateEdgeMin} at x −2.0) the moment it starts — it must rise into view from behind the plate");
        if (cfg.spawnY < PlateEdgeMin - 0.6f) throw new Exception($"spawnY {cfg.spawnY} is far below the plate's edge — seconds of invisible rise");
        if (cfg.exitY < 2.8125f + 0.25f) throw new Exception($"exitY {cfg.exitY} is not past the frame top (2.8125) plus a half-height");
        float xMin = Mathf.Min(cfg.visibleXMin, cfg.visibleXMax), xMax = Mathf.Max(cfg.visibleXMin, cfg.visibleXMax);
        // The player's window on the water: the left wall (≈ −2.3) and the opponent's HUD panels (≈ +0.2), less a half-width.
        if (xMin < -2.05f) throw new Exception($"visibleXMin {xMin} reaches the left ruined wall (x ≲ −2.3 with a 0.3 half-width)");
        if (xMax > -0.05f) throw new Exception($"visibleXMax {xMax} reaches the opponent's HUD panels (x ≳ +0.2 with a 0.3 half-width)");
        // Spread: neighbours never overlap (the painted width at the largest scale, less the jitter either way).
        float widest = 2f * PaintedHalfWidth * cfg.scaleMax;
        if (cfg.memberSpacing - 2f * cfg.memberXJitter < widest)
            throw new Exception($"memberSpacing {cfg.memberSpacing} ± {cfg.memberXJitter} lets two jellyfish at scale {cfg.scaleMax} ({widest:F2} u wide) overlap — they must not bunch");
        if (cfg.memberXJitter > cfg.memberSpacing * 0.25f) throw new Exception($"memberXJitter {cfg.memberXJitter} is more than a quarter of the spacing — the line would bunch");
        if (cfg.memberDelayMax < 2f) throw new Exception($"memberDelayMax {cfg.memberDelayMax}: a trio would surface together instead of one after another");
        if (2f * cfg.HalfSpan(cfg.maxJellies) > xMax - xMin) throw new Exception($"a line of {cfg.maxJellies} ({2f * cfg.HalfSpan(cfg.maxJellies):F2} u) does not fit the visible window ({xMax - xMin:F2} u)");
        if (cfg.riseSpeedMax > 0.25f) throw new Exception($"riseSpeedMax {cfg.riseSpeedMax} u/s is not a jellyfish's drift");

        int groups = 0, left = 0, right = 0, steep = 0, lines = 0;
        float closest = float.MaxValue;
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
                float halfSpan = cfg.HalfSpan(n);
                if (a.baseX < xMin + halfSpan - 1e-4f || a.baseX > xMax - halfSpan + 1e-4f) throw new Exception($"line centre {a.baseX} puts an outer member outside the window ({ka})");
                if (n == 1 && Mathf.Abs(a.baseX - cfg.spawnXCenter) > cfg.spawnXHalfWidth + 1e-4f) throw new Exception($"a lone jellyfish starts at {a.baseX}, outside {cfg.spawnXCenter} ± {cfg.spawnXHalfWidth} ({ka})");
                float dLo = g == 0 ? cfg.firstGroupDelayMin : cfg.groupGapMin, dHi = g == 0 ? cfg.firstGroupDelayMax : cfg.groupGapMax;
                if (a.delay < dLo - 1e-4f || a.delay > dHi + 1e-4f) throw new Exception($"group delay {a.delay} outside [{dLo},{dHi}] ({ka})");
                for (int m = 0; m < n; m++)
                {
                    var r = a.members[m];
                    if (r.groupIndex != g || r.memberIndex != m) throw new Exception($"member indexes {r.groupIndex}/{r.memberIndex} ({ka})");
                    float slot = JellySchoolPlanner.SlotX(a.baseX, m, n, cfg);
                    if (Mathf.Abs(r.startX - slot) > cfg.memberXJitter + 1e-4f) throw new Exception($"member {m} starts at {r.startX}, off its slot {slot} by more than the jitter ({ka})");
                    if (m > 0)
                    {
                        float gap = r.startX - a.members[m - 1].startX;
                        if (gap < cfg.memberSpacing - 2f * cfg.memberXJitter - 1e-4f) throw new Exception($"members {m - 1} and {m} start only {gap:F2} u apart — bunched ({ka})");
                        closest = Mathf.Min(closest, gap);
                        lines++;
                    }
                    if (!JellySchoolPlanner.Fits(r.startX, cfg)) throw new Exception($"member starts at x {r.startX}, outside the visible window ({ka})");
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
        if (lines == 0) throw new Exception("no group of two or more was planned");
        Debug.Log($"[JellySchoolSmokeTest] closest neighbours in {lines} pairs: {closest:F2} u (painted width ≤ {widest:F2})");
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
        // The shipped config is what the planner checks above ran on: the prefab must not carry stale tuning
        // (the installer's Reinstall resets it after a field rename).
        var shipped = school.config; var fresh = new JellySchoolConfig();
        if (Mathf.Abs(shipped.spawnY - fresh.spawnY) > 1e-4f || Mathf.Abs(shipped.memberSpacing - fresh.memberSpacing) > 1e-4f || Mathf.Abs(shipped.memberXJitter - fresh.memberXJitter) > 1e-4f || Mathf.Abs(shipped.memberDelayMax - fresh.memberDelayMax) > 1e-4f)
            throw new Exception($"the prefab's JellySchool config (spawnY {shipped.spawnY}, spacing {shipped.memberSpacing} ± {shipped.memberXJitter}, delay ≤ {shipped.memberDelayMax}) differs from the code's defaults — run JellySchoolInstaller.Reinstall");
        JellySchoolInstaller.ValidateJelly(jelly);

        // The floor mask (2026-10-08): the plate hides a jellyfish below its edge; only the jellyfish opt in.
        if (!school.hideBehindFloor) throw new Exception("JellySchool.hideBehindFloor is off — a jellyfish starting under the plate would show over it (pop in)");
        var ground = arena.transform.Find(JellySchoolInstaller.GroundName);
        if (ground == null) throw new Exception($"ArenaArt_Elite has no '{JellySchoolInstaller.GroundName}' child");
        var groundSr = ground.GetComponent<SpriteRenderer>();
        if (groundSr == null || groundSr.sprite == null) throw new Exception("Ground has no sprite");
        var mask = ground.GetComponent<SpriteMask>();
        if (mask == null) throw new Exception("Ground has no SpriteMask — run JellySchoolInstaller.Install; the jellyfish would pop in over the plate");
        if (mask.sprite != groundSr.sprite) throw new Exception("the Ground mask is not the plate's own sprite");
        int bg = SortingLayer.NameToID("Background");
        if (!mask.isCustomRangeActive) throw new Exception("the Ground mask is not range-limited — it would clip every masked sprite on every layer");
        if (mask.backSortingLayerID != bg || mask.frontSortingLayerID != bg || mask.backSortingOrder > school.sortingOrder || mask.frontSortingOrder < school.sortingOrder)
            throw new Exception($"the Ground mask's range does not cover the jellyfish slot Background/{school.sortingOrder}");
        if (groundSr.maskInteraction != SpriteMaskInteraction.None) throw new Exception("the plate itself must not be masked");
        var fish = AssetDatabase.LoadAssetAtPath<GameObject>(AnglerSchoolInstaller.FishPrefabPath);
        var fishSr = fish != null ? fish.GetComponent<SpriteRenderer>() : null;
        if (fishSr != null && fishSr.maskInteraction != SpriteMaskInteraction.None) throw new Exception("Nzib's angler fish opt into the mask — only the jellyfish may");
        var jellySr = jelly.GetComponent<SpriteRenderer>();
        if (jellySr != null && jellySr.maskInteraction != SpriteMaskInteraction.None) throw new Exception("JellyFish.prefab itself carries a mask interaction — JellySchool sets it at runtime; the designer's asset stays as dropped");

        // Nzib's layers, the fish and the seaweed must still be there (the installer touches only the Jellies child and the Ground mask).
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
