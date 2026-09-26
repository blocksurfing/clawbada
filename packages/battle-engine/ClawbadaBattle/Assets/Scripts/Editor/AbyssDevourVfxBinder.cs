using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Binds Abyss Devour: the designer's prefab (Assets/Prefabs/VFX/FX_Abyss_Devour.prefab — children
/// AbyssSpawn / AbyssIdle / SuckIdle / AbyssOut, one sheet each, 5 frames @ 10 fps) driven by a clip this
/// binder BUILDS so the soul-suck loops: Spawn once, Idle + Suck looped to fill ~<see cref="LoopSeconds"/>,
/// Out once. The designer's own 1.5 s clip stays untouched on disk; the controller's state is pointed at
/// the built one. Cinematic at the target's feet with the hit beat at 0.5 s (the abyss has just opened),
/// the arena dimmed under the lobsters for the duration. "Suck*" renders above the victim, the rest below.
///
/// Menu: Clawbada ▸ VFX ▸ Bind Abyss Devour. Headless: -executeMethod AbyssDevourVfxBinder.Bind
/// </summary>
public static class AbyssDevourVfxBinder
{
    private const int Abyss = 7;
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Abyss_Devour.prefab";
    private const string ControllerPath = "Assets/Prefabs/VFX/Clips/AC_FX_Abyss_Devour.controller";
    private const string LoopClipPath = "Assets/Prefabs/VFX/Clips/FX_Abyss_Devour_Loop.anim";
    private const string ArtDir = "Assets/Art/FX/Attack/Abyss/";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const float Fps = 10f;
    private const float ImpactAt = 0.5f;
    /// <summary>Requested length of the whole effect (user: "loop for roughly 3.5 seconds"); the idle loop count is rounded to fit.</summary>
    private const float LoopSeconds = 3.5f;
    /// <summary>Arena darkening under the lobsters while the abyss is open (see ScreenDim).</summary>
    private const float DimAlpha = 0.55f, DimFadeIn = 0.3f, DimFadeOut = 0.5f;

