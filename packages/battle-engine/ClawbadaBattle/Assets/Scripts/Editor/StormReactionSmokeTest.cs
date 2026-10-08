using System;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks the Maelstrom reaction without a scene: the depth arithmetic between the gulls' panic flight and the
/// storm effect AS IT RUNS (BattleVfxLibrary.SpawnScreen wraps the prefab in a SortingGroup at DepthSort.ScreenFxOrder,
/// so the gulls must sort above that wrap, not above the prefab's cloud layers), the gulls' quick return after a
/// storm, the panic target rules over many positions (nearer edge, out above the frame), the sea config, what
/// StormReactionInstaller wrote into ArenaArt_Evolved.prefab, and that running it again changes nothing.
/// Menu: Clawbada ▸ Verify Storm Reaction. Headless:
///   Unity -batchmode -nographics -quit -executeMethod StormReactionSmokeTest.Run
/// Throws on any violated guard so batch exits non-zero.
/// </summary>
public static class StormReactionSmokeTest
{
    public const string StormPrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom.prefab";

    [MenuItem("Clawbada/Verify Storm Reaction")]
    public static void Run()
    {
        var arena = AssetDatabase.LoadAssetAtPath<GameObject>(StormReactionInstaller.ArenaPrefabPath);
        if (arena == null) throw new Exception($"{StormReactionInstaller.ArenaPrefabPath} missing");
        var flock = arena.GetComponentInChildren<BirdFlock>(true);
        if (flock == null) throw new Exception("ArenaArt_Evolved has no BirdFlock");
        CheckPanicDepth(flock);
        CheckReturn(flock);
        int targets = CheckPanicTargets(flock);
        CheckInstalledPrefab(arena);
        string msg = $"[StormReactionSmokeTest] OK — gulls flee on {flock.panicSortingLayer}/{flock.panicSortingOrder} (over the storm's runtime wrap at {DepthSort.Layer}/{DepthSort.ScreenFxOrder}), back {flock.afterStormGap:F0}+{flock.returnGapMin:F0}–{flock.returnGapMax:F0} s after it clears, {targets} panic targets sane, sea config sane, prefab installed and idempotent.";
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }

    /// <summary>Where a fleeing gull must sort is decided by the storm effect as it RUNS, not by the prefab's
    /// children: BattleVfxLibrary.SpawnScreen wraps the whole prefab in a SortingGroup on DepthSort.Layer at
    /// DepthSort.ScreenFxOrder, inside which the clouds (10/11), leaves (12) and flash (30) order themselves. A gull
    /// on Foreground/20 — above the clouds' child order, below the wrap — took off behind the storm and vanished
    /// (user 2026-10-08). So: the prefab must sort on the wrap's layer throughout, and the gulls above the wrap
    /// (and above the onTop per-target effects that ride one over it).</summary>
    private static void CheckPanicDepth(BirdFlock flock)
    {
        var storm = AssetDatabase.LoadAssetAtPath<GameObject>(StormPrefabPath);
        if (storm == null) throw new Exception($"{StormPrefabPath} missing — the Maelstrom VFX is not bound");
        int children = 0;
        foreach (var sr in storm.GetComponentsInChildren<SpriteRenderer>(true))
        {
            children++;
            if (sr.sortingLayerName != DepthSort.Layer) throw new Exception($"storm prefab child {sr.name} sorts on {sr.sortingLayerName}; the runtime wrap is on {DepthSort.Layer}");
        }
        if (children == 0) throw new Exception("storm prefab has no sprite layers");
        if (DepthSort.ScreenFxOrder <= DepthSort.ArenaFrontOrderBase) throw new Exception("DepthSort.ScreenFxOrder is not above the arena's front art");
        if (DepthSort.AboveScreenFxOrder <= DepthSort.ScreenFxTopOrder) throw new Exception("DepthSort.AboveScreenFxOrder is not above the onTop effects");
        if (flock.panicSortingLayer != DepthSort.Layer) throw new Exception($"BirdFlock.panicSortingLayer '{flock.panicSortingLayer}' is not the storm wrap's layer '{DepthSort.Layer}' — a fleeing gull would stay behind the clouds");
        if (flock.panicSortingOrder <= DepthSort.ScreenFxTopOrder) throw new Exception($"BirdFlock.panicSortingOrder {flock.panicSortingOrder} is not above the storm's runtime wrap ({DepthSort.Layer}/{DepthSort.ScreenFxOrder}; onTop effects at {DepthSort.ScreenFxTopOrder}) — the gulls would take off behind the clouds");
        if (flock.panicSpeed <= flock.flySpeed) throw new Exception($"panicSpeed {flock.panicSpeed} is not faster than the cruise {flock.flySpeed} — \"fly quickly off the screen\"");
        // Seen in front of the clouds: the storm's clouds roll in over the first second, so the gulls must still be on
        // screen then (a beat + hop + startled climb ≈ 1.4 s before the burst) and gone before the lightning at 3.9 s.
        if (flock.panicDelay < 0f || flock.panicDelay > 0.5f) throw new Exception($"panicDelay {flock.panicDelay} s: the gulls should react within a beat");
        if (flock.panicHoverSeconds < 0.4f) throw new Exception($"panicHoverSeconds {flock.panicHoverSeconds} s: the gulls would be gone before the storm clouds have rolled in (~1 s) — nobody sees them in front of the clouds");
        if (flock.panicDelay + flock.panicHoverSeconds > 1.6f) throw new Exception($"panicDelay + panicHoverSeconds = {flock.panicDelay + flock.panicHoverSeconds:F1} s: with the hop and the burst the gulls would still be on screen at the lightning flash (3.9 s)");
        if (flock.panicHoverRise <= 0f || flock.panicHoverRise > 0.6f) throw new Exception($"panicHoverRise {flock.panicHoverRise} u is not a startled climb over the rock");
    }

