using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Builds Unity-ready prefab/clip/controller assets for Mantis Ambush modular effects.
/// Trigger marker: Assets/Art/FX/Attack/Mantis/.build_mantis_effect_prefabs
/// </summary>
public static class MantisEffectsPrefabBuilder
{
    private const string Marker = "Assets/Art/FX/Attack/Mantis/.build_mantis_effect_prefabs";
    private const string SheetDir = "Assets/Art/FX/Attack/Mantis/";
    private const string PrefabDir = "Assets/Prefabs/VFX/";
    private const string ClipDir = "Assets/Prefabs/VFX/Clips/";
    private const float Fps = 12f;
    private const int FrameSize = 128;

    [InitializeOnLoadMethod]
    private static void AutoRunWhenRequested()
    {
        EditorApplication.delayCall += () =>
        {
            if (!File.Exists(Marker)) return;
            File.Delete(Marker);
            Build();
        };
    }

    [MenuItem("Clawbada/VFX/Build Mantis Ambush Effect Prefabs")]
    public static void Build()
    {
        EnsureFolder(PrefabDir);
        EnsureFolder(ClipDir);

        var jump = BuildOne("FX_Mantis_Ambush_JumpEffect", 8, loop: false, oneShot: true, sortingOrder: 20);
        var poison = BuildOne("FX_Mantis_Ambush_PoisonEffect", 11, loop: false, oneShot: true, sortingOrder: 21);

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[MantisEffectsPrefabBuilder] OK — built {jump.name} and {poison.name} prefabs/clips/controllers.";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static GameObject BuildOne(string stem, int expectedFrames, bool loop, bool oneShot, int sortingOrder)
    {
        string sheetPath = SheetDir + stem + ".png";
        SliceHorizontalSheet(sheetPath, stem, expectedFrames);

        var sprites = AssetDatabase.LoadAllAssetsAtPath(sheetPath).OfType<Sprite>()
            .OrderBy(s => s.name)
            .ToArray();
        if (sprites.Length != expectedFrames)
            throw new System.Exception($"[MantisEffectsPrefabBuilder] {sheetPath}: expected {expectedFrames} sprites, found {sprites.Length}");

        var clip = new AnimationClip { frameRate = Fps };
        var binding = EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite");
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++)
            keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = loop;
        settings.startTime = 0f;
        settings.stopTime = sprites.Length / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        string clipPath = ClipDir + stem + ".anim";
        string controllerPath = ClipDir + "AC_" + stem + ".controller";
        string prefabPath = PrefabDir + stem + ".prefab";
        AssetDatabase.DeleteAsset(clipPath);
        AssetDatabase.CreateAsset(clip, clipPath);
        AssetDatabase.DeleteAsset(controllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(controllerPath, clip);

        var go = new GameObject(stem);
        try
        {
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            sr.sortingLayerName = "Foreground";
            sr.sortingOrder = sortingOrder;
            var animator = go.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            if (oneShot) go.AddComponent<OneShotVfx>();
            AssetDatabase.DeleteAsset(prefabPath);
            return PrefabUtility.SaveAsPrefabAsset(go, prefabPath);
        }
        finally
        {
            Object.DestroyImmediate(go);
        }
    }

    private static void SliceHorizontalSheet(string sheetPath, string stem, int frameCount)
    {
        var importer = AssetImporter.GetAtPath(sheetPath) as TextureImporter;
        if (importer == null) throw new System.Exception($"[MantisEffectsPrefabBuilder] missing texture importer: {sheetPath}");
        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Multiple;
        importer.spritePixelsPerUnit = 64f;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
        importer.maxTextureSize = 2048;

        var factory = new SpriteDataProviderFactories();
        factory.Init();
        var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
        provider.InitSpriteEditorDataProvider();

        var rects = new List<SpriteRect>();
        for (int i = 0; i < frameCount; i++)
        {
            rects.Add(new SpriteRect
            {
                name = $"{stem}_{i:00}",
                spriteID = GUID.Generate(),
                rect = new Rect(i * FrameSize, 0, FrameSize, FrameSize),
                alignment = SpriteAlignment.Center,
                pivot = new Vector2(0.5f, 0.5f),
            });
        }
        provider.SetSpriteRects(rects.ToArray());
        provider.Apply();
        importer.SaveAndReimport();
    }

    private static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path)) return;
        string parent = System.IO.Path.GetDirectoryName(path).Replace('\\', '/');
        string leaf = System.IO.Path.GetFileName(path);
        EnsureFolder(parent);
        AssetDatabase.CreateFolder(parent, leaf);
    }
}
