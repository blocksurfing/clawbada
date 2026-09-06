using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Generates placeholder HUD art (hex frames, bars, pixel icons, badges) into
/// Assets/Art/UI and seeds Assets/Resources/UI/HudSkin.asset. Only null skin slots are
/// (re)assigned, so a designer's sprite swaps survive re-runs.
/// Menu: Clawbada ▸ Generate HUD Placeholder Art. Headless:
///   Unity -batchmode -quit -executeMethod HudArtGenerator.Generate
/// </summary>
public static class HudArtGenerator
{
    private const string ArtFolder = "Assets/Art/UI";
    private const string SkinFolder = "Assets/Resources/UI";
    private const string SkinPath = SkinFolder + "/HudSkin.asset";

    private static readonly Color Ink = new Color(0.98f, 0.98f, 0.98f, 1f);
    private static readonly Color Dark = new Color(0.08f, 0.14f, 0.22f, 1f);
    private static readonly Color Panel = new Color(0.05f, 0.09f, 0.16f, 0.88f);
    private static readonly Color Border = new Color(0.35f, 0.65f, 1f, 1f);
    private static readonly Color Clear = new Color(0f, 0f, 0f, 0f);

    [MenuItem("Clawbada/Generate HUD Placeholder Art")]
    public static void Generate()
    {
        EnsureFolder(ArtFolder);
        EnsureFolder(SkinFolder);

        var made = new Dictionary<string, string>(); // logical name → asset path
        made["hex_frame_56"] = WritePng("hex_frame_56", Hex(56, 64, Clear, Ink, 3));
        made["hex_mask_56"] = WritePng("hex_mask_56", Hex(56, 64, Ink, Ink, 0));
        made["hex_frame_96"] = WritePng("hex_frame_96", Hex(96, 110, Clear, Ink, 4));
        made["hex_mask_96"] = WritePng("hex_mask_96", Hex(96, 110, Ink, Ink, 0));
        made["hex_button_64"] = WritePng("hex_button_64", Hex(64, 74, Dark, Border, 3));
        made["bar_bg"] = WritePng("bar_bg", Box(8, 8, new Color(0.04f, 0.09f, 0.13f, 1f), new Color(0.16f, 0.23f, 0.29f, 1f), 2));
        made["bar_fill"] = WritePng("bar_fill", Box(4, 4, Ink, Ink, 0));
        made["panel_bg"] = WritePng("panel_bg", Box(16, 16, Panel, new Color(0.2f, 0.3f, 0.42f, 1f), 3));
        made["pip"] = WritePng("pip", Disc(8, Ink));
        made["ring"] = WritePng("ring", Ring(44, 3, Ink));

        made["icon_attack"] = WritePng("icon_attack", Glyph(Glyphs.Attack, Ink));
        made["icon_special"] = WritePng("icon_special", Glyph(Glyphs.Special, Ink));
        made["icon_defend"] = WritePng("icon_defend", Glyph(Glyphs.Defend, Ink));
        made["icon_wait"] = WritePng("icon_wait", Glyph(Glyphs.Wait, Ink));
        made["icon_undo"] = WritePng("icon_undo", Glyph(Glyphs.Undo, Ink));
        made["icon_clock"] = WritePng("icon_clock", Glyph(Glyphs.Clock, Ink));
        made["icon_ko"] = WritePng("icon_ko", Glyph(Glyphs.Skull, Ink));
        made["icon_shield"] = WritePng("icon_shield", Glyph(Glyphs.ShieldSmall, new Color(0.6f, 0.8f, 1f, 1f)));

        var statusColors = new Dictionary<string, Color>
        {
            ["bleed"] = new Color(0.95f, 0.3f, 0.3f), ["stun"] = new Color(1f, 0.85f, 0.3f),
            ["haunt"] = new Color(0.75f, 0.6f, 1f), ["fortify"] = new Color(0.6f, 0.85f, 1f),
            ["reflect"] = new Color(0.5f, 1f, 0.9f), ["shield"] = new Color(0.6f, 0.8f, 1f),
            ["slow"] = new Color(0.6f, 0.7f, 0.8f), ["taunt"] = new Color(1f, 0.55f, 0.3f),
        };
        foreach (var kv in Glyphs.Statuses)
        {
            made["status_" + kv.Key] = WritePng("status_" + kv.Key, Glyph(kv.Value, statusColors[kv.Key]));
        }
        made["badge_human"] = WritePng("badge_human", Badge(Glyphs.LetterH, new Color(0.98f, 0.44f, 0.4f)));
        made["badge_agent"] = WritePng("badge_agent", Badge(Glyphs.LetterA, new Color(0.35f, 0.65f, 1f)));
        made["badge_bot"] = WritePng("badge_bot", Badge(Glyphs.LetterB, new Color(0.55f, 0.6f, 0.68f)));

        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        SetBorder(made["bar_bg"], new Vector4(3, 3, 3, 3));
        SetBorder(made["panel_bg"], new Vector4(5, 5, 5, 5));
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

        SeedSkin(made);
        string msg = $"[HudArtGenerator] OK — {made.Count} textures in {ArtFolder}, skin at {SkinPath}";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    // ─── Skin ───

    private static void SeedSkin(Dictionary<string, string> made)
    {
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>(SkinPath);
        if (skin == null)
        {
            skin = ScriptableObject.CreateInstance<HudSkin>();
            AssetDatabase.CreateAsset(skin, SkinPath);
        }
        Sprite S(string key) => LoadSprite(made[key]);

        if (skin.hexFrame56 == null) skin.hexFrame56 = S("hex_frame_56");
        if (skin.hexMask56 == null) skin.hexMask56 = S("hex_mask_56");
        if (skin.hexFrame96 == null) skin.hexFrame96 = S("hex_frame_96");
        if (skin.hexMask96 == null) skin.hexMask96 = S("hex_mask_96");
        if (skin.hexButton64 == null) skin.hexButton64 = S("hex_button_64");
        if (skin.barBg == null) skin.barBg = S("bar_bg");
        if (skin.barFill == null) skin.barFill = S("bar_fill");
        if (skin.panelBg == null) skin.panelBg = S("panel_bg");
        if (skin.pip == null) skin.pip = S("pip");
        if (skin.ring == null) skin.ring = S("ring");
        if (skin.iconAttack == null) skin.iconAttack = S("icon_attack");
        if (skin.iconSpecial == null) skin.iconSpecial = S("icon_special");
        if (skin.iconDefend == null) skin.iconDefend = S("icon_defend");
        if (skin.iconWait == null) skin.iconWait = S("icon_wait");
        if (skin.iconUndo == null) skin.iconUndo = S("icon_undo");
        if (skin.iconClock == null) skin.iconClock = S("icon_clock");
        if (skin.iconKo == null) skin.iconKo = S("icon_ko");
        if (skin.iconShield == null) skin.iconShield = S("icon_shield");
        if (skin.badgeHuman == null) skin.badgeHuman = S("badge_human");
        if (skin.badgeAgent == null) skin.badgeAgent = S("badge_agent");
        if (skin.badgeBot == null) skin.badgeBot = S("badge_bot");

        var icons = new List<HudSkin.StatusIcon>(skin.statusIcons ?? new HudSkin.StatusIcon[0]);
        foreach (var key in Glyphs.Statuses.Keys)
        {
            var existing = icons.Find(i => i != null && i.status == key);
            if (existing == null) icons.Add(new HudSkin.StatusIcon { status = key, sprite = S("status_" + key) });
            else if (existing.sprite == null) existing.sprite = S("status_" + key);
        }
        skin.statusIcons = icons.ToArray();

        if (skin.selectorController == null)
            skin.selectorController = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>("Assets/Art/HexTiles/Sprites/hex_selector.controller");
        if (skin.selectorSprite == null)
        {
            foreach (var o in AssetDatabase.LoadAllAssetRepresentationsAtPath("Assets/Art/HexTiles/Sprites/hex_selector.png"))
            {
                if (o is Sprite sp) { skin.selectorSprite = sp; break; }
            }
            if (skin.selectorSprite == null)
                skin.selectorSprite = AssetDatabase.LoadAssetAtPath<Sprite>("Assets/Art/HexTiles/Sprites/hex_selector.png");
        }

        EditorUtility.SetDirty(skin);
        AssetDatabase.SaveAssets();
    }

    /// <summary>Sprite sub-asset of a freshly imported texture. LoadAssetAtPath&lt;Sprite&gt;
    /// can miss sub-assets imported earlier in the same batch session; scan all assets at
    /// the path and log what is there when nothing matches.</summary>
    private static Sprite LoadSprite(string path)
    {
        var direct = AssetDatabase.LoadAssetAtPath<Sprite>(path);
        if (direct != null) return direct;
        var all = AssetDatabase.LoadAllAssetsAtPath(path);
        foreach (var o in all) if (o is Sprite sp) return sp;
        var reps = AssetDatabase.LoadAllAssetRepresentationsAtPath(path);
        foreach (var o in reps) if (o is Sprite sp) return sp;
        var types = new List<string>();
        foreach (var o in all) types.Add(o == null ? "null" : o.GetType().Name);
        var imp = AssetImporter.GetAtPath(path) as TextureImporter;
        Debug.LogWarning($"[HudArtGenerator] no Sprite at {path}: assets=[{string.Join(",", types)}] reps={reps.Length} " +
                         $"importer={(imp == null ? "none" : imp.textureType + "/" + imp.spriteImportMode)}");
        return null;
    }

    // ─── Texture builders ───

    private static string WritePng(string name, Texture2D tex)
    {
        string assetPath = $"{ArtFolder}/{name}.png";
        string absolute = Path.Combine(Application.dataPath, "Art/UI", name + ".png");
        File.WriteAllBytes(absolute, tex.EncodeToPNG());
        Object.DestroyImmediate(tex);
        AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate);
        // The project's texture defaults import new PNGs as Sprite/Multiple with no sheet,
        // which yields no Sprite sub-asset at all. Pin the mode so LoadAssetAtPath<Sprite> works.
        if (AssetImporter.GetAtPath(assetPath) is TextureImporter imp &&
            (imp.textureType != TextureImporterType.Sprite || imp.spriteImportMode != SpriteImportMode.Single))
        {
            imp.textureType = TextureImporterType.Sprite;
            imp.spriteImportMode = SpriteImportMode.Single;
            imp.spritePixelsPerUnit = 64f;
            imp.filterMode = FilterMode.Point;
            imp.mipmapEnabled = false;
            imp.textureCompression = TextureImporterCompression.Uncompressed;
            imp.SaveAndReimport();
        }
        return assetPath;
    }

