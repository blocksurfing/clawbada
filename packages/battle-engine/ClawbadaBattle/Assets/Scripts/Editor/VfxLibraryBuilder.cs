using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Builds one-shot VFX prefabs from every sliced sprite sheet under Assets/Art/FX
/// (12 fps, matching the designer's Preview_Global_* convention) and creates or
/// updates the BattleVfxLibrary asset. Idempotent: clips/controllers/prefabs are
/// regenerated in place, and library slots the designer has already filled are
/// left untouched — only empty default slots get seeded with the generics.
/// </summary>
public static class VfxLibraryBuilder
{
    private const string FxArtRoot = "Assets/Art/FX";
    private const string OutRoot = "Assets/Prefabs/VFX";
    private const string ClipsFolder = OutRoot + "/Clips";
    private const string LibraryPath = OutRoot + "/BattleVfxLibrary.asset";
    private const float SampleRate = 12f; // designer convention (Preview_Global_StepDust)

    [MenuItem("Clawbada/Rebuild Generic VFX Prefabs")]
    public static void Rebuild()
    {
        EnsureFolder(OutRoot);
        EnsureFolder(ClipsFolder);

        var prefabs = new Dictionary<string, GameObject>();
        foreach (string guid in AssetDatabase.FindAssets("t:Texture2D", new[] { FxArtRoot }))
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            var sprites = AssetDatabase.LoadAllAssetsAtPath(path)
                .OfType<Sprite>()
                .OrderBy(s => s.name, new NaturalNameComparer())
                .ToArray();
            if (sprites.Length == 0) continue;

            string baseName = System.IO.Path.GetFileNameWithoutExtension(path);
            var prefab = BuildPrefab(baseName, sprites);
            if (prefab != null) prefabs[baseName] = prefab;
        }

        var library = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (library == null)
        {
            library = ScriptableObject.CreateInstance<BattleVfxLibrary>();
            AssetDatabase.CreateAsset(library, LibraryPath);
        }

        // Seed empty slots with sensible generics; never overwrite designer picks.
        SeedSlot(library.moveStep, prefabs, "FX_Generic_StepDust");
        SeedSlot(library.attackImpact, prefabs, "FX_Generic_HitSpark");
        SeedSlot(library.death, prefabs, "FX_Generic_CollapseDust");
        SeedSlot(library.defend, prefabs, "FX_Generic_GuardDust");
        SeedSlot(library.status, prefabs, "FX_Generic_StatusBurst");

        EditorUtility.SetDirty(library);
        AssetDatabase.SaveAssets();
        Debug.Log($"[VfxLibraryBuilder] Built {prefabs.Count} VFX prefabs under {OutRoot}. " +
                  $"Library at {LibraryPath} (existing designer slots preserved).");
    }

    private static void SeedSlot(BattleVfxLibrary.VfxSlot slot, Dictionary<string, GameObject> prefabs, string name)
    {
        if (slot == null || slot.prefab != null) return;
        if (prefabs.TryGetValue(name, out var prefab)) slot.prefab = prefab;
    }

    private static GameObject BuildPrefab(string baseName, Sprite[] sprites)
    {
        // One-shot clip at the designer's 12 fps.
        var clip = new AnimationClip { frameRate = SampleRate };
        var binding = new EditorCurveBinding
        {
            type = typeof(SpriteRenderer),
            path = "",
            propertyName = "m_Sprite",
        };
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++)
        {
            keys[i] = new ObjectReferenceKeyframe { time = i / SampleRate, value = sprites[i] };
        }
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);

        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = false;
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        string clipPath = $"{ClipsFolder}/{baseName}.anim";
        AssetDatabase.DeleteAsset(clipPath);
        AssetDatabase.CreateAsset(clip, clipPath);

        string controllerPath = $"{ClipsFolder}/AC_{baseName}.controller";
        AssetDatabase.DeleteAsset(controllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(controllerPath, clip);

        var go = new GameObject(baseName);
        try
        {
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            var animator = go.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            go.AddComponent<OneShotVfx>();

            string prefabPath = $"{OutRoot}/{baseName}.prefab";
            return PrefabUtility.SaveAsPrefabAsset(go, prefabPath);
        }
        finally
        {
            Object.DestroyImmediate(go);
        }
    }

    private static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path)) return;
        string parent = System.IO.Path.GetDirectoryName(path).Replace('\\', '/');
        string leaf = System.IO.Path.GetFileName(path);
        EnsureFolder(parent);
        AssetDatabase.CreateFolder(parent, leaf);
    }

    /// <summary>Orders frame_2 before frame_10 (plain string sort would not).</summary>
    private class NaturalNameComparer : IComparer<string>
    {
        private static readonly Regex TrailingNumber = new(@"^(.*?)(\d+)$");

        public int Compare(string a, string b)
        {
            var ma = TrailingNumber.Match(a ?? "");
            var mb = TrailingNumber.Match(b ?? "");
            if (ma.Success && mb.Success && ma.Groups[1].Value == mb.Groups[1].Value)
            {
                return int.Parse(ma.Groups[2].Value).CompareTo(int.Parse(mb.Groups[2].Value));
            }
            return string.CompareOrdinal(a, b);
        }
    }
}
