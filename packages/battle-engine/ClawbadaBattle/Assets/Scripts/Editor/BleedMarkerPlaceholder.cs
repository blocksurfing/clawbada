using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.U2D.Sprites;
using UnityEngine;

/// <summary>
/// PLACEHOLDER board marker for the "bleed" status (Reaver Rend), drawn in code until the designer
/// replaces it — the same route as the generated HUD buttons. Two layers, looping while the status holds
/// and parented under the victim (so it follows moves), like Haunt's sigil and Kraken's stun:
///   Pool — a pulsing blood pool under the body (Default layer, order −5: beneath the rig's parts);
///   Drip — a drop forming on the body and falling into the pool (Foreground: over the body).
/// To replace: overwrite Assets/Art/FX/Status/Bleed/FX_Bleed_{Pool,Drip}.png (same frame counts and
/// sizes) and run Clawbada ▸ VFX ▸ Bind Bleed Marker with <see cref="Redraw"/> off — or bind your own
/// prefab to statusVisuals["bleed"]. Headless: -executeMethod BleedMarkerPlaceholder.Bind
/// </summary>
public static class BleedMarkerPlaceholder
{
    private const string Dir = "Assets/Art/FX/Status/Bleed/";
    private const string PoolPath = Dir + "FX_Bleed_Pool.png";
    private const string DripPath = Dir + "FX_Bleed_Drip.png";
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Bleed_Loop.prefab";
    private const string ClipPath = "Assets/Prefabs/VFX/Clips/FX_Bleed_Loop.anim";
    private const string ControllerPath = "Assets/Prefabs/VFX/Clips/AC_FX_Bleed_Loop.controller";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const float Fps = 8f;
    private const int Frames = 6;
    private const int PoolW = 48, PoolH = 20, DripW = 16, DripH = 40;
    private const float Ppu = 64f;
    /// <summary>Set false once real art sits in the PNGs, so Bind only (re)builds the prefab and binding.</summary>
    private const bool Redraw = true;

    // Palette: highlight / base / shadow + the project's universal outline.
    private static readonly Color32 Hi = new(0xE8, 0x4A, 0x3C, 255);
    private static readonly Color32 Mid = new(0xAE, 0x1F, 0x1A, 255);
    private static readonly Color32 Lo = new(0x62, 0x0E, 0x0B, 255);
    private static readonly Color32 Line = new(0x0E, 0x0E, 0x0E, 255);
    private static readonly Color32 Clear = new(0, 0, 0, 0);

