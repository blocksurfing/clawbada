using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Lands the designer-exported Kraken Bind special VFX.
/// Source sheets: Spawn(9), Idle(6), Out(9), each 128x128 horizontal.
/// Runtime binding: per-target impact VFX anchored on TargetBody, so the tentacles bind around the victim.
/// Menu: Clawbada ▸ VFX ▸ Bind Kraken Bind. Headless: -executeMethod KrakenBindVfxBinder.Bind
/// </summary>
public static class KrakenBindVfxBinder
{
    private const int Kraken = 8;
    private const string SheetDir = "Assets/Art/FX/Attack/Kraken/";
    private const string SpawnPath = SheetDir + "FX_Kraken_Bind_Spawn.png";
    private const string IdlePath = SheetDir + "FX_Kraken_Bind_Idle.png";
    private const string OutPath = SheetDir + "FX_Kraken_Bind_Out.png";
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Kraken_Bind.prefab";
    private const string ClipPath = "Assets/Prefabs/VFX/Clips/FX_Kraken_Bind.anim";
    private const string ControllerPath = "Assets/Prefabs/VFX/Clips/AC_FX_Kraken_Bind.controller";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const string AutoRunMarker = "Assets/Art/FX/Attack/Kraken/.bind_kraken_bind";
    private const float Fps = 12f;
    private const int FrameWidth = 128;
    private const int FrameHeight = 128;
    private const int SpawnFrames = 9;
    private const int IdleFrames = 6;
    private const int OutFrames = 9;

    [InitializeOnLoadMethod]
    private static void AutoBindWhenRequested()
    {
        EditorApplication.delayCall += () =>
        {
            if (!File.Exists(AutoRunMarker)) return;
            File.Delete(AutoRunMarker);
            Bind();
        };
    }

    [MenuItem("Clawbada/VFX/Bind Kraken Bind")]
    public static void Bind()
    {
        SliceHorizontalSheet(SpawnPath, SpawnFrames, "Spawn");
        SliceHorizontalSheet(IdlePath, IdleFrames, "Idle");
        SliceHorizontalSheet(OutPath, OutFrames, "Out");
        var prefab = BuildCompositePrefab();

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[KrakenBindVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];
        if (lib.specialImpactByClass == null || lib.specialImpactByClass.Length < 10) lib.specialImpactByClass = new BattleVfxLibrary.VfxSlot[10];

        // Kraken Bind is a target bind/hold read, not a caster windup. Leave the class windup empty
        // and attach the full tentacle sequence to the Special impact so it plays on every hit target.
        lib.specialByClass[Kraken] = new BattleVfxLibrary.VfxSlot { prefab = null };
        lib.specialImpactByClass[Kraken] = new BattleVfxLibrary.VfxSlot
        {
            prefab = prefab,
            anchor = BattleVfxLibrary.AnchorPoint.TargetBody,
            delay = 0f,
            mirrorWithFacing = false,
            onTop = true,
        };

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[KrakenBindVfxBinder] OK — Spawn {SpawnFrames}, Idle {IdleFrames}, Out {OutFrames} @ {Fps} fps ({BattleVfxLibrary.ClipLength(prefab):F2}s) bound to specialImpactByClass[8]/Kraken Bind";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static void SliceHorizontalSheet(string path, int frameCount, string prefix)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null) throw new System.Exception($"[KrakenBindVfxBinder] missing texture importer: {path}");

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
                name = $"FX_Kraken_Bind_{prefix}_{i:00}",
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

    private static GameObject BuildCompositePrefab()
    {
        var spawnSprites = LoadSprites(SpawnPath, SpawnFrames);
        var idleSprites = LoadSprites(IdlePath, IdleFrames);
        var outSprites = LoadSprites(OutPath, OutFrames);

        var clip = new AnimationClip { frameRate = Fps };
        float spawnStart = 0f;
        float idleStart = SpawnFrames / Fps;
        float outStart = idleStart + IdleFrames / Fps;
        SetEnabledCurve(clip, "Spawn", true, spawnStart, idleStart, outStart + OutFrames / Fps);
        SetEnabledCurve(clip, "Idle", false, idleStart, outStart, outStart + OutFrames / Fps);
        SetEnabledCurve(clip, "Out", false, outStart, outStart + OutFrames / Fps, outStart + OutFrames / Fps);
        SetSpriteCurve(clip, "Spawn", spawnSprites, spawnStart);
        SetSpriteCurve(clip, "Idle", idleSprites, idleStart);
        SetSpriteCurve(clip, "Out", outSprites, outStart);

        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = false;
        settings.startTime = 0f;
        settings.stopTime = (SpawnFrames + IdleFrames + OutFrames) / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder("Assets/Prefabs/VFX/Clips");
        AssetDatabase.DeleteAsset(ClipPath);
        AssetDatabase.CreateAsset(clip, ClipPath);
        AssetDatabase.DeleteAsset(ControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(ControllerPath, clip);

        var root = new GameObject("FX_Kraken_Bind");
        try
        {
            AddLayer(root.transform, "Spawn", spawnSprites[0], startEnabled: true);
            AddLayer(root.transform, "Idle", idleSprites[0], startEnabled: false);
            AddLayer(root.transform, "Out", outSprites[0], startEnabled: false);
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            root.AddComponent<OneShotVfx>();
            AssetDatabase.DeleteAsset(PrefabPath);
            return PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    private static Sprite[] LoadSprites(string path, int expected)
    {
        var sprites = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != expected)
            throw new System.Exception($"[KrakenBindVfxBinder] {path}: expected {expected} sliced sprites, found {sprites.Length}");
        return sprites;
    }

    private static void AddLayer(Transform parent, string name, Sprite sprite, bool startEnabled)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        var sr = go.AddComponent<SpriteRenderer>();
        sr.sprite = sprite;
        sr.enabled = startEnabled;
        sr.sortingLayerName = "Foreground";
        sr.sortingOrder = 0;
    }

    private static void SetSpriteCurve(AnimationClip clip, string path, Sprite[] sprites, float startTime)
    {
        var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = path, propertyName = "m_Sprite" };
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = startTime + i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
    }

    private static void SetEnabledCurve(AnimationClip clip, string path, bool startsOn, float start, float end, float clipEnd)
    {
        var keys = new List<Keyframe>
        {
            Stepped(0f, startsOn ? 1f : 0f),
        };
        if (!startsOn) keys.Add(Stepped(Mathf.Max(0f, start - 0.001f), 0f));
        keys.Add(Stepped(start, 1f));
        keys.Add(Stepped(end, 0f));
        keys.Add(Stepped(clipEnd, 0f));
        clip.SetCurve(path, typeof(SpriteRenderer), "m_Enabled", new AnimationCurve(keys.ToArray()));
    }

    private static Keyframe Stepped(float time, float value)
    {
        return new Keyframe(time, value, float.PositiveInfinity, float.PositiveInfinity);
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
