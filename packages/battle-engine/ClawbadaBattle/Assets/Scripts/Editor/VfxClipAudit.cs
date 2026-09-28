using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Checks every effect clip after a designer drop for the two ways a drop can leave an effect "frozen":
///   • missing sprite keys — a sheet re-sliced (new sprite IDs) without rebuilding its clip;
///   • one-frame LOOPS — a looping clip with a single sprite sits still for as long as it lives (Haunt's sigil
///     idle after drop 5e3e6f9 — intentional, per Nzib 2026-09-27; listed so a still loop is always a choice).
/// Menu: Clawbada ▸ VFX ▸ Audit Effect Clips. Headless: -executeMethod VfxClipAudit.Run
/// </summary>
public static class VfxClipAudit
{
    private const string ClipDir = "Assets/Prefabs/VFX/Clips";

    [MenuItem("Clawbada/VFX/Audit Effect Clips")]
    public static void Run()
    {
        var missing = new List<string>();
        var stillLoops = new List<string>();
        int clips = 0;
        foreach (var guid in AssetDatabase.FindAssets("t:AnimationClip", new[] { ClipDir }))
        {
            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(AssetDatabase.GUIDToAssetPath(guid));
            if (clip == null) continue;
            clips++;
            int keys = 0, gone = 0;
            var distinct = new HashSet<Object>();
            foreach (var b in AnimationUtility.GetObjectReferenceCurveBindings(clip))
            {
                if (b.propertyName != "m_Sprite") continue;
                foreach (var k in AnimationUtility.GetObjectReferenceCurve(clip, b))
                {
                    keys++;
                    if (k.value == null) gone++; else distinct.Add(k.value);
                }
            }
            if (gone > 0) missing.Add($"{clip.name} {gone}/{keys}");
            if (keys > 0 && AnimationUtility.GetAnimationClipSettings(clip).loopTime && distinct.Count <= 1) stillLoops.Add(clip.name);
        }
        string msg = $"[VfxClipAudit] {clips} clips — missing sprite keys: {(missing.Count == 0 ? "none" : string.Join("; ", missing))}" +
                     $" — one-frame loops (read as frozen): {(stillLoops.Count == 0 ? "none" : string.Join(", ", stillLoops))}";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }
}
