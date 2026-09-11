using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Measures the opaque content of every arena layer sprite and writes
/// Resources/ArenaDecorAnchors.asset, which BattleManager uses to shrink decor about the frame
/// edge it touches rather than about the camera centre.
///
/// Textures are made readable for the measurement and put back exactly as they were, so the
/// designer's import settings are untouched.
/// Menu: Clawbada ▸ Arena ▸ Bake Decor Anchors. Headless: -executeMethod ArenaDecorBaker.Bake
/// </summary>
public static class ArenaDecorBaker
{
    private const string ArenaFolder = "Assets/Art/Arenas";
    private const string AssetPath = "Assets/Resources/" + ArenaDecorAnchors.ResourcePath + ".asset";

    [MenuItem("Clawbada/Arena/Bake Decor Anchors")]
    public static void Bake()
    {
        var entries = new List<ArenaDecorAnchors.Entry>();
        foreach (var guid in AssetDatabase.FindAssets("t:Texture2D", new[] { ArenaFolder }))
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            var box = MeasureContent(path, out int w, out int h);
            if (box == null) continue;
            // Tier-scoped: layer names repeat across arenas ("BG - 2" is both Elite and Apex).
            string tier = Path.GetFileName(Path.GetDirectoryName(path));
            string name = $"{tier}/{Path.GetFileNameWithoutExtension(path)}";
            entries.Add(new ArenaDecorAnchors.Entry { sprite = name, content = box.Value });
            Debug.Log($"[ArenaDecorBaker] {name} ({w}x{h}) content=({box.Value.x:F2},{box.Value.y:F2})-({box.Value.z:F2},{box.Value.w:F2})");
        }
        entries.Sort((a, b) => string.CompareOrdinal(a.sprite, b.sprite));

        var asset = AssetDatabase.LoadAssetAtPath<ArenaDecorAnchors>(AssetPath);
        if (asset == null)
        {
            asset = ScriptableObject.CreateInstance<ArenaDecorAnchors>();
            if (!AssetDatabase.IsValidFolder("Assets/Resources")) AssetDatabase.CreateFolder("Assets", "Resources");
            AssetDatabase.CreateAsset(asset, AssetPath);
        }
        asset.entries = entries.ToArray();
        EditorUtility.SetDirty(asset);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        string msg = $"[ArenaDecorBaker] OK — {entries.Count} arena layers measured into {AssetPath}";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    /// <summary>Opaque bounds as canvas fractions (x/y = left/bottom, z/w = right/top), or null
    /// for a fully transparent texture.</summary>
    private static Vector4? MeasureContent(string path, out int width, out int height)
    {
        width = height = 0;
        if (AssetImporter.GetAtPath(path) is not TextureImporter imp) return null;
        bool wasReadable = imp.isReadable;
        if (!wasReadable) { imp.isReadable = true; imp.SaveAndReimport(); }
        try
        {
            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (tex == null) return null;
            width = tex.width; height = tex.height;
            var px = tex.GetPixels32();
            int minX = tex.width, minY = tex.height, maxX = -1, maxY = -1;
            for (int y = 0; y < tex.height; y++)
            for (int x = 0; x < tex.width; x++)
            {
                if (px[y * tex.width + x].a < 8) continue;   // GetPixels32 is bottom-up, like world space
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            if (maxX < 0) return null;
            return new Vector4(minX / (float)tex.width, minY / (float)tex.height,
                               (maxX + 1) / (float)tex.width, (maxY + 1) / (float)tex.height);
        }
        finally
        {
            if (!wasReadable) { imp.isReadable = false; imp.SaveAndReimport(); }
        }
    }
}