    private static void SetBorder(string path, Vector4 border)
    {
        var imp = AssetImporter.GetAtPath(path) as TextureImporter;
        if (imp == null) return;
        imp.spriteBorder = border;
        imp.SaveAndReimport();
    }

    private static Texture2D NewTex(int w, int h)
    {
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        var px = new Color[w * h];
        for (int i = 0; i < px.Length; i++) px[i] = Clear;
        tex.SetPixels(px);
        return tex;
    }

    /// <summary>Pointy-top hexagon. Inside test: |dx| ≤ W/2 and |dy| ≤ H/2 − (|dx| / (W/2)) · H/4.</summary>
    private static bool InHex(float x, float y, float w, float h, float shrink)
    {
        float cx = w * 0.5f, cy = h * 0.5f;
        float hw = w * 0.5f - shrink, hh = h * 0.5f - shrink;
        float dx = Mathf.Abs(x - cx), dy = Mathf.Abs(y - cy);
        if (dx > hw) return false;
        return dy <= hh - (dx / hw) * (hh * 0.5f);
    }

    private static Texture2D Hex(int w, int h, Color fill, Color border, int borderPx)
    {
        var tex = NewTex(w, h);
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
        {
            float px = x + 0.5f, py = y + 0.5f;
            if (!InHex(px, py, w, h, 0.5f)) continue;
            bool edge = borderPx > 0 && !InHex(px, py, w, h, borderPx + 0.5f);
            tex.SetPixel(x, y, edge ? border : fill);
        }
        tex.Apply();
        return tex;
    }

