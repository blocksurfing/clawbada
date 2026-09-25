using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Lands the designer-exported Mantis Ambush special VFX.
/// Source sheet: Assets/Art/FX/Attack/Mantis/FX_Mantis_Ambush_Slash.png
/// Runtime: one 6-frame one-shot slash spawned from the actor AttackFX anchor, and — on a turn that
/// moves and casts — the leap to the casting hex (rig state "Jump", trail FX_Mantis_Ambush_JumpEffect,
/// afterimage at the take-off hex). The trail prefab is built by MantisEffectsPrefabBuilder.
/// FX_Mantis_Ambush_PoisonEffect is deliberately NOT bound: Ambush has no poison (it ignores half the
/// target's armour), and the designer is reworking it into an armour-dissolving effect (2026-09-25).
/// Menu: Clawbada ▸ VFX ▸ Bind Mantis Ambush. Headless: -executeMethod MantisAmbushVfxBinder.Bind
/// </summary>
public static class MantisAmbushVfxBinder
{
    private const int Mantis = 1;
    private const string SheetPath = "Assets/Art/FX/Attack/Mantis/FX_Mantis_Ambush_Slash.png";
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Mantis_Ambush_Slash.prefab";
    private const string ClipPath = "Assets/Prefabs/VFX/Clips/FX_Mantis_Ambush_Slash.anim";
    private const string ControllerPath = "Assets/Prefabs/VFX/Clips/AC_FX_Mantis_Ambush_Slash.controller";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const string TrailPrefabPath = "Assets/Prefabs/VFX/FX_Mantis_Ambush_JumpEffect.prefab";
    private const float Fps = 12f;
    private const int FrameWidth = 128;
    private const int FrameHeight = 128;
    private const int Frames = 6;
    private const string AutoRunMarker = "Assets/Art/FX/Attack/Mantis/.bind_mantis_ambush";

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

    [MenuItem("Clawbada/VFX/Bind Mantis Ambush")]
    public static void Bind()
    {
        SliceHorizontalSheet();
        var prefab = BuildPrefab();

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[MantisAmbushVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];

        lib.specialByClass[Mantis] = new BattleVfxLibrary.VfxSlot
        {
            prefab = prefab,
            anchor = BattleVfxLibrary.AnchorPoint.ActorAttackFx,
            delay = 0f,
            spawnAtContact = true,   // the slash sits on the hit (swing midpoint), not on the turn start
            mirrorWithFacing = true,
            impactAt = 0f,
        };

        string dash = BindDashInto(lib);

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[MantisAmbushVfxBinder] OK — {Frames} frames @ {Fps} fps ({BattleVfxLibrary.ClipLength(prefab):F2}s) bound to specialByClass[1]/Mantis Ambush; {dash}";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    /// <summary>Binds ONLY the leap (specialDashByClass[Mantis]) — no re-slicing or prefab rebuild, so the
    /// designer's committed slash assets keep their GUIDs. Headless: -executeMethod MantisAmbushVfxBinder.BindDash</summary>
    [MenuItem("Clawbada/VFX/Bind Mantis Ambush Dash")]
    public static void BindDash()
    {
        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[MantisAmbushVfxBinder] missing {LibraryPath}");
        string msg = $"[MantisAmbushVfxBinder] OK — {BindDashInto(lib)}";
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static string BindDashInto(BattleVfxLibrary lib)
    {
        // The leap. Times are into the Jump clip (1.58 s @ 12 fps): crouch to 0.58, spring, airborne pose
        // at 0.75, settle from 0.83; the swing takes over at 1.0 rather than waiting out the recovery.
        var trail = AssetDatabase.LoadAssetAtPath<GameObject>(TrailPrefabPath);
        if (trail == null) Debug.LogWarning($"[MantisAmbushVfxBinder] no {TrailPrefabPath} — run Clawbada ▸ VFX ▸ Build Mantis Ambush Effect Prefabs; dash bound without a trail");
        if (lib.specialDashByClass == null || lib.specialDashByClass.Length < 10) lib.specialDashByClass = new BattleVfxLibrary.DashSpec[10];
        // Unity fills every slot with a default spec; make sure no other class is left with a state that would make it leap.
        for (int i = 0; i < lib.specialDashByClass.Length; i++) if (i != Mantis) lib.specialDashByClass[i] = new BattleVfxLibrary.DashSpec();
        lib.specialDashByClass[Mantis] = new BattleVfxLibrary.DashSpec
        {
            state = "Jump",
            takeoffAt = 0.58f,
            landAt = 0.83f,
            releaseAt = 1.0f,
            trail = new BattleVfxLibrary.VfxSlot { prefab = trail, anchor = BattleVfxLibrary.AnchorPoint.ActorFeet, mirrorWithFacing = true },
            afterimageAlpha = 0.6f,
            afterimageFade = 0.4f,
        };

        return $"dash bound to specialDashByClass[{Mantis}] {(trail != null ? "with" : "WITHOUT")} trail";
    }

    private static void SliceHorizontalSheet()
    {
        var importer = AssetImporter.GetAtPath(SheetPath) as TextureImporter;
        if (importer == null) throw new System.Exception($"[MantisAmbushVfxBinder] missing texture importer: {SheetPath}");

        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Multiple;
        importer.spritePixelsPerUnit = 64f;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
        importer.maxTextureSize = 1024;

        var factory = new SpriteDataProviderFactories();
        factory.Init();
        var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
        provider.InitSpriteEditorDataProvider();

        var rects = new List<SpriteRect>();
        for (int i = 0; i < Frames; i++)
        {
            rects.Add(new SpriteRect
            {
                name = $"FX_Mantis_Ambush_Slash_{i:00}",
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
        var sprites = AssetDatabase.LoadAllAssetsAtPath(SheetPath).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != Frames)
            throw new System.Exception($"[MantisAmbushVfxBinder] {SheetPath}: expected {Frames} sliced sprites, found {sprites.Length}");

        var clip = new AnimationClip { frameRate = Fps };
        var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = "", propertyName = "m_Sprite" };
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++)
            keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = false;
        settings.startTime = 0f;
        settings.stopTime = sprites.Length / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder("Assets/Prefabs/VFX/Clips");
        AssetDatabase.DeleteAsset(ClipPath);
        AssetDatabase.CreateAsset(clip, ClipPath);
        AssetDatabase.DeleteAsset(ControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(ControllerPath, clip);

        var go = new GameObject("FX_Mantis_Ambush_Slash");
        try
        {
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            sr.sortingLayerName = "Foreground";
            sr.sortingOrder = 0;
            var animator = go.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            go.AddComponent<OneShotVfx>();
            AssetDatabase.DeleteAsset(PrefabPath);
            return PrefabUtility.SaveAsPrefabAsset(go, PrefabPath);
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
}
