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
/// Runtime binding: the tentacles ARE the stun. They bind as the status visual for "stun" —
/// Spawn on the hit, Idle looping for as long as the target stays stunned (its skipped turn),
/// Out when the stun ends — parented under the victim like Haunt's sigil, so they follow it.
/// The earlier single composite (Spawn→Idle→Out as one 2 s one-shot) played Out while the
/// target was still stunned; the designer asked for the hold. No impact slot: a stun-immune
/// target takes the damage with the plain hit read and no tentacles.
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
        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder("Assets/Prefabs/VFX/Clips");
        // The old single composite is superseded by the three phase prefabs below.
        foreach (var stale in new[] { PrefabPath, ClipPath, ControllerPath }) AssetDatabase.DeleteAsset(stale);
        var spawn = BuildPhasePrefab("Spawn", LoadSprites(SpawnPath, SpawnFrames), loop: false);
        var idle = BuildPhasePrefab("Idle", LoadSprites(IdlePath, IdleFrames), loop: true);
        var outFx = BuildPhasePrefab("Out", LoadSprites(OutPath, OutFrames), loop: false);

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[KrakenBindVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];
        if (lib.specialImpactByClass == null || lib.specialImpactByClass.Length < 10) lib.specialImpactByClass = new BattleVfxLibrary.VfxSlot[10];

        // No caster windup and no impact slot: the status visual below is the whole read. The cast
        // swing runs at half speed (contact ~0.6 s instead of 0.29) so a Bind sound can build first.
        lib.specialByClass[Kraken] = new BattleVfxLibrary.VfxSlot { prefab = null, castSpeed = 0.5f };
        lib.specialImpactByClass[Kraken] = new BattleVfxLibrary.VfxSlot { prefab = null };
        var visuals = new List<BattleVfxLibrary.StatusVfx>(lib.statusVisuals ?? new BattleVfxLibrary.StatusVfx[0]);
        visuals.RemoveAll(v => v != null && string.Equals(v.status, "stun", System.StringComparison.OrdinalIgnoreCase));
        visuals.Add(new BattleVfxLibrary.StatusVfx { status = "stun", spawn = spawn, loop = idle, end = outFx, yOffset = 0f });
        lib.statusVisuals = visuals.ToArray();

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[KrakenBindVfxBinder] OK — stun status visual: Spawn {SpawnFrames} ({BattleVfxLibrary.ClipLength(spawn):F2}s), Idle {IdleFrames} loop ({BattleVfxLibrary.ClipLength(idle):F2}s), Out {OutFrames} ({BattleVfxLibrary.ClipLength(outFx):F2}s) @ {Fps} fps — statusVisuals[\"stun\"] (no caster/impact slot)";
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

    /// <summary>One phase as its own prefab: a single SpriteRenderer animated by a sprite-keyframe
    /// clip. One-shots carry OneShotVfx (destroyed after the clip); the loop lives until the status ends.</summary>
    private static GameObject BuildPhasePrefab(string phase, Sprite[] sprites, bool loop)
    {
        string stem = $"FX_Kraken_Bind_{phase}";
        string clipPath = $"Assets/Prefabs/VFX/Clips/{stem}.anim";
        string controllerPath = $"Assets/Prefabs/VFX/Clips/AC_{stem}.controller";
        string prefabPath = $"Assets/Prefabs/VFX/{stem}.prefab";

        var clip = new AnimationClip { frameRate = Fps };
        SetSpriteCurve(clip, "", sprites, 0f);            // path "" — the root's own SpriteRenderer
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = loop;
        settings.startTime = 0f;
        settings.stopTime = sprites.Length / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        AssetDatabase.DeleteAsset(clipPath);
        AssetDatabase.CreateAsset(clip, clipPath);
        AssetDatabase.DeleteAsset(controllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(controllerPath, clip);

        var root = new GameObject(stem);
        try
        {
            var sr = root.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            // Inside the victim's SortingGroup the layer outranks the order: Foreground draws over
            // the rig's Default-layer parts — the tentacles wrap the body, not hide behind it.
            sr.sortingLayerName = "Foreground";
            sr.sortingOrder = 0;
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            if (!loop) root.AddComponent<OneShotVfx>();
            AssetDatabase.DeleteAsset(prefabPath);
            return PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
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

    private static void SetSpriteCurve(AnimationClip clip, string path, Sprite[] sprites, float startTime)
    {
        var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = path, propertyName = "m_Sprite" };
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = startTime + i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
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
