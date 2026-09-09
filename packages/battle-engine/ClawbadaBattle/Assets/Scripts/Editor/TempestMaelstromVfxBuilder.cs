using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Builds the designer-owned layered Unity animation asset for Tempest Maelstrom.
/// This creates the actual animated prefab/clip that dev can later attach to
/// battle runtime. It does NOT bind BattleVfxLibrary or edit BattleScene.
/// </summary>
public static class TempestMaelstromVfxBuilder
{
    private const string Folder = "Assets/Art/FX/Attack/Tempest";
    private const string CloudLeftPath = Folder + "/FX_Tempest_Maelstrom_CloudLeft_Atlas.png";
    private const string CloudRightPath = Folder + "/FX_Tempest_Maelstrom_CloudRight_Atlas.png";
    private const string LeavesPath = Folder + "/FX_Tempest_Maelstrom_Leaves_Atlas.png";
    private const string HitPath = Folder + "/FX_Tempest_Maelstrom_Hit.png";
    private const string FlashPath = Folder + "/FX_Tempest_Maelstrom_Flash.png";

    private const string ClipsFolder = "Assets/Prefabs/VFX/Clips";
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom.prefab";
    private const string ClipPath = ClipsFolder + "/FX_Tempest_Maelstrom.anim";
    private const string ControllerPath = ClipsFolder + "/AC_FX_Tempest_Maelstrom.controller";

    private const int FullFrameWidth = 640;
    private const int FullFrameHeight = 360;
    private const int FullLayerFrames = 24;
    private const int FullLayerColumns = 6;
    private const int FullLayerRows = 4;
    private const int HitFrameWidth = 32;
    private const int HitFrameHeight = 32;
    private const int HitFrames = 5;
    private const float SampleRate = 24f;

