using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Lands Reaver Rend as a target-anchored cinematic rupture: Spawn -> Attack -> Out from
/// the designer-exported 128x128 sheets. The hit beat lands during the Attack strip, not
/// at spawn start, so damage/impact reads line up with the scythe/rupture frame.
/// Menu: Clawbada ▸ VFX ▸ Bind Reaver Rend. Headless: -executeMethod ReaverRendVfxBinder.Bind
/// </summary>
public static class ReaverRendVfxBinder
{
    private const int Reaver = 6;
    private const string SheetDir = "Assets/Art/FX/Attack/Reaver/";
    private const string SpawnPath = SheetDir + "FX_Reaver_Rend_Spawn.png";
    private const string AttackPath = SheetDir + "FX_Reaver_Rend_Attack.png";
    private const string OutPath = SheetDir + "FX_Reaver_Rend_Out.png";
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Reaver_Rend.prefab";
    private const string ClipPath = "Assets/Prefabs/VFX/Clips/FX_Reaver_Rend.anim";
    private const string ControllerPath = "Assets/Prefabs/VFX/Clips/AC_FX_Reaver_Rend.controller";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const float Fps = 12f;
    private const int FrameWidth = 128;
    private const int FrameHeight = 128;
    private const int SpawnFrames = 6;
    private const int AttackFrames = 7;
    private const int OutFrames = 7;
    // Spawn is 0.50s. Frame 2 of Attack is the rupture/hit read => 0.50 + 2/12 = 0.67s.
    private const float ImpactAt = (SpawnFrames + 2f) / Fps;

    [MenuItem("Clawbada/VFX/Bind Reaver Rend")]
    public static void Bind()
    {
        SliceHorizontalSheet(SpawnPath, SpawnFrames, "Spawn");
        SliceHorizontalSheet(AttackPath, AttackFrames, "Attack");
        SliceHorizontalSheet(OutPath, OutFrames, "Out");
        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder("Assets/Prefabs/VFX/Clips");
        var prefab = BuildPrefab();

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[ReaverRendVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];
        if (lib.specialImpactByClass == null || lib.specialImpactByClass.Length < 10) lib.specialImpactByClass = new BattleVfxLibrary.VfxSlot[10];

        lib.specialByClass[Reaver] = new BattleVfxLibrary.VfxSlot
        {
            prefab = prefab,
            anchor = BattleVfxLibrary.AnchorPoint.TargetImpactFx,
            delay = 0f,
            mirrorWithFacing = true,
            impactAt = ImpactAt,
            shakeAmplitude = 0.035f,
            shakeSeconds = 0.25f,
        };
        // No separate per-target impact sheet yet. The one cinematic prefab already contains the rupture hit.
        lib.specialImpactByClass[Reaver] = new BattleVfxLibrary.VfxSlot { prefab = null };

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[ReaverRendVfxBinder] OK — Spawn {SpawnFrames}, Attack {AttackFrames}, Out {OutFrames} @ {Fps} fps " +
                     $"({BattleVfxLibrary.ClipLength(prefab):F2}s), impactAt {ImpactAt:F2}s, target anchored → specialByClass[6]/Reaver Rend";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static void SliceHorizontalSheet(string path, int frameCount, string prefix)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null) throw new System.Exception($"[ReaverRendVfxBinder] missing texture importer: {path}");

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
                name = $"FX_Reaver_Rend_{prefix}_{i:00}",
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

    private static GameObject BuildPrefab()
    {
        var spawn = LoadSprites(SpawnPath, SpawnFrames);
        var attack = LoadSprites(AttackPath, AttackFrames);
        var outFx = LoadSprites(OutPath, OutFrames);
        float spawnEnd = SpawnFrames / Fps;
        float attackEnd = spawnEnd + AttackFrames / Fps;
        float total = attackEnd + OutFrames / Fps;

        var clip = new AnimationClip { frameRate = Fps };
        SetSpriteCurve(clip, "Spawn", spawn, 0f);
        SetSpriteCurve(clip, "Attack", attack, spawnEnd);
        SetSpriteCurve(clip, "Out", outFx, attackEnd);
        SetEnabledCurve(clip, "Spawn", 0f, spawnEnd, total);
        SetEnabledCurve(clip, "Attack", spawnEnd, attackEnd, total);
        SetEnabledCurve(clip, "Out", attackEnd, total, total);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = false;
        settings.startTime = 0f;
        settings.stopTime = total;
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        AssetDatabase.DeleteAsset(ClipPath);
        AssetDatabase.CreateAsset(clip, ClipPath);
        AssetDatabase.DeleteAsset(ControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(ControllerPath, clip);

        var root = new GameObject("FX_Reaver_Rend");
        try
        {
            AddLayer(root.transform, "Spawn", spawn[0], 0);
            AddLayer(root.transform, "Attack", attack[0], 1);
            AddLayer(root.transform, "Out", outFx[0], 2);
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

    private static void AddLayer(Transform parent, string name, Sprite sprite, int order)
    {
        var child = new GameObject(name);
        child.transform.SetParent(parent, false);
        var sr = child.AddComponent<SpriteRenderer>();
        sr.sprite = sprite;
        sr.sortingLayerName = DepthSort.Layer;
        sr.sortingOrder = order;
        // Keep every child GameObject active. The animation toggles SpriteRenderer.m_Enabled;
        // if Attack/Out GameObjects are inactive, Unity cannot animate them on at runtime.
        sr.enabled = order == 0;
    }

    private static Sprite[] LoadSprites(string path, int expected)
    {
        var sprites = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != expected)
            throw new System.Exception($"[ReaverRendVfxBinder] {path}: expected {expected} sliced sprites, found {sprites.Length}");
        return sprites;
    }

    private static void SetSpriteCurve(AnimationClip clip, string path, Sprite[] sprites, float start)
    {
        var binding = EditorCurveBinding.PPtrCurve(path, typeof(SpriteRenderer), "m_Sprite");
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = start + i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
    }

    private static void SetEnabledCurve(AnimationClip clip, string path, float on, float off, float total)
    {
        var curve = new AnimationCurve();
        if (on > 0f) curve.AddKey(0f, 0f);
        curve.AddKey(on, 1f);
        if (off < total) curve.AddKey(off, 0f);
        curve.AddKey(total, off >= total ? 1f : 0f);
        for (int i = 0; i < curve.keys.Length; i++)
        {
            AnimationUtility.SetKeyLeftTangentMode(curve, i, AnimationUtility.TangentMode.Constant);
            AnimationUtility.SetKeyRightTangentMode(curve, i, AnimationUtility.TangentMode.Constant);
        }
        AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve(path, typeof(SpriteRenderer), "m_Enabled"), curve);
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
