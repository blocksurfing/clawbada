using System;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Puts the storm reaction into the Evolved arena prefab: a "Storm" child with a StormReaction component. It
/// relies on three things the prefab already has — the Sea (under BG_2) and FoamAnimated (under Foam) animators and
/// the Birds child (BirdFlock) — and refuses to install without them. Idempotent: a second run changes nothing
/// and never overwrites a config the designer tuned. Nothing else in the prefab is touched.
/// Menu: Clawbada ▸ Arena ▸ Install Evolved Storm Reaction. Headless:
///   Unity -batchmode -nographics -quit -executeMethod StormReactionInstaller.Install
/// </summary>
public static class StormReactionInstaller
{
    public const string ArenaPrefabPath = "Assets/Art/Arenas/Evolved/ArenaArt_Evolved.prefab";

    [MenuItem("Clawbada/Arena/Install Evolved Storm Reaction")]
    public static void Install() => InstallInto();

    /// <summary>Returns true when the prefab was changed.</summary>
    public static bool InstallInto()
    {
        var root = PrefabUtility.LoadPrefabContents(ArenaPrefabPath);
        bool changed = false;
        try
        {
            ValidateSiblings(root.transform, "Sea", "FoamAnimated");

            var t = root.transform.Find(StormReaction.ChildName);
            if (t == null)
            {
                t = new GameObject(StormReaction.ChildName).transform;
                t.SetParent(root.transform, false);
                changed = true;
            }
            if (t.localPosition != Vector3.zero || t.localRotation != Quaternion.identity || t.localScale != Vector3.one)
            {
                t.localPosition = Vector3.zero; t.localRotation = Quaternion.identity; t.localScale = Vector3.one;
                changed = true;
            }
            var storm = t.GetComponent<StormReaction>();
            if (storm == null) { storm = t.gameObject.AddComponent<StormReaction>(); changed = true; }
            if (changed) PrefabUtility.SaveAsPrefabAsset(root, ArenaPrefabPath);
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(root);
        }
        if (changed) AssetDatabase.SaveAssets();
        Report($"[StormReactionInstaller] OK — {(changed ? "installed" : "already installed, unchanged")}");
        return changed;
    }

    /// <summary>What StormReaction reads off the arena at runtime: the two animated bands and the gulls.</summary>
    public static void ValidateSiblings(Transform arena, string seaChild, string foamChild)
    {
        var sea = StormReaction.FindDeep(arena, seaChild);
        if (sea == null || sea.GetComponent<Animator>() == null) throw new Exception($"[StormReactionInstaller] {ArenaPrefabPath} has no animated '{seaChild}' child — Nzib's sea drop is not landed");
        var foam = StormReaction.FindDeep(arena, foamChild);
        if (foam == null || foam.GetComponent<Animator>() == null) throw new Exception($"[StormReactionInstaller] {ArenaPrefabPath} has no animated '{foamChild}' child");
        foreach (var a in new[] { sea.GetComponent<Animator>(), foam.GetComponent<Animator>() })
        {
            if (a.updateMode != AnimatorUpdateMode.Normal) throw new Exception($"[StormReactionInstaller] {a.name} animator must use Normal update mode (scaled time) for the storm speed-up to stack with BattleBridge.SetSpeed");
            if (a.cullingMode != AnimatorCullingMode.AlwaysAnimate) throw new Exception($"[StormReactionInstaller] {a.name} animator must AlwaysAnimate");
        }
        var birds = arena.Find(BirdFlock.ChildName);
        if (birds == null || birds.GetComponent<BirdFlock>() == null) throw new Exception("[StormReactionInstaller] no Birds child with a BirdFlock — run BirdFlockInstaller.Install first");
    }

    private static void Report(string msg)
    {
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }
}