    [MenuItem("Clawbada/VFX/Build Tempest Maelstrom Animation Asset")]
    public static void Build()
    {
        SliceGridSheet(CloudLeftPath, FullFrameWidth, FullFrameHeight, FullLayerFrames, FullLayerColumns, FullLayerRows, "CloudLeft");
        SliceGridSheet(CloudRightPath, FullFrameWidth, FullFrameHeight, FullLayerFrames, FullLayerColumns, FullLayerRows, "CloudRight");
        SliceGridSheet(LeavesPath, FullFrameWidth, FullFrameHeight, FullLayerFrames, FullLayerColumns, FullLayerRows, "Leaves");
        SliceHorizontalSheet(HitPath, HitFrameWidth, HitFrameHeight, HitFrames, "Hit");
        ImportFlash();

        var cloudLeft = LoadSprites(CloudLeftPath, FullLayerFrames);
        var cloudRight = LoadSprites(CloudRightPath, FullLayerFrames);
        var leaves = LoadSprites(LeavesPath, FullLayerFrames);
        var hit = LoadSprites(HitPath, HitFrames);
        var flash = AssetDatabase.LoadAssetAtPath<Sprite>(FlashPath);
        if (flash == null)
        {
            Debug.LogError($"[TempestMaelstromVfxBuilder] Missing flash sprite at {FlashPath}");
            return;
        }

        EnsureFolder("Assets/Prefabs");
        EnsureFolder("Assets/Prefabs/VFX");
        EnsureFolder(ClipsFolder);

        var root = new GameObject("FX_Tempest_Maelstrom");
        try
        {
            var left = AddLayer(root.transform, "Cloud_Left", cloudLeft[0], 10);
            var right = AddLayer(root.transform, "Cloud_Right", cloudRight[0], 11);
            var leaf = AddLayer(root.transform, "Leaves", leaves[0], 12);
            var flashGo = AddLayer(root.transform, "Flash", flash, 30);
            var hitA = AddLayer(root.transform, "Hit_A", hit[0], 40);
            var hitB = AddLayer(root.transform, "Hit_B", hit[0], 40);
            var hitC = AddLayer(root.transform, "Hit_C", hit[0], 40);

            left.transform.localPosition = new Vector3(-10f, 0f, 0f);
            right.transform.localPosition = new Vector3(10f, 0f, 0f);
            leaf.transform.localPosition = Vector3.zero;
            flashGo.transform.localPosition = Vector3.zero;
            hitA.transform.localPosition = new Vector3(-1.1f, -1.55f, 0f);
            hitB.transform.localPosition = new Vector3(0f, -1.4f, 0f);
            hitC.transform.localPosition = new Vector3(1.1f, -1.55f, 0f);

            SetAlpha(leaf, 0f);
            SetAlpha(flashGo, 0f);
            SetAlpha(hitA, 0f);
            SetAlpha(hitB, 0f);
            SetAlpha(hitC, 0f);

            var clip = BuildClip(cloudLeft, cloudRight, leaves, hit, flash);
            AssetDatabase.DeleteAsset(ClipPath);
            AssetDatabase.CreateAsset(clip, ClipPath);

            AssetDatabase.DeleteAsset(ControllerPath);
            var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(ControllerPath, clip);
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            root.AddComponent<OneShotVfx>();

            AssetDatabase.DeleteAsset(PrefabPath);
            PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("[TempestMaelstromVfxBuilder] Built layered animation asset: FX_Tempest_Maelstrom prefab/clip/controller. Not bound to battle runtime.");
    }

    private static AnimationClip BuildClip(Sprite[] cloudLeft, Sprite[] cloudRight, Sprite[] leaves, Sprite[] hit, Sprite flash)
    {
        var clip = new AnimationClip { frameRate = SampleRate };

        // Cloud buildup first: clouds slide from off-screen into center over 2 seconds.
        SetLocalXCurve(clip, "Cloud_Left", 0f, -10f, 2.0f, 0f);
        SetLocalXCurve(clip, "Cloud_Right", 0f, 10f, 2.0f, 0f);
        SetLoopingSpriteCurve(clip, "Cloud_Left", cloudLeft, 0f, 7.75f);
        SetLoopingSpriteCurve(clip, "Cloud_Right", cloudRight, 0f, 7.75f);

        // Leaves start after the cloud entrance begins to settle, then loop during the storm hold.
        SetAlphaCurve(clip, "Leaves", new[] { Key(0f, 0f), Key(2.0f, 0f), Key(2.25f, 1f), Key(7.45f, 1f), Key(8.0f, 0f) });
        SetLoopingSpriteCurve(clip, "Leaves", leaves, 2.0f, 7.75f);

        // Lightning flash after the 5-second storm hold.
        SetAlphaCurve(clip, "Flash", new[] { Key(0f, 0f), Key(7.0f, 0f), Key(7.08f, 0.9f), Key(7.18f, 0.45f), Key(7.30f, 0f), Key(8.0f, 0f) });

        // Hit markers for designer timing only. Dev should spawn the hit sprite per living enemy after flash.
        foreach (var path in new[] { "Hit_A", "Hit_B", "Hit_C" })
        {
            SetAlphaCurve(clip, path, new[] { Key(0f, 0f), Key(7.22f, 0f), Key(7.25f, 1f), Key(7.45f, 1f), Key(7.55f, 0f), Key(8.0f, 0f) });
            SetSpriteCurve(clip, path, hit, 7.25f);
        }

        // Tail fade for storm layers.
        SetAlphaCurve(clip, "Cloud_Left", new[] { Key(0f, 1f), Key(7.45f, 1f), Key(8.0f, 0f) });
        SetAlphaCurve(clip, "Cloud_Right", new[] { Key(0f, 1f), Key(7.45f, 1f), Key(8.0f, 0f) });

        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = false;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        return clip;
    }

    private static GameObject AddLayer(Transform parent, string name, Sprite sprite, int sortingOrder)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        var sr = go.AddComponent<SpriteRenderer>();
        sr.sprite = sprite;
        sr.sortingLayerName = "Foreground";
        sr.sortingOrder = sortingOrder;
        return go;
    }

