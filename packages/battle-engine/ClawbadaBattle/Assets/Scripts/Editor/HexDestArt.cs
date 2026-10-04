using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// The move-target hex overlay (user 2026-10-04): the hex a lobster is about to move to gets a WHITE outline
/// and a LIGHT-GREEN glow, so it never reads as just another reachable cell. Built from the designer's own
/// `hex_move_select` frame (frame 1 of hex_move.png: the move hex with a 1 px pure-white outline): the outline
/// is copied pixel for pixel, the inside becomes a translucent light-green fill, and a halo of three stepped
/// bands (70 / 42 / 18 %, the action-button glow convention) is laid outside the hex on a 3 px margin.
/// Output: Art/HexTiles/Sprites/hex_dest.png (54×39, PPU 64, Point) + the `HudSkin.hexDest` slot (seeded only
/// when empty, like every other skin slot). HexGrid paints it on its own overlay Tilemap.
/// Menu: Clawbada ▸ Arena ▸ Generate Move-Target Hex. Headless: -executeMethod HexDestArt.Generate
/// (also run by HudArtGenerator.Generate).
/// </summary>
public static class HexDestArt
{
    public const string SourceSheet = "Assets/Art/HexTiles/Sprites/hex_move.png";
    public const string OutputPath = "Assets/Art/HexTiles/Sprites/hex_dest.png";
    public const string SkinPath = "Assets/Resources/UI/HudSkin.asset";
    public const int FrameW = 48, FrameH = 33, Pad = 3;
    public const int OutW = FrameW + Pad * 2, OutH = FrameH + Pad * 2;
    private const int FrameIndex = 1; // hex_move_select
    /// <summary>Lighter and yellower than the ally tint (#8CF28C), so a move target never reads as an ally target.</summary>
    private static readonly Color Green = new Color(0xA8 / 255f, 0xFF / 255f, 0x9E / 255f, 1f);
    private const float FillAlpha = 0.35f;
    private static readonly float[] Bands = { 0f, 0.70f, 0.42f, 0.18f };