    private static Texture2D Box(int w, int h, Color fill, Color border, int borderPx)
    {
        var tex = NewTex(w, h);
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
        {
            bool edge = x < borderPx || y < borderPx || x >= w - borderPx || y >= h - borderPx;
            tex.SetPixel(x, y, edge ? border : fill);
        }
        tex.Apply();
        return tex;
    }

    private static Texture2D Disc(int d, Color c)
    {
        var tex = NewTex(d, d);
        float r = d * 0.5f;
        for (int y = 0; y < d; y++)
        for (int x = 0; x < d; x++)
        {
            float dx = x + 0.5f - r, dy = y + 0.5f - r;
            if (dx * dx + dy * dy <= (r - 0.5f) * (r - 0.5f)) tex.SetPixel(x, y, c);
        }
        tex.Apply();
        return tex;
    }

    private static Texture2D Ring(int d, int thickness, Color c)
    {
        var tex = NewTex(d, d);
        float r = d * 0.5f;
        for (int y = 0; y < d; y++)
        for (int x = 0; x < d; x++)
        {
            float dx = x + 0.5f - r, dy = y + 0.5f - r;
            float dist = Mathf.Sqrt(dx * dx + dy * dy);
            if (dist <= r - 0.5f && dist >= r - 0.5f - thickness) tex.SetPixel(x, y, c);
        }
        tex.Apply();
        return tex;
    }