    [MenuItem("Clawbada/VFX/Bind Bleed Marker (placeholder)")]
    public static void Bind()
    {
        Directory.CreateDirectory(Dir);
        if (Redraw)
        {
            WriteSheet(PoolPath, PoolW, PoolH, DrawPool);
            WriteSheet(DripPath, DripW, DripH, DrawDrip);
            AssetDatabase.Refresh();
        }
        Slice(PoolPath, PoolW, PoolH, "Pool", new Vector2(0.5f, 0.5f));
        Slice(DripPath, DripW, DripH, "Drip", new Vector2(0.5f, 0f));

        var prefab = BuildPrefab(LoadSprites(PoolPath), LoadSprites(DripPath));
        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[BleedMarkerPlaceholder] missing {LibraryPath}");
        var visuals = new List<BattleVfxLibrary.StatusVfx>(lib.statusVisuals ?? new BattleVfxLibrary.StatusVfx[0]);
        visuals.RemoveAll(v => v != null && string.Equals(v.status, "bleed", System.StringComparison.OrdinalIgnoreCase));
        visuals.Add(new BattleVfxLibrary.StatusVfx { status = "bleed", loop = prefab, yOffset = 0f });
        lib.statusVisuals = visuals.ToArray();
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();

        string msg = $"[BleedMarkerPlaceholder] OK — Pool {PoolW}x{PoolH} + Drip {DripW}x{DripH}, {Frames} frames @ {Fps} fps loop → statusVisuals[\"bleed\"]";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    // ─── Drawing ───

    private delegate void Draw(Color32[] px, int w, int h, int frame);

    private static void WriteSheet(string path, int w, int h, Draw draw)
    {
        var tex = new Texture2D(w * Frames, h, TextureFormat.RGBA32, false);
        var all = Enumerable.Repeat(Clear, w * Frames * h).ToArray();
        for (int f = 0; f < Frames; f++)
        {
            var px = Enumerable.Repeat(Clear, w * h).ToArray();
            draw(px, w, h, f);
            Outline(px, w, h);
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                    all[y * w * Frames + f * w + x] = px[y * w + x];
        }
        tex.SetPixels32(all);
        tex.Apply();
        File.WriteAllBytes(path, tex.EncodeToPNG());
        Object.DestroyImmediate(tex);
    }

    /// <summary>A flat blood pool that swells and settles (radius breathes by a pixel or two).</summary>
    private static void DrawPool(Color32[] px, int w, int h, int f)
    {
        float[] grow = { 0f, 0.6f, 1.2f, 1.6f, 1.2f, 0.6f };
        float rx = 17f + grow[f] * 2f, ry = 6f + grow[f] * 0.6f;
        float cx = (w - 1) / 2f, cy = (h - 1) / 2f;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                float dx = (x - cx) / rx, dy = (y - cy) / ry;
                float d = dx * dx + dy * dy;
                if (d > 1f) continue;
                // Lit from the top-left: shadow along the lower rim, a glint up top.
                px[y * w + x] = d > 0.7f && dy < 0f ? Lo : Mid;
                if (d < 0.18f && dx < -0.1f && dy > 0.15f) px[y * w + x] = Hi;
            }
        // Dimple where the drop lands (frame 4 of the drip).
        if (f == 4 || f == 5) { Set(px, w, h, (int)cx + 8, (int)cy + 1, Hi); Set(px, w, h, (int)cx + 7, (int)cy + 1, Hi); }
    }

    /// <summary>A drop forms on the body, stretches, falls, and splashes into the pool.</summary>
    private static void DrawDrip(Color32[] px, int w, int h, int f)
    {
        int cx = w / 2;
        switch (f)
        {
            case 0: Blob(px, w, h, cx, h - 8, 2, 2); break;              // bead forming
            case 1: Blob(px, w, h, cx, h - 9, 2, 3); break;              // growing
            case 2: Blob(px, w, h, cx, h - 11, 3, 4); Stem(px, w, h, cx, h - 8, 3); break; // stretching
            case 3: Blob(px, w, h, cx, h - 22, 2, 3); break;             // falling
            case 4: Blob(px, w, h, cx, 6, 2, 2); break;                  // about to land
            case 5:                                                       // splash
                Set(px, w, h, cx - 3, 3, Mid); Set(px, w, h, cx + 3, 3, Mid);
                Set(px, w, h, cx - 2, 5, Hi); Set(px, w, h, cx + 2, 5, Hi);
                break;
        }
    }

    private static void Blob(Color32[] px, int w, int h, int cx, int cy, int rx, int ry)
    {
        for (int y = cy - ry; y <= cy + ry; y++)
            for (int x = cx - rx; x <= cx + rx; x++)
            {
                float dx = (x - cx) / (rx + 0.5f), dy = (y - cy) / (ry + 0.5f);
                if (dx * dx + dy * dy > 1f) continue;
                Set(px, w, h, x, y, x < cx && y > cy ? Hi : (y < cy - ry / 2 ? Lo : Mid));
            }
        // A teardrop point on top.
        Set(px, w, h, cx, cy + ry + 1, Mid);
    }

    private static void Stem(Color32[] px, int w, int h, int cx, int fromY, int len)
    {
        for (int y = fromY; y < fromY + len; y++) Set(px, w, h, cx, y, Mid);
    }