    /// <summary>"They should also come back a bit quicker once the storm has passed" (user 2026-10-08): after a
    /// scatter the next flock waits the sea's ease-out plus a short return gap, well under the usual between-flock gap.</summary>
    private static void CheckReturn(BirdFlock flock)
    {
        if (flock.afterStormGap < 0f) throw new Exception("afterStormGap is negative");
        if (flock.afterStormGap > 4f) throw new Exception($"afterStormGap {flock.afterStormGap} s: the gulls linger away long after the storm has cleared");
        if (flock.returnGapMin < 0f || flock.returnGapMax < flock.returnGapMin) throw new Exception($"return gap [{flock.returnGapMin},{flock.returnGapMax}] is not a range");
        if (flock.afterStormGap + flock.returnGapMax >= flock.flockGapMin) throw new Exception($"after a storm the gulls take up to {flock.afterStormGap + flock.returnGapMax:F0} s to come back — not quicker than a normal flock gap ({flock.flockGapMin} s)");
        if (flock.afterStormGap + flock.returnGapMax > 12f) throw new Exception($"after a storm the gulls take up to {flock.afterStormGap + flock.returnGapMax:F0} s to come back — too slow");
    }

    private static int CheckPanicTargets(BirdFlock flock)
    {
        // The gull sprite is 0.5 u tall; off-screen above the frame means its centre past 2.8125 + 0.25.
        if (flock.panicExitY < 2.8125f + 0.25f) throw new Exception($"panicExitY {flock.panicExitY} is not above the frame");
        int n = 0;
        for (float viewHalf = 5f; viewHalf <= 5.6f; viewHalf += 0.3f)
        {
            for (float x = -4.5f; x <= 4.5f; x += 0.25f)
            {
                var t = BirdFlockPlanner.PanicTarget(x, viewHalf, flock.panicExitDx, flock.panicExitY);
                int nearer = x >= 0f ? 1 : -1;
                if (t.dir != nearer) throw new Exception($"panic from x={x} heads {t.dir}, the nearer edge is {nearer}");
                if (t.y < flock.panicExitY - 1e-4f) throw new Exception($"panic target y {t.y} below exitY");
                if (Mathf.Abs(t.x - x) < flock.panicExitDx - 1e-4f) throw new Exception($"panic from x={x} moves only {Mathf.Abs(t.x - x)} sideways");
                if (Mathf.Abs(t.x) > viewHalf + flock.panicExitDx + 1e-4f) throw new Exception($"panic target x {t.x} is far beyond the view");
                n++;
            }
        }
        return n;
    }

    private static void CheckInstalledPrefab(GameObject arena)
    {
        var child = arena.transform.Find(StormReaction.ChildName);
        if (child == null) throw new Exception("ArenaArt_Evolved has no Storm child — run StormReactionInstaller.Install");
        if (child.localPosition != Vector3.zero) throw new Exception("Storm child is not at local zero");
        var storm = child.GetComponent<StormReaction>();
        if (storm == null) throw new Exception("Storm child has no StormReaction component");
        if (storm.seaSpeedMultiplier <= 1f) throw new Exception($"seaSpeedMultiplier {storm.seaSpeedMultiplier} does not speed the sea up");
        if (storm.seaSpeedMultiplier > 5f) throw new Exception($"seaSpeedMultiplier {storm.seaSpeedMultiplier} would strobe a 7 fps loop");
        if (storm.jitterAmplitude < 0f || storm.jitterAmplitude > 0.1f) throw new Exception($"jitterAmplitude {storm.jitterAmplitude} u is not a chop (≤ 6 px)");
        if (storm.easeOutSeconds <= 0f) throw new Exception("the sea must calm down gradually (easeOutSeconds > 0)");
        if (storm.specialClass != "Tempest") throw new Exception($"specialClass '{storm.specialClass}' — the storm is Tempest's Maelstrom");
        StormReactionInstaller.ValidateSiblings(arena.transform, storm.seaChild, storm.foamChild);
        // Nzib's layers and the other decor must still be there.
        foreach (var name in new[] { "Static_Clouds", "Sea", "FoamAnimated", BirdFlock.ChildName, CloudDrift.ChildName })
            if (StormReaction.FindDeep(arena.transform, name) == null) throw new Exception($"ArenaArt_Evolved lost its '{name}' child");

        byte[] before = File.ReadAllBytes(StormReactionInstaller.ArenaPrefabPath);
        bool changed = StormReactionInstaller.InstallInto();
        byte[] after = File.ReadAllBytes(StormReactionInstaller.ArenaPrefabPath);
        if (changed) throw new Exception("installer reported a change on a second run");
        if (before.Length != after.Length) throw new Exception("installer rewrote the prefab on a second run");
        for (int i = 0; i < before.Length; i++) if (before[i] != after[i]) throw new Exception("installer rewrote the prefab on a second run");
    }
}
