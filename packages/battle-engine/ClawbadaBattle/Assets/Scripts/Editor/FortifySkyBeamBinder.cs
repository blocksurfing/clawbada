using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// Fortify's beams come "from the heavens" (user 2026-09-27): the designer's beam is painted inside each
/// 128 px frame, so it stopped 1 u above the frame centre. This extends it to the top of the view:
///   1. builds FX_Bulwark_Fortify_SkyBeam.png — the TOP ROW of each BottomLayer frame that has beam on it
///      (frames 0–11), 128×4 px per frame, pivot at its bottom;
///   2. adds a "SkyBeam" child to FX_Bulwark_Fortify (a direct child, so the straddle keeps it with the
///      bottom half), at the frame's top edge, with the SkyBeam component that stretches it upward;
///   3. keys the SkyBeam sprite into FX_Bulwark_Fortify.anim frame-for-frame with the beam, off after it.
/// Prefab and clip are edited IN PLACE (GUIDs kept). BulwarkFortifyVfxBinder calls Apply after a rebuild.
/// Menu: Clawbada ▸ VFX ▸ Extend Fortify Beams To The Sky. Headless: -executeMethod FortifySkyBeamBinder.Apply
/// </summary>
public static class FortifySkyBeamBinder
{
    private const string Dir = "Assets/Art/FX/Attack/Bulwark/";
    private const string BottomSheet = Dir + "FX_Bulwark_Fortify_BottomLayer.png";
    private const string SkySheet = Dir + "FX_Bulwark_Fortify_SkyBeam.png";
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Bulwark_Fortify.prefab";
    private const string ClipPath = "Assets/Prefabs/VFX/Clips/FX_Bulwark_Fortify.anim";
    private const int FrameW = 128, FrameH = 128, StripH = 4;
    private const float Fps = 12f, Ppu = 64f;

    [MenuItem("Clawbada/VFX/Extend Fortify Beams To The Sky")]
    public static void Apply()
    {
        int beamFrames = BuildStripSheet();
        var strips = AssetDatabase.LoadAllAssetsAtPath(SkySheet).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (strips.Length != beamFrames) throw new System.Exception($"[FortifySkyBeamBinder] expected {beamFrames} strips, found {strips.Length}");
        AddChild(strips[0]);
        KeyClip(strips);
        AssetDatabase.SaveAssets();
        string msg = $"[FortifySkyBeamBinder] OK — {beamFrames} beam frames extended to the top of the view";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    /// <summary>Top row of each beam frame, stacked StripH px high. Returns how many leading frames carry beam.</summary>
    private static int BuildStripSheet()
    {
        var src = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        src.LoadImage(File.ReadAllBytes(BottomSheet));
        int frames = src.width / FrameW;
        int beamFrames = 0;
        for (int f = 0; f < frames; f++)
        {
            bool any = false;
            for (int x = 0; x < FrameW && !any; x++) any = src.GetPixel(f * FrameW + x, FrameH - 1).a > 0f; // row 0 = top = y FrameH-1
            if (!any) break;
            beamFrames++;
        }
        if (beamFrames == 0) throw new System.Exception("[FortifySkyBeamBinder] no beam on the top row of the leading frames");

        var dst = new Texture2D(beamFrames * FrameW, StripH, TextureFormat.RGBA32, false);
        for (int f = 0; f < beamFrames; f++)
            for (int x = 0; x < FrameW; x++)
            {
                var c = src.GetPixel(f * FrameW + x, FrameH - 1);
                for (int y = 0; y < StripH; y++) dst.SetPixel(f * FrameW + x, y, c);
            }
        dst.Apply();
        File.WriteAllBytes(SkySheet, dst.EncodeToPNG());
        Object.DestroyImmediate(src);
        Object.DestroyImmediate(dst);
        AssetDatabase.ImportAsset(SkySheet, ImportAssetOptions.ForceUpdate);

        var importer = (TextureImporter)AssetImporter.GetAtPath(SkySheet);
        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Multiple;
        importer.spritePixelsPerUnit = Ppu;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
        importer.wrapMode = TextureWrapMode.Clamp;
        var factory = new SpriteDataProviderFactories();
        factory.Init();
        var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
        provider.InitSpriteEditorDataProvider();
        var rects = new List<SpriteRect>();
        for (int f = 0; f < beamFrames; f++)
            rects.Add(new SpriteRect
            {
                name = $"FX_Bulwark_Fortify_SkyBeam_{f:00}",
                spriteID = GUID.Generate(),
                rect = new Rect(f * FrameW, 0, FrameW, StripH),
                alignment = SpriteAlignment.Custom,
                pivot = new Vector2(0.5f, 0f),
            });
        provider.SetSpriteRects(rects.ToArray());
        provider.Apply();
        importer.SaveAndReimport();
        return beamFrames;
    }

    private static void AddChild(Sprite first)
    {
        var root = PrefabUtility.LoadPrefabContents(PrefabPath);
        try
        {
            var bottom = root.transform.Find("BottomLayer");
            if (bottom == null) throw new System.Exception("[FortifySkyBeamBinder] FX_Bulwark_Fortify has no BottomLayer child");
            var bottomSr = bottom.GetComponent<SpriteRenderer>();
            var sky = root.transform.Find("SkyBeam");
            if (sky == null) { sky = new GameObject("SkyBeam").transform; sky.SetParent(root.transform, false); }
            // The top edge of a 128 px frame at 64 PPU, relative to the layer it continues.
            sky.localPosition = bottom.localPosition + new Vector3(0f, FrameH / Ppu / 2f, 0f);
            sky.localRotation = Quaternion.identity;
            sky.localScale = Vector3.one;
            var sr = sky.GetComponent<SpriteRenderer>();
            if (sr == null) sr = sky.gameObject.AddComponent<SpriteRenderer>();
            sr.sprite = first;
            sr.sortingLayerID = bottomSr.sortingLayerID;
            sr.sortingOrder = bottomSr.sortingOrder;
            sr.sharedMaterial = bottomSr.sharedMaterial;
            sr.enabled = false;
            if (sky.GetComponent<SkyBeam>() == null) sky.gameObject.AddComponent<SkyBeam>();
            PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(root);
        }
    }

    private static void KeyClip(Sprite[] strips)
    {
        var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(ClipPath);
        if (clip == null) throw new System.Exception($"[FortifySkyBeamBinder] missing {ClipPath}");
        var spriteBinding = EditorCurveBinding.PPtrCurve("SkyBeam", typeof(SpriteRenderer), "m_Sprite");
        var keys = new ObjectReferenceKeyframe[strips.Length];
        for (int i = 0; i < strips.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = strips[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, spriteBinding, keys);

        float off = strips.Length / Fps, end = clip.length;
        var on = new AnimationCurve(new Keyframe(0f, 1f), new Keyframe(off, 0f), new Keyframe(Mathf.Max(end, off + 0.01f), 0f));
        for (int i = 0; i < on.keys.Length; i++)
        {
            AnimationUtility.SetKeyLeftTangentMode(on, i, AnimationUtility.TangentMode.Constant);
            AnimationUtility.SetKeyRightTangentMode(on, i, AnimationUtility.TangentMode.Constant);
        }
        AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("SkyBeam", typeof(SpriteRenderer), "m_Enabled"), on);
        EditorUtility.SetDirty(clip);
    }
}