    private static void SetAlpha(GameObject go, float alpha)
    {
        var sr = go.GetComponent<SpriteRenderer>();
        var color = sr.color;
        color.a = alpha;
        sr.color = color;
    }

    private static Sprite[] LoadSprites(string path, int expected)
    {
        AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
        var sprites = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != expected)
        {
            Debug.LogError($"[TempestMaelstromVfxBuilder] Expected {expected} sprites from {path}, got {sprites.Length}.");
        }
        return sprites;
    }

    private static void SetSpriteCurve(AnimationClip clip, string path, Sprite[] sprites, float startTime)
    {
        var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = path, propertyName = "m_Sprite" };
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = startTime + i / SampleRate, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
    }

    private static void SetLoopingSpriteCurve(AnimationClip clip, string path, Sprite[] sprites, float startTime, float endTime)
    {
        var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = path, propertyName = "m_Sprite" };
        var keys = new List<ObjectReferenceKeyframe>();
        int frame = 0;
        for (float time = startTime; time <= endTime; time += 1f / SampleRate)
        {
            keys.Add(new ObjectReferenceKeyframe { time = time, value = sprites[frame % sprites.Length] });
            frame++;
        }
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys.ToArray());
    }

    private static void SetLocalXCurve(AnimationClip clip, string path, float t0, float x0, float t1, float x1)
    {
        var curve = AnimationCurve.EaseInOut(t0, x0, t1, x1);
        clip.SetCurve(path, typeof(Transform), "m_LocalPosition.x", curve);
    }

    private static void SetAlphaCurve(AnimationClip clip, string path, Keyframe[] keys)
    {
        var curve = new AnimationCurve(keys);
        clip.SetCurve(path, typeof(SpriteRenderer), "m_Color.a", curve);
    }

    private static Keyframe Key(float time, float value) => new Keyframe(time, value);

    private static void SliceGridSheet(string path, int frameWidth, int frameHeight, int frameCount, int columns, int rows, string prefix)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null)
        {
            Debug.LogError($"[TempestMaelstromVfxBuilder] Missing texture importer: {path}");
            return;
        }

        ConfigureSpriteImporter(importer);

        var factory = new SpriteDataProviderFactories();
        factory.Init();
        var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
        provider.InitSpriteEditorDataProvider();

        var rects = new List<SpriteRect>();
        for (int i = 0; i < frameCount; i++)
        {
            int col = i % columns;
            int row = i / columns;
            rects.Add(new SpriteRect
            {
                name = $"FX_Tempest_Maelstrom_{prefix}_{i:00}",
                spriteID = GUID.Generate(),
                rect = new Rect(col * frameWidth, (rows - 1 - row) * frameHeight, frameWidth, frameHeight),
                alignment = SpriteAlignment.Center,
                pivot = new Vector2(0.5f, 0.5f),
            });
        }

        provider.SetSpriteRects(rects.ToArray());
        provider.Apply();
        importer.SaveAndReimport();
    }

    private static void SliceHorizontalSheet(string path, int frameWidth, int frameHeight, int frameCount, string prefix)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null)
        {
            Debug.LogError($"[TempestMaelstromVfxBuilder] Missing texture importer: {path}");
            return;
        }

        ConfigureSpriteImporter(importer);

        var factory = new SpriteDataProviderFactories();
        factory.Init();
        var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
        provider.InitSpriteEditorDataProvider();

        var rects = new List<SpriteRect>();
        for (int i = 0; i < frameCount; i++)
        {
            rects.Add(new SpriteRect
            {
                name = $"FX_Tempest_Maelstrom_{prefix}_{i:00}",
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

    private static void ConfigureSpriteImporter(TextureImporter importer)
    {
        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Multiple;
        importer.spritePixelsPerUnit = 64f;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
        importer.maxTextureSize = 4096;
    }

    private static void ImportFlash()
    {
        var importer = AssetImporter.GetAtPath(FlashPath) as TextureImporter;
        if (importer == null) return;
        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Single;
        importer.spritePixelsPerUnit = 64f;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
        importer.maxTextureSize = 1024;
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