    [MenuItem("Clawbada/Arena/Generate Move-Target Hex")]
    public static void Generate()
    {
        var src = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        if (!src.LoadImage(File.ReadAllBytes(SourceSheet))) throw new System.Exception("[HexDestArt] cannot read " + SourceSheet);
        try
        {
            if (src.width < (FrameIndex + 1) * FrameW || src.height != FrameH)
                throw new System.Exception($"[HexDestArt] {SourceSheet} is {src.width}x{src.height}, expected at least {(FrameIndex + 1) * FrameW}x{FrameH} (two 48x33 frames)");
            var frame = new Color[FrameW, FrameH];
            for (int x = 0; x < FrameW; x++)
                for (int y = 0; y < FrameH; y++)
                    frame[x, y] = src.GetPixel(FrameIndex * FrameW + x, y);

            bool Opaque(int x, int y)
            {
                int sx = x - Pad, sy = y - Pad;
                return sx >= 0 && sy >= 0 && sx < FrameW && sy < FrameH && frame[sx, sy].a > 0.1f;
            }
            // Outside = reachable from the border without crossing the hex; everything else is the hex.
            var outside = new bool[OutW, OutH];
            var stack = new System.Collections.Generic.Stack<Vector2Int>();
            stack.Push(new Vector2Int(0, 0));
            while (stack.Count > 0)
            {
                var p = stack.Pop();
                if (p.x < 0 || p.y < 0 || p.x >= OutW || p.y >= OutH || outside[p.x, p.y] || Opaque(p.x, p.y)) continue;
                outside[p.x, p.y] = true;
                stack.Push(new Vector2Int(p.x + 1, p.y)); stack.Push(new Vector2Int(p.x - 1, p.y));
                stack.Push(new Vector2Int(p.x, p.y + 1)); stack.Push(new Vector2Int(p.x, p.y - 1));
            }
            // 8-neighbour distance from the hex, out to 3 (the glow bands).
            var dist = new int[OutW, OutH];
            for (int x = 0; x < OutW; x++) for (int y = 0; y < OutH; y++) dist[x, y] = outside[x, y] ? 99 : 0;
            for (int step = 1; step <= 3; step++)
                for (int x = 0; x < OutW; x++)
                    for (int y = 0; y < OutH; y++)
                    {
                        if (dist[x, y] != 99) continue;
                        for (int dx = -1; dx <= 1 && dist[x, y] == 99; dx++)
                            for (int dy = -1; dy <= 1; dy++)
                            {
                                int nx = x + dx, ny = y + dy;
                                if (nx >= 0 && ny >= 0 && nx < OutW && ny < OutH && dist[nx, ny] == step - 1) { dist[x, y] = step; break; }
                            }
                    }

            var tex = new Texture2D(OutW, OutH, TextureFormat.RGBA32, false);
            int outlinePx = 0, glowPx = 0, fillPx = 0;
            for (int x = 0; x < OutW; x++)
                for (int y = 0; y < OutH; y++)
                {
                    Color c = Color.clear;
                    if (!outside[x, y])
                    {
                        bool onHex = Opaque(x, y);
                        bool isOutline = onHex && frame[x - Pad, y - Pad].r > 0.95f && frame[x - Pad, y - Pad].g > 0.95f
                                         && frame[x - Pad, y - Pad].b > 0.95f && frame[x - Pad, y - Pad].a > 0.95f;
                        if (isOutline) { c = Color.white; outlinePx++; }
                        else { c = new Color(Green.r, Green.g, Green.b, FillAlpha); fillPx++; }
                    }
                    else if (dist[x, y] >= 1 && dist[x, y] <= 3) { c = new Color(Green.r, Green.g, Green.b, Bands[dist[x, y]]); glowPx++; }
                    tex.SetPixel(x, y, c);
                }
            tex.Apply();
            if (outlinePx < 60) throw new System.Exception($"[HexDestArt] only {outlinePx} white outline pixels in frame {FrameIndex} of {SourceSheet} — is it still hex_move_select?");

            string absolute = Path.Combine(Application.dataPath, "..", OutputPath);
            File.WriteAllBytes(absolute, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(OutputPath, ImportAssetOptions.ForceUpdate);
            if (AssetImporter.GetAtPath(OutputPath) is TextureImporter imp &&
                (imp.textureType != TextureImporterType.Sprite || imp.spriteImportMode != SpriteImportMode.Single || imp.filterMode != FilterMode.Point))
            {
                imp.textureType = TextureImporterType.Sprite;
                imp.spriteImportMode = SpriteImportMode.Single;
                imp.spritePixelsPerUnit = 64f;
                imp.filterMode = FilterMode.Point;
                imp.mipmapEnabled = false;
                imp.textureCompression = TextureImporterCompression.Uncompressed;
                imp.wrapMode = TextureWrapMode.Clamp;
                imp.SaveAndReimport();
            }

            var skin = AssetDatabase.LoadAssetAtPath<HudSkin>(SkinPath);
            var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(OutputPath);
            if (sprite == null) throw new System.Exception("[HexDestArt] " + OutputPath + " imported without a Sprite");
            if (skin != null && skin.hexDest == null)
            {
                skin.hexDest = sprite;
                EditorUtility.SetDirty(skin);
                AssetDatabase.SaveAssets();
            }
            string msg = $"[HexDestArt] OK — {OutW}x{OutH}, {outlinePx} outline px, {fillPx} fill px, {glowPx} glow px; HudSkin.hexDest {(skin != null && skin.hexDest == sprite ? "set" : skin == null ? "no skin" : "kept (designer swap)")}";
            Debug.Log(msg);
            if (Application.isBatchMode) System.Console.WriteLine(msg);
        }
        finally
        {
            Object.DestroyImmediate(src);
        }
    }
}