    [MenuItem("Clawbada/VFX/Bind Abyss Devour")]
    public static void Bind()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null) throw new System.Exception($"[AbyssDevourVfxBinder] missing {PrefabPath}");
        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[AbyssDevourVfxBinder] missing {LibraryPath}");
        var ctrl = AssetDatabase.LoadAssetAtPath<AnimatorController>(ControllerPath);
        if (ctrl == null) throw new System.Exception($"[AbyssDevourVfxBinder] missing {ControllerPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];

        SliceHorizontalSheet("FX_Abyss_Devour_Suck");
        var spawn = Sheet("FX_Abyss_Devour_Spawn");
        var idle = Sheet("FX_Abyss_Devour_Idle");
        var suck = Sheet("FX_Abyss_Devour_Suck");
        var outS = Sheet("FX_Abyss_Devour_Out");
        float f = 1f / Fps;
        float spawnEnd = spawn.Length * f, outLen = outS.Length * f;
        int loops = Mathf.Max(1, Mathf.RoundToInt((LoopSeconds - spawnEnd - outLen) / (idle.Length * f)));
        float idleEnd = spawnEnd + loops * idle.Length * f;
        float total = idleEnd + outLen;

        var clip = new AnimationClip { frameRate = Fps };
        Sprites(clip, "AbyssSpawn", spawn, 0f, 1);
        Sprites(clip, "AbyssIdle", idle, spawnEnd, loops);
        LoopUntil(clip, "SuckIdle", suck, spawnEnd, idleEnd);
        Sprites(clip, "AbyssOut", outS, idleEnd, 1);
        Enabled(clip, "AbyssSpawn", 0f, spawnEnd, total);
        Enabled(clip, "AbyssIdle", spawnEnd, idleEnd, total);
        Enabled(clip, "SuckIdle", spawnEnd, idleEnd, total);
        Enabled(clip, "AbyssOut", idleEnd, total, total);
        AssetDatabase.DeleteAsset(LoopClipPath);
        AssetDatabase.CreateAsset(clip, LoopClipPath);

        var state = ctrl.layers[0].stateMachine.defaultState;
        if (state == null) throw new System.Exception("[AbyssDevourVfxBinder] the Devour controller has no default state");
        state.motion = clip;
        EditorUtility.SetDirty(ctrl);

        lib.specialByClass[Abyss] = new BattleVfxLibrary.VfxSlot
        {
            prefab = prefab,
            anchor = BattleVfxLibrary.AnchorPoint.TargetFeet,
            mirrorWithFacing = false,
            impactAt = ImpactAt,
            frontChildPrefix = "Suck",
            dimAlpha = DimAlpha, dimFadeIn = DimFadeIn, dimFadeOut = DimFadeOut,
        };
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        Debug.Log($"[AbyssDevourVfxBinder] OK — built {total:F2}s loop clip (spawn {spawnEnd:F2}s + idle×{loops} to {idleEnd:F2}s + out {outLen:F2}s), " +
                  $"impactAt {ImpactAt:F2}s, dim {DimAlpha:F2} in {DimFadeIn:F2}s out {DimFadeOut:F2}s; prefab now reports {BattleVfxLibrary.ClipLength(prefab):F2}s; " +
                  "front children 'Suck*' above the target, the rest below → specialByClass[7]/Abyss Devour");
    }

    private static Sprite[] Sheet(string stem)
    {
        var sprites = AssetDatabase.LoadAllAssetsAtPath(ArtDir + stem + ".png").OfType<Sprite>()
            .OrderBy(s => s.name, Comparer<string>.Create(EditorUtility.NaturalCompare)).ToArray();
        if (sprites.Length == 0) throw new System.Exception($"[AbyssDevourVfxBinder] no sprites in {ArtDir}{stem}.png — is it sliced?");
        return sprites;
    }

    private static void SliceHorizontalSheet(string stem)
    {
        string path = ArtDir + stem + ".png";
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null) throw new System.Exception($"[AbyssDevourVfxBinder] missing texture importer: {path}");
        var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        if (texture == null) throw new System.Exception($"[AbyssDevourVfxBinder] missing texture: {path}");
        if (texture.height != 128 || texture.width % 128 != 0) throw new System.Exception($"[AbyssDevourVfxBinder] {path}: expected 128px-high horizontal 128x128 frames, got {texture.width}x{texture.height}");
        int frameCount = texture.width / 128;

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
                rect = new Rect(i * 128, 0, 128, 128),
                alignment = SpriteAlignment.Center,
                pivot = new Vector2(0.5f, 0.5f),
            });
        }
        provider.SetSpriteRects(rects.ToArray());
        provider.Apply();
        importer.SaveAndReimport();
    }

    /// <summary>Step the child's sprite through the sheet from <paramref name="start"/>, <paramref name="loops"/> times over.</summary>
    private static void Sprites(AnimationClip clip, string path, Sprite[] sprites, float start, int loops)
    {
        var keys = new ObjectReferenceKeyframe[sprites.Length * loops];
        for (int l = 0; l < loops; l++)
            for (int i = 0; i < sprites.Length; i++)
                keys[l * sprites.Length + i] = new ObjectReferenceKeyframe { time = start + (l * sprites.Length + i) / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, EditorCurveBinding.PPtrCurve(path, typeof(SpriteRenderer), "m_Sprite"), keys);
    }

    /// <summary>Loop a sheet for a fixed time window, allowing Suck to have a different frame count than the ground idle.</summary>
    private static void LoopUntil(AnimationClip clip, string path, Sprite[] sprites, float start, float end)
    {
        var keys = new List<ObjectReferenceKeyframe>();
        float t = start;
        int i = 0;
        while (t < end - 0.0001f)
        {
            keys.Add(new ObjectReferenceKeyframe { time = t, value = sprites[i % sprites.Length] });
            i++;
            t = start + i / Fps;
        }
        AnimationUtility.SetObjectReferenceCurve(clip, EditorCurveBinding.PPtrCurve(path, typeof(SpriteRenderer), "m_Sprite"), keys.ToArray());
    }

    /// <summary>The child renders only for on ≤ t &lt; off (stepped). A key at <paramref name="total"/> pins the clip's length.</summary>
    private static void Enabled(AnimationClip clip, string path, float on, float off, float total)
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
}
