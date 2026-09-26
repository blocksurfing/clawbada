using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Binds Sentinel Rally as separate phase prefabs, matching the exported sheets:
/// Spawn one-shot, Loop persistent layered prefab, Out one-shot.
/// No umbrella/composite prefab: dev/runtime should compose Spawn → Loop → Out when Rally is applied/ends.
/// Menu: Clawbada ▸ VFX ▸ Bind Sentinel Rally. Headless: -executeMethod SentinelRallyVfxBinder.Bind
/// </summary>
public static class SentinelRallyVfxBinder
{
    private const int Sentinel = 5;
    private const string ArtDir = "Assets/Art/FX/Attack/Sentinel/";
    private const string PrefabDir = "Assets/Prefabs/VFX/";
    private const string ClipDir = "Assets/Prefabs/VFX/Clips/";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const float Fps = 12f;
    private const int FrameWidth = 128, FrameHeight = 128;
    private const int SpawnFrames = 6, LoopFrames = 15, OutFrames = 8;

    [MenuItem("Clawbada/VFX/Bind Sentinel Rally")]
    public static void Bind()
    {
        Slice("FX_Sentinel_Rally_BackRingLoop", LoopFrames);
        Slice("FX_Sentinel_Rally_FrontRingLoop", LoopFrames);
        Slice("FX_Sentinel_Rally_SparksLoop", LoopFrames);
        Slice("FX_Sentinel_Rally_SigilSpawn", SpawnFrames);
        Slice("FX_Sentinel_Rally_SigilLoop", LoopFrames);
        Slice("FX_Sentinel_Rally_SigilOut", OutFrames);

        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder("Assets/Prefabs/VFX/Clips");
        DeleteStaleComposite();

        var spawn = BuildSingleRendererPhase("FX_Sentinel_Rally_Spawn", Load("FX_Sentinel_Rally_SigilSpawn", SpawnFrames), loop: false, oneShot: true, sortingOrder: 4);
        var loop = BuildLoopPhase();
        var outFx = BuildSingleRendererPhase("FX_Sentinel_Rally_Out", Load("FX_Sentinel_Rally_SigilOut", OutFrames), loop: false, oneShot: true, sortingOrder: 4);

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[SentinelRallyVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];
        if (lib.specialImpactByClass == null || lib.specialImpactByClass.Length < 10) lib.specialImpactByClass = new BattleVfxLibrary.VfxSlot[10];

        // A three-phase Rally is not representable as one regular Special slot without lying.
        // Keep a harmless cast slot and group the phase prefabs in statusVisuals["rally"] for dev/runtime handoff.
        lib.specialByClass[Sentinel] = new BattleVfxLibrary.VfxSlot { prefab = null, castSpeed = 1f };
        lib.specialImpactByClass[Sentinel] = new BattleVfxLibrary.VfxSlot { prefab = null };
        var visuals = new List<BattleVfxLibrary.StatusVfx>(lib.statusVisuals ?? new BattleVfxLibrary.StatusVfx[0]);
        visuals.RemoveAll(v => v != null && string.Equals(v.status, "rally", System.StringComparison.OrdinalIgnoreCase));
        visuals.Add(new BattleVfxLibrary.StatusVfx { status = "rally", spawn = spawn, loop = loop, end = outFx, yOffset = 0f });
        lib.statusVisuals = visuals.ToArray();

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[SentinelRallyVfxBinder] OK — split prefabs: Spawn {BattleVfxLibrary.ClipLength(spawn):F2}s, " +
                     $"Loop {BattleVfxLibrary.ClipLength(loop):F2}s looping, Out {BattleVfxLibrary.ClipLength(outFx):F2}s; " +
                     "grouped as statusVisuals[\"rally\"], no stale umbrella FX_Sentinel_Rally prefab.";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static GameObject BuildSingleRendererPhase(string stem, Sprite[] sprites, bool loop, bool oneShot, int sortingOrder)
    {
        var clip = BuildRootSpriteClip(stem, sprites, loop);
        var controller = BuildController(stem, clip);
        var root = new GameObject(stem);
        try
        {
            var sr = root.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            sr.sortingLayerName = DepthSort.Layer;
            sr.sortingOrder = sortingOrder;
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            if (oneShot) root.AddComponent<OneShotVfx>();
            string prefabPath = PrefabDir + stem + ".prefab";
            AssetDatabase.DeleteAsset(prefabPath);
            return PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    private static GameObject BuildLoopPhase()
    {
        var back = Load("FX_Sentinel_Rally_BackRingLoop", LoopFrames);
        var front = Load("FX_Sentinel_Rally_FrontRingLoop", LoopFrames);
        var sparks = Load("FX_Sentinel_Rally_SparksLoop", LoopFrames);
        var sigil = Load("FX_Sentinel_Rally_SigilLoop", LoopFrames);
        string stem = "FX_Sentinel_Rally_Loop";

        var clip = new AnimationClip { frameRate = Fps };
        SetSpriteCurve(clip, "BackRing", back);
        SetSpriteCurve(clip, "FrontRing", front);
        SetSpriteCurve(clip, "FrontSparks", sparks);
        SetSpriteCurve(clip, "FrontSigil", sigil);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = true;
        settings.startTime = 0f;
        settings.stopTime = LoopFrames / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        var controller = BuildController(stem, clip);

        var root = new GameObject(stem);
        try
        {
            AddLayer(root.transform, "BackRing", back[0], -2);
            AddLayer(root.transform, "FrontRing", front[0], 2);
            AddLayer(root.transform, "FrontSparks", sparks[0], 3);
            AddLayer(root.transform, "FrontSigil", sigil[0], 4);
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            string prefabPath = PrefabDir + stem + ".prefab";
            AssetDatabase.DeleteAsset(prefabPath);
            return PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    private static AnimationClip BuildRootSpriteClip(string stem, Sprite[] sprites, bool loop)
    {
        var clip = new AnimationClip { frameRate = Fps };
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite"), keys);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = loop;
        settings.startTime = 0f;
        settings.stopTime = sprites.Length / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        return clip;
    }

    private static AnimatorController BuildController(string stem, AnimationClip clip)
    {
        string clipPath = ClipDir + stem + ".anim";
        string controllerPath = ClipDir + "AC_" + stem + ".controller";
        AssetDatabase.DeleteAsset(clipPath);
        AssetDatabase.CreateAsset(clip, clipPath);
        AssetDatabase.DeleteAsset(controllerPath);
        return AnimatorController.CreateAnimatorControllerAtPathWithClip(controllerPath, clip);
    }

    private static void Slice(string stem, int frameCount)
    {
        string path = ArtDir + stem + ".png";
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null) throw new System.Exception($"[SentinelRallyVfxBinder] missing texture importer: {path}");
        var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        if (texture == null) throw new System.Exception($"[SentinelRallyVfxBinder] missing texture: {path}");
        if (texture.width != frameCount * FrameWidth || texture.height != FrameHeight)
            throw new System.Exception($"[SentinelRallyVfxBinder] {path}: expected {frameCount}×128x128 ({frameCount * FrameWidth}x128), got {texture.width}x{texture.height}");

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
                rect = new Rect(i * FrameWidth, 0, FrameWidth, FrameHeight),
                alignment = SpriteAlignment.Center,
                pivot = new Vector2(0.5f, 0.5f),
            });
        }
        provider.SetSpriteRects(rects.ToArray());
        provider.Apply();
        importer.SaveAndReimport();
    }

    private static Sprite[] Load(string stem, int expected)
    {
        var sprites = AssetDatabase.LoadAllAssetsAtPath(ArtDir + stem + ".png").OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != expected)
            throw new System.Exception($"[SentinelRallyVfxBinder] {stem}: expected {expected} sliced sprites, found {sprites.Length}");
        return sprites;
    }

    private static void AddLayer(Transform parent, string name, Sprite sprite, int order)
    {
        var child = new GameObject(name);
        child.transform.SetParent(parent, false);
        var sr = child.AddComponent<SpriteRenderer>();
        sr.sprite = sprite;
        sr.sortingLayerName = DepthSort.Layer;
        sr.sortingOrder = order;
    }

    private static void SetSpriteCurve(AnimationClip clip, string path, Sprite[] sprites)
    {
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, EditorCurveBinding.PPtrCurve(path, typeof(SpriteRenderer), "m_Sprite"), keys);
    }

    private static void DeleteStaleComposite()
    {
        foreach (string path in new[]
        {
            PrefabDir + "FX_Sentinel_Rally.prefab",
            ClipDir + "FX_Sentinel_Rally.anim",
            ClipDir + "AC_FX_Sentinel_Rally.controller",
        }) AssetDatabase.DeleteAsset(path);
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