    private static void Set(Color32[] px, int w, int h, int x, int y, Color32 c)
    {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        px[y * w + x] = c;
    }

    /// <summary>One-pixel universal outline around every painted pixel.</summary>
    private static void Outline(Color32[] px, int w, int h)
    {
        var src = (Color32[])px.Clone();
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                if (src[y * w + x].a != 0) continue;
                bool edge = false;
                for (int oy = -1; oy <= 1 && !edge; oy++)
                    for (int ox = -1; ox <= 1 && !edge; ox++)
                    {
                        if (ox != 0 && oy != 0) continue;
                        int nx = x + ox, ny = y + oy;
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h && src[ny * w + nx].a != 0 && !Same(src[ny * w + nx], Line)) edge = true;
                    }
                if (edge) px[y * w + x] = Line;
            }
    }

    private static bool Same(Color32 a, Color32 b) => a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a;

    // ─── Import + prefab ───

    private static void Slice(string path, int fw, int fh, string prefix, Vector2 pivot)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null) throw new System.Exception($"[BleedMarkerPlaceholder] missing texture importer: {path}");
        importer.textureType = TextureImporterType.Sprite;
        importer.spriteImportMode = SpriteImportMode.Multiple;
        importer.spritePixelsPerUnit = Ppu;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
        importer.alphaIsTransparency = true;

        var factory = new SpriteDataProviderFactories();
        factory.Init();
        var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
        provider.InitSpriteEditorDataProvider();
        var rects = new List<SpriteRect>();
        for (int i = 0; i < Frames; i++)
            rects.Add(new SpriteRect
            {
                name = $"FX_Bleed_{prefix}_{i:00}",
                spriteID = GUID.Generate(),
                rect = new Rect(i * fw, 0, fw, fh),
                alignment = SpriteAlignment.Custom,
                pivot = pivot,
            });
        provider.SetSpriteRects(rects.ToArray());
        provider.Apply();
        importer.SaveAndReimport();
    }

    private static Sprite[] LoadSprites(string path)
    {
        var sprites = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != Frames) throw new System.Exception($"[BleedMarkerPlaceholder] {path}: expected {Frames} sprites, found {sprites.Length}");
        return sprites;
    }

    private static GameObject BuildPrefab(Sprite[] pool, Sprite[] drip)
    {
        var clip = new AnimationClip { frameRate = Fps };
        Curve(clip, "Pool", pool);
        Curve(clip, "Drip", drip);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = true;
        settings.stopTime = Frames / Fps;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        AssetDatabase.DeleteAsset(ClipPath);
        AssetDatabase.CreateAsset(clip, ClipPath);
        AssetDatabase.DeleteAsset(ControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(ControllerPath, clip);

        var root = new GameObject("FX_Bleed_Loop");
        try
        {
            // Pool under the body: Default layer below the rig's parts (0…15), like Haunt's sigil (−5).
            Layer(root.transform, "Pool", pool[0], "Default", -5, new Vector3(0f, 0.02f, 0f));
            // Drip over the body: Foreground outranks the parts' Default layer inside the victim's group.
            Layer(root.transform, "Drip", drip[0], "Foreground", 0, new Vector3(0.12f, 0.02f, 0f));
            var animator = root.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            // Loops live until the status ends: no OneShotVfx.
            return PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
    }

    private static void Layer(Transform parent, string name, Sprite sprite, string layer, int order, Vector3 at)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        go.transform.localPosition = at;
        var sr = go.AddComponent<SpriteRenderer>();
        sr.sprite = sprite;
        sr.sortingLayerName = layer;
        sr.sortingOrder = order;
    }

    private static void Curve(AnimationClip clip, string path, Sprite[] sprites)
    {
        var binding = EditorCurveBinding.PPtrCurve(path, typeof(SpriteRenderer), "m_Sprite");
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
    }
}
