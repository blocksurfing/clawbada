using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Optional Inferno follow-up VFX handoff: EmberScatter (one-shot at the explosion)
/// and FirePatch (looping hazard marker spawned later by gameplay/dev logic).
/// This binder creates assets only; it intentionally does not change BattleVfxLibrary slots.
/// Menu: Clawbada ▸ VFX ▸ Bind Ember Inferno Hazard VFX. Headless: -executeMethod InfernoHazardVfxBinder.Bind
/// </summary>
public static class InfernoHazardVfxBinder
{
    private const string ArtDir = "Assets/Art/FX/Attack/Ember/";
    private const string PrefabDir = "Assets/Prefabs/VFX/";
    private const string ClipDir = "Assets/Prefabs/VFX/Clips/";
    private const float Fps = 12f;

    [MenuItem("Clawbada/VFX/Bind Ember Inferno Hazard VFX")]
    public static void Bind()
    {
        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder("Assets/Prefabs/VFX/Clips");
        var scatter = BuildPrefab("FX_Ember_Inferno_EmberScatter", frameWidth: 16, frameHeight: 16, frameCount: 4, loop: false, oneShot: true, sortingOrder: 8);
        var patch = BuildPrefab("FX_Ember_Inferno_FirePatch", frameWidth: 48, frameHeight: 16, frameCount: 4, loop: true, oneShot: false, sortingOrder: 1);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[InfernoHazardVfxBinder] OK — EmberScatter 4×16x16 {BattleVfxLibrary.ClipLength(scatter):F2}s one-shot + " +
                     $"FirePatch 4×48x16 loop {BattleVfxLibrary.ClipLength(patch):F2}s. No BattleVfxLibrary runtime binding changed; dev should spawn these from Inferno impact/hazard logic.";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static GameObject BuildPrefab(string name, int frameWidth, int frameHeight, int frameCount, bool loop, bool oneShot, int sortingOrder)
    {
        string sheet = ArtDir + name + ".png";
        SliceHorizontalSheet(sheet, name, frameWidth, frameHeight, frameCount);
        var sprites = AssetDatabase.LoadAllAssetsAtPath(sheet).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != frameCount)
            throw new System.Exception($"[InfernoHazardVfxBinder] {sheet}: expected {frameCount} sliced sprites, found {sprites.Length}");

        var clip = new AnimationClip { frameRate = Fps };
        var binding = EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite");
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = loop;
        settings.startTime = 0f;
        settings.stopTime = sprites.Length / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        string clipPath = ClipDir + name + ".anim";
        string controllerPath = ClipDir + "AC_" + name + ".controller";
        string prefabPath = PrefabDir + name + ".prefab";
        AssetDatabase.DeleteAsset(clipPath);
        AssetDatabase.CreateAsset(clip, clipPath);
        AssetDatabase.DeleteAsset(controllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(controllerPath, clip);

        var go = new GameObject(name);
        try
        {
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            sr.sortingLayerName = DepthSort.Layer;
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

    private static void SliceHorizontalSheet(string path, string stem, int frameWidth, int frameHeight, int frameCount)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null) throw new System.Exception($"[InfernoHazardVfxBinder] missing texture importer: {path}");
        var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        if (texture == null) throw new System.Exception($"[InfernoHazardVfxBinder] missing texture: {path}");
        int expectedWidth = frameWidth * frameCount;
        if (texture.width != expectedWidth || texture.height != frameHeight)
            throw new System.Exception($"[InfernoHazardVfxBinder] {path}: expected {frameCount} frames of {frameWidth}x{frameHeight} ({expectedWidth}x{frameHeight}), got {texture.width}x{texture.height}");

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
                rect = new Rect(i * frameWidth, 0, frameWidth, frameHeight),
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
