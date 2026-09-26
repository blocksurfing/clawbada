using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Runtime binding for the designer's Bulwark Fortify drop (design/vfx-specials).
/// Current Fortify export is two continuous 39-frame 128x128 layers:
///  • BottomLayer — under/behind the lobster
///  • UpperLayer  — over/in-front of the lobster
/// and fills BattleVfxLibrary.specialByClass[Bulwark].
///
/// Menu: Clawbada ▸ VFX ▸ Bind Bulwark Fortify. Headless: -executeMethod BulwarkFortifyVfxBinder.Bind
/// </summary>
public static class BulwarkFortifyVfxBinder
{
    private const int Bulwark = 0;
    private const string SheetDir = "Assets/Art/FX/Attack/Bulwark/";
    private const string PrefabDir = "Assets/Prefabs/VFX/";
    private const string ClipDir = "Assets/Prefabs/VFX/Clips/";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";

    private const string PrefabPath = PrefabDir + "FX_Bulwark_Fortify.prefab";
    private const string ClipPath = ClipDir + "FX_Bulwark_Fortify.anim";
    private const string ControllerPath = ClipDir + "AC_FX_Bulwark_Fortify.controller";

    private const float Fps = 12f;
    private const int Frames = 39;
    private const int FrameWidth = 128;
    private const int FrameHeight = 128;
    private const float EndTime = Frames / Fps;
    private const float ImpactAt = 8f / Fps;

    private readonly struct LayerSpec
    {
        public readonly string Child;
        public readonly string Sheet;
        public readonly bool Over;

        public LayerSpec(string child, string sheet, bool over)
        {
            Child = child;
            Sheet = sheet;
            Over = over;
        }
    }

    private static readonly LayerSpec[] Layers =
    {
        new("BottomLayer", SheetDir + "FX_Bulwark_Fortify_BottomLayer.png", false),
        new("UpperLayer",  SheetDir + "FX_Bulwark_Fortify_UpperLayer.png",  true),
    };

    [MenuItem("Clawbada/VFX/Bind Bulwark Fortify")]
    public static void Bind()
    {
        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder("Assets/Prefabs/VFX/Clips");
        EnsureSlicedSheets();
        var prefab = BuildPrefab();

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[BulwarkFortifyVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];

        lib.specialByClass[Bulwark] = new BattleVfxLibrary.VfxSlot
        {
            prefab = prefab,
            // Fortify is a self-buff/shield read around the actor, centered on feet/body volume.
            anchor = BattleVfxLibrary.AnchorPoint.ActorFeet,
            delay = 0f,
            mirrorWithFacing = false,
            impactAt = ImpactAt,
            // UpperLayer draws in front of the caster; BottomLayer stays behind/under it.
            frontChildPrefix = "Upper",
            rowsCovered = 1,
        };

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        string msg = $"[BulwarkFortifyVfxBinder] OK — {prefab.name}: 2 layers × {Frames} frames ({FrameWidth}x{FrameHeight}) @ {Fps} fps = {BattleVfxLibrary.ClipLength(prefab):F2}s, impactAt {ImpactAt:F2}s, Bottom under / Upper over → specialByClass[0]/Bulwark Fortify";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static void EnsureSlicedSheets()
    {
        foreach (var layer in Layers)
        {
            var importer = AssetImporter.GetAtPath(layer.Sheet) as TextureImporter;
            if (importer == null) throw new System.Exception($"[BulwarkFortifyVfxBinder] missing texture importer for {layer.Sheet}");

            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Multiple;
            importer.spritePixelsPerUnit = 64f;
            importer.filterMode = FilterMode.Point;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.mipmapEnabled = false;
            importer.alphaIsTransparency = true;
            importer.maxTextureSize = 8192;

            var (rawWidth, rawHeight) = ReadPngSize(layer.Sheet);
            if (rawHeight != FrameHeight || rawWidth != Frames * FrameWidth)
            {
                throw new System.Exception($"[BulwarkFortifyVfxBinder] {layer.Sheet}: expected {Frames} frames of {FrameWidth}x{FrameHeight}, got raw PNG {rawWidth}x{rawHeight}");
            }

            var factory = new SpriteDataProviderFactories();
            factory.Init();
            var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
            provider.InitSpriteEditorDataProvider();

            var rects = new List<SpriteRect>();
            for (int i = 0; i < Frames; i++)
            {
                rects.Add(new SpriteRect
                {
                    name = $"{System.IO.Path.GetFileNameWithoutExtension(layer.Sheet)}_{i:00}",
                    spriteID = GUID.Generate(),
                    rect = new Rect(i * FrameWidth, 0, FrameWidth, FrameHeight),
                    alignment = SpriteAlignment.Center,
                    pivot = new Vector2(0.5f, 0.5f),
                });
            }
            provider.SetSpriteRects(rects.ToArray());
            provider.Apply();
            importer.SaveAndReimport();
        }
    }

    private static (int width, int height) ReadPngSize(string assetPath)
    {
        var absolute = System.IO.Path.Combine(System.IO.Directory.GetCurrentDirectory(), assetPath);
        var bytes = System.IO.File.ReadAllBytes(absolute);
        if (bytes.Length < 24 || bytes[0] != 0x89 || bytes[1] != 0x50 || bytes[2] != 0x4E || bytes[3] != 0x47)
            throw new System.Exception($"[BulwarkFortifyVfxBinder] not a PNG: {assetPath}");
        int width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        int height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
        return (width, height);
    }

    private static GameObject BuildPrefab()
    {
        var loaded = new Dictionary<string, Sprite[]>();
        foreach (var layer in Layers)
        {
            var sprites = AssetDatabase.LoadAllAssetsAtPath(layer.Sheet)
                .OfType<Sprite>()
                .OrderBy(s => s.name)
                .ToArray();
            if (sprites.Length != Frames)
                throw new System.Exception($"[BulwarkFortifyVfxBinder] {layer.Sheet}: expected {Frames} sliced sprites, found {sprites.Length}");
            loaded[layer.Child] = sprites;
        }

        var clip = new AnimationClip { frameRate = Fps };
        foreach (var layer in Layers) AddLayerCurves(clip, layer, loaded[layer.Child]);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = false;
        settings.startTime = 0f;
        settings.stopTime = EndTime;
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        AssetDatabase.DeleteAsset(ClipPath);
        AssetDatabase.CreateAsset(clip, ClipPath);
        AssetDatabase.DeleteAsset(ControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(ControllerPath, clip);

        AssetDatabase.DeleteAsset(PrefabPath);
        var root = new GameObject("FX_Bulwark_Fortify");
        try
        {
            root.AddComponent<OneShotVfx>();
            foreach (var layer in Layers)
            {
                var child = new GameObject(layer.Child);
                child.transform.SetParent(root.transform, false);
                var sr = child.AddComponent<SpriteRenderer>();
                sr.sprite = loaded[layer.Child].FirstOrDefault(s => s != null) ?? loaded[layer.Child][0];
                sr.sortingLayerName = DepthSort.Layer;
                sr.sortingOrder = layer.Over ? 1 : -1;
                sr.enabled = true;
            }
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            return PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    private static void AddLayerCurves(AnimationClip clip, LayerSpec layer, Sprite[] sprites)
    {
        var spriteBinding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = layer.Child, propertyName = "m_Sprite" };
        var spriteKeys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++)
        {
            spriteKeys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        }
        AnimationUtility.SetObjectReferenceCurve(clip, spriteBinding, spriteKeys);
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
