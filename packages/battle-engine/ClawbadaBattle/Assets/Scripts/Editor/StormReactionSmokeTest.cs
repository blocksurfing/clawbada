using System;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks the Maelstrom reaction without a scene: the depth arithmetic between the gulls' panic flight and the
/// storm prefab (the gulls must fly in FRONT of the storm clouds and leaves but UNDER the lightning flash),
/// the panic target rules over many positions (nearer edge, out above the frame), the sea config, what
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
        int targets = CheckPanicTargets(flock);
        CheckInstalledPrefab(arena);
        string msg = $"[StormReactionSmokeTest] OK — gulls flee on {flock.panicSortingLayer}/{flock.panicSortingOrder} (over the storm clouds, under the flash), {targets} panic targets sane, sea config sane, prefab installed and idempotent.";
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }

    /// <summary>The storm prefab's layers decide where a fleeing gull must sort: above every cloud/leaf layer,
    /// below the full-screen lightning flash (which whites everything out for a frame).</summary>
    private static void CheckPanicDepth(BirdFlock flock)
    {
        var storm = AssetDatabase.LoadAssetAtPath<GameObject>(StormPrefabPath);
        if (storm == null) throw new Exception($"{StormPrefabPath} missing — the Maelstrom VFX is not bound");
        int cloudsMax = int.MinValue, flash = int.MaxValue;
        string layer = null;
        foreach (var sr in storm.GetComponentsInChildren<SpriteRenderer>(true))
        {
            if (layer == null) layer = sr.sortingLayerName;
            else if (sr.sortingLayerName != layer) throw new Exception($"storm prefab mixes sorting layers ({layer} vs {sr.sortingLayerName} on {sr.name})");
            if (sr.name.StartsWith("Hit")) continue;                 // per-target hits sort above everything
            if (sr.name.StartsWith("Flash")) { flash = Math.Min(flash, sr.sortingOrder); continue; }
            cloudsMax = Math.Max(cloudsMax, sr.sortingOrder);        // dim overlay, Cloud_Left/Right, Leaves
        }
        if (layer == null || cloudsMax == int.MinValue) throw new Exception("storm prefab has no cloud layers");
        if (flock.panicSortingLayer != layer) throw new Exception($"BirdFlock.panicSortingLayer '{flock.panicSortingLayer}' is not the storm's layer '{layer}' — a fleeing gull would stay behind the clouds");
        if (flock.panicSortingOrder <= cloudsMax) throw new Exception($"BirdFlock.panicSortingOrder {flock.panicSortingOrder} is not above the storm clouds/leaves ({cloudsMax})");
        if (flash != int.MaxValue && flock.panicSortingOrder >= flash) throw new Exception($"BirdFlock.panicSortingOrder {flock.panicSortingOrder} is above the lightning flash ({flash}) — the flash must white the gulls out too");
        if (flock.panicSpeed <= flock.flySpeed) throw new Exception($"panicSpeed {flock.panicSpeed} is not faster than the cruise {flock.flySpeed} — \"fly quickly off the screen\"");
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