    /// <summary>Row-stamped bitmap: '#' = colour, 'o' = colour at 55 %, '.' = transparent. Row 0 is the top.</summary>
    private static Texture2D Glyph(string[] rows, Color c)
    {
        int h = rows.Length, w = rows[0].Length;
        var tex = NewTex(w, h);
        var dim = new Color(c.r, c.g, c.b, c.a * 0.55f);
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
        {
            char ch = rows[y][x];
            if (ch == '#') tex.SetPixel(x, h - 1 - y, c);
            else if (ch == 'o') tex.SetPixel(x, h - 1 - y, dim);
        }
        tex.Apply();
        return tex;
    }

    private static Texture2D Badge(string[] letter, Color bg)
    {
        int w = 24, h = 12;
        var tex = NewTex(w, h);
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
        {
            bool corner = (x == 0 || x == w - 1) && (y == 0 || y == h - 1);
            if (!corner) tex.SetPixel(x, y, bg);
        }
        int lw = letter[0].Length, lh = letter.Length;
        int ox = (w - lw) / 2, oy = (h - lh) / 2;
        for (int y = 0; y < lh; y++)
        for (int x = 0; x < lw; x++)
        {
            if (letter[y][x] == '#') tex.SetPixel(ox + x, h - 1 - (oy + y), Color.white);
        }
        tex.Apply();
        return tex;
    }

    private static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path)) return;
        string parent = Path.GetDirectoryName(path).Replace('\\', '/');
        string leaf = Path.GetFileName(path);
        EnsureFolder(parent);
        AssetDatabase.CreateFolder(parent, leaf);
    }

    // ─── Pixel glyphs (16x16 actions, 12x12 statuses, 5x7 letters) ───

    private static class Glyphs
    {
        public static readonly string[] Attack =
        {
            "...............#", "..............##", ".............##.", "............##..", "#..........##...",
            "##........##....", ".##......##.....", "..##....##......", "...##..##.......", "....####........",
            ".....##.........", "....####........", "...##..##.......", "..##....##......", ".##......##.....",
            "##........##....",
        };
        public static readonly string[] Special =
        {
            ".......#........", ".......#........", "......###.......", "......###.......", ".....#####......",
            "#...#######...#.", "###############.", ".#############..", "..###########...", "...#########....",
            "....#######.....", "...##..#..##....", "..##...#...##...", ".##....#....##..", "#......#......#.",
            "................",
        };
        public static readonly string[] Defend =
        {
            "..############..", ".#............#.", "#..............#", "#..............#", "#......##......#",
            "#.....####.....#", "#......##......#", "#..............#", ".#............#.", ".#............#.",
            "..#..........#..", "...#........#...", "....#......#....", ".....#....#.....", "......####......",
            "................",
        };
        public static readonly string[] Wait =
        {
            "###############.", "#.............#.", ".#...........#..", ".#...........#..", "..#.........#...",
            "...#.......#....", "....#..o..#.....", ".....#.o.#......", ".....#.o.#......", "....#..o..#.....",
            "...#...o...#....", "..#....o....#...", ".#....ooo....#..", ".#...ooooo...#..", "#.............#.",
            "###############.",
        };
        public static readonly string[] Undo =
        {
            "................", ".....#####......", "...##.....##....", "..#.........#...", ".#...........#..",
            ".#...........#..", "#.............#.", "#.............#.", "#.......#.....#.", "#......##.....#.",
            ".#....###....#..", ".#...#####...#..", "..#....##...#...", "...##..##.##....", ".....#####......",
            "................",
        };
        public static readonly string[] Clock =
        {
            ".....######.....", "...##......##...", "..#..........#..", ".#............#.", ".#.....#......#.",
            "#......#.......#", "#......#.......#", "#......#.......#", "#......####....#", "#..............#",
            ".#............#.", ".#............#.", "..#..........#..", "...##......##...", ".....######.....",
            "................",
        };
        public static readonly string[] Skull =
        {
            "....########....", "..##........##..", ".#............#.", "#..............#", "#..###....###..#",
            "#..###....###..#", "#..............#", "#......##......#", ".#....#..#....#.", "..#..........#..",
            "...#.#.##.#.#...", "...#.#.##.#.#...", "...##########...", "................", "................",
            "................",
        };
        public static readonly string[] ShieldSmall =
        {
            ".##########.", "#..........#", "#..........#", "#....##....#", "#....##....#", "#..........#",
            ".#........#.", ".#........#.", "..#......#..", "...#....#...", "....#..#....", ".....##.....",
        };
        public static readonly Dictionary<string, string[]> Statuses = new()
        {
            ["bleed"] = new[] { ".....#......", ".....#......", "....###.....", "....###.....", "...#####....", "...#####....", "..#######...", "..#######...", "..#######...", "...#####....", "....###.....", "............" },
            ["stun"] = new[] { "..#...#.....", "...#.#......", "#...#...#...", ".#..#..#....", "..#####.....", "###.#.###...", "..#####.....", ".#..#..#....", "#...#...#...", "...#.#......", "..#...#.....", "............" },
            ["haunt"] = new[] { "....####....", "..##....##..", ".#........#.", ".#..#..#..#.", "#..........#", "#..........#", "#..........#", "#..........#", "#..#..#..#.#", "#.#.##.##.##", ".#........#.", "............" },
            ["fortify"] = new[] { "############", "#..........#", "#....##....#", "#...####...#", "#..######..#", "#....##....#", "#....##....#", "#....##....#", "#....##....#", "#..........#", "############", "............" },
            ["reflect"] = new[] { "..#.........", ".##.........", "########....", ".##.........", "..#.........", "............", ".........#..", ".........##.", "....########", ".........##.", ".........#..", "............" },
            ["shield"] = ShieldSmall,
            ["slow"] = new[] { "............", "....####....", "...#....#...", "..#..##..#..", "..#.#..#.#..", "..#.#.##.#..", "..#..#...#..", "...#....#...", "....####....", "############", "............", "............" },
            ["taunt"] = new[] { "....####....", "....####....", "....####....", "....####....", "....####....", "....####....", ".....##.....", "............", "....####....", "....####....", "............", "............" },
        };
        public static readonly string[] LetterH = { "#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#" };
        public static readonly string[] LetterA = { ".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#" };
        public static readonly string[] LetterB = { "####.", "#...#", "#...#", "####.", "#...#", "#...#", "####." };
    }
}
