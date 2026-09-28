using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Binds Nzib's HUD sheets (drop 2026-09-27) into Resources/UI/HudSkin.asset:
///   Art/UI/ActionButton.png — ActionButton_Frame / _Attack / _Defend / _Wait and one
///     ActionButton_&lt;Class&gt;_&lt;Special&gt; per class → actionFrame, actionAttack/Defend/Wait, specialButtons[classId];
///   Art/UI/Avatar.png — Avatar_Frame + Avatar_BG_&lt;Class&gt; → avatarFrame, avatarBg[classId].
/// Also generates two helpers from his art, so they line up with it pixel for pixel:
///   action_glow.png — a stepped 3 px halo around the frame's hex (hover + armed glow);
///   avatar_gauge_track.png — the two gauge frames OUTSIDE the ring (his mock, 2026-09-27): a left arc for HP and
///                     a right arc for charge, each a dark outline with a bronze rim and end caps;
///   avatar_popmask.png — opaque everywhere OUTSIDE the portrait disc (a GaugeCell square): the mask for the copy of
///                     the claws and antennae that breaks out over the ring, as in his mock;
///   avatar_arc.png  — the white fill band inside those frames, radially filled and tinted (green HP, blue charge),
///                     shaded so the tint keeps a highlight. Both stand in until his gauge art lands.
/// Slices are found by NAME, so a re-slice or a re-ordered sheet still binds. Re-run after any HUD drop.
/// Menu: Clawbada ▸ HUD ▸ Bind Nzib HUD Art. Headless: -executeMethod NzibHudBinder.Bind
/// </summary>
public static class NzibHudBinder
{
    private const string ButtonSheet = "Assets/Art/UI/ActionButton.png";
    private const string AvatarSheet = "Assets/Art/UI/Avatar.png";
    private const int GlowPad = 4;

    [MenuItem("Clawbada/HUD/Bind Nzib HUD Art")]
    public static void Bind()
    {
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>(HudArtGenerator.SkinPath);
        if (skin == null) throw new System.Exception($"[NzibHudBinder] missing {HudArtGenerator.SkinPath} — run Clawbada/Generate HUD Placeholder Art first");

        var buttons = AssetDatabase.LoadAllAssetsAtPath(ButtonSheet).OfType<Sprite>().ToArray();
        var avatars = AssetDatabase.LoadAllAssetsAtPath(AvatarSheet).OfType<Sprite>().ToArray();
        Sprite Find(Sprite[] all, string name) => all.FirstOrDefault(s => s.name == name);

        skin.actionFrame = Find(buttons, "ActionButton_Frame");
        skin.actionAttack = Find(buttons, "ActionButton_Attack");
        skin.actionDefend = Find(buttons, "ActionButton_Defend");
        skin.actionWait = Find(buttons, "ActionButton_Wait");
        skin.avatarFrame = Find(avatars, "Avatar_Frame");
        skin.specialButtons = new Sprite[LobsterClasses.Names.Length];
        skin.avatarBg = new Sprite[LobsterClasses.Names.Length];
        int specials = 0, bgs = 0;
        for (int c = 0; c < LobsterClasses.Names.Length; c++)
        {
            string cls = LobsterClasses.Names[c];
            skin.specialButtons[c] = buttons.FirstOrDefault(s => s.name.StartsWith($"ActionButton_{cls}_"));
            skin.avatarBg[c] = Find(avatars, $"Avatar_BG_{cls}");
            if (skin.specialButtons[c] != null) specials++;
            if (skin.avatarBg[c] != null) bgs++;
        }
        if (skin.actionFrame == null || skin.actionAttack == null || skin.actionDefend == null || skin.actionWait == null)
            throw new System.Exception($"[NzibHudBinder] {ButtonSheet} is missing a Frame/Attack/Defend/Wait slice");

        skin.actionGlow = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("action_glow", Glow(skin.actionFrame)));
        skin.avatarGaugeTrack = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("avatar_gauge_track", GaugeTrack()));
        skin.avatarArc = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("avatar_arc", GaugeFill()));
        skin.avatarPopMask = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("avatar_popmask", PopMask()));

        EditorUtility.SetDirty(skin);
        AssetDatabase.SaveAssets();
        string msg = $"[NzibHudBinder] OK — buttons 4/4, specials {specials}/10, avatar frame {(skin.avatarFrame != null ? "yes" : "NO")}, class discs {bgs}/10, glow + arc generated";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    /// <summary>Read a slice's pixels straight from the PNG (the sheet is not import-readable).</summary>
    private static Color[,] SlicePixels(Sprite s)
    {
        var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        tex.LoadImage(File.ReadAllBytes(AssetDatabase.GetAssetPath(s)));
        var r = s.rect;
        int w = (int)r.width, h = (int)r.height;
        var px = new Color[w, h];
        for (int x = 0; x < w; x++)
            for (int y = 0; y < h; y++)
                px[x, y] = tex.GetPixel((int)r.x + x, (int)r.y + y);
        Object.DestroyImmediate(tex);
        return px;
    }

    /// <summary>White halo, 3 stepped pixel bands (70 / 42 / 18 %) outside the frame's hex, GlowPad px margin.</summary>
    private static Texture2D Glow(Sprite frame)
    {
        var src = SlicePixels(frame);
        int sw = src.GetLength(0), sh = src.GetLength(1);
        int w = sw + GlowPad * 2, h = sh + GlowPad * 2;

        // Hex = the outline plus everything it encloses: flood the outside from the border, the rest is inside.
        var outside = new bool[w, h];
        bool Opaque(int x, int y)
        {
            int sx = x - GlowPad, sy = y - GlowPad;
            return sx >= 0 && sy >= 0 && sx < sw && sy < sh && src[sx, sy].a > 0.1f;
        }
        var stack = new System.Collections.Generic.Stack<Vector2Int>();
        stack.Push(new Vector2Int(0, 0));
        while (stack.Count > 0)
        {
            var p = stack.Pop();
            if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h || outside[p.x, p.y] || Opaque(p.x, p.y)) continue;
            outside[p.x, p.y] = true;
            stack.Push(new Vector2Int(p.x + 1, p.y)); stack.Push(new Vector2Int(p.x - 1, p.y));
            stack.Push(new Vector2Int(p.x, p.y + 1)); stack.Push(new Vector2Int(p.x, p.y - 1));
        }

        // Distance (8-neighbour steps) from the hex, out to 3.
        var dist = new int[w, h];
        for (int x = 0; x < w; x++) for (int y = 0; y < h; y++) dist[x, y] = outside[x, y] ? 99 : 0;
        for (int step = 1; step <= 3; step++)
            for (int x = 0; x < w; x++)
                for (int y = 0; y < h; y++)
                {
                    if (dist[x, y] != 99) continue;
                    for (int dx = -1; dx <= 1 && dist[x, y] == 99; dx++)
                        for (int dy = -1; dy <= 1; dy++)
                        {
                            int nx = x + dx, ny = y + dy;
                            if (nx >= 0 && ny >= 0 && nx < w && ny < h && dist[nx, ny] == step - 1) { dist[x, y] = step; break; }
                        }
                }

        float[] alpha = { 0f, 0.7f, 0.42f, 0.18f };
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        for (int x = 0; x < w; x++)
            for (int y = 0; y < h; y++)
            {
                int d = dist[x, y];
                tex.SetPixel(x, y, d >= 1 && d <= 3 ? new Color(1f, 1f, 1f, alpha[d]) : Color.clear);
            }
        tex.Apply();
        return tex;
    }

    // Gauge geometry, in px of a GaugeCell cell centred on the 80 px avatar frame (the ring's outer edge is r 36).
    public const int GaugeCell = 96;
    public const float GaugeSpanDeg = 130f;       // each arc, centred on 9 o'clock (HP) and 3 o'clock (charge)
    public const float GaugeCapDeg = 2.2f;        // the end caps' angular width at the fill radius
    private const float OutIn = 37f, FillIn = 38.5f, FillOut = 42.5f, OutOut = 44f, RimOut = 45f;
    private static readonly Color Outline = new Color32(0x0d, 0x12, 0x16, 0xff);
    private static readonly Color Rim = new Color32(0x6b, 0x54, 0x36, 0xff);
    private static readonly Color Empty = new Color32(0x1a, 0x1f, 0x26, 0xff);

    /// <summary>Angular distance (deg) of a pixel from the nearest arc centre (180° or 0°), and its radius.</summary>
    private static void Polar(int x, int y, out float r, out float off)
    {
        float c = GaugeCell / 2f, dx = x + 0.5f - c, dy = y + 0.5f - c;
        r = Mathf.Sqrt(dx * dx + dy * dy);
        float a = Mathf.Atan2(dy, dx) * Mathf.Rad2Deg;       // 0 = right, 180 = left
        off = Mathf.Min(Mathf.Abs(Mathf.DeltaAngle(a, 180f)), Mathf.Abs(Mathf.DeltaAngle(a, 0f)));
    }

    private static Texture2D GaugeTrack()
    {
        var tex = new Texture2D(GaugeCell, GaugeCell, TextureFormat.RGBA32, false);
        float half = GaugeSpanDeg / 2f;
        for (int x = 0; x < GaugeCell; x++)
            for (int y = 0; y < GaugeCell; y++)
            {
                Polar(x, y, out float r, out float off);
                Color c = Color.clear;
                float capDeg = 1.5f / Mathf.Max(r, 1f) * Mathf.Rad2Deg;   // ~1.5 px of arc
                if (off <= half + capDeg && r >= OutIn && r <= RimOut)
                {
                    bool cap = off > half - GaugeCapDeg / 2f;
                    if (r > OutOut) c = Rim;
                    else if (r < FillIn || r > FillOut || cap) c = Outline;
                    else c = Empty;
                }
                tex.SetPixel(x, y, c);
            }
        tex.Apply();
        return tex;
    }

    /// <summary>Alpha 1 outside the portrait disc (r ≥ 30 of the 80 px frame, its silver ring's inner edge), 0 inside.</summary>
    private static Texture2D PopMask()
    {
        var tex = new Texture2D(GaugeCell, GaugeCell, TextureFormat.RGBA32, false);
        for (int x = 0; x < GaugeCell; x++)
            for (int y = 0; y < GaugeCell; y++)
            {
                Polar(x, y, out float r, out _);
                tex.SetPixel(x, y, r >= 30f ? Color.white : Color.clear);
            }
        tex.Apply();
        return tex;
    }

    /// <summary>Full annulus at the fill radii; the inner row darker and the outer-middle row brightest, so a tint keeps depth.</summary>
    private static Texture2D GaugeFill()
    {
        var tex = new Texture2D(GaugeCell, GaugeCell, TextureFormat.RGBA32, false);
        for (int x = 0; x < GaugeCell; x++)
            for (int y = 0; y < GaugeCell; y++)
            {
                Polar(x, y, out float r, out _);
                Color c = Color.clear;
                if (r >= FillIn && r <= FillOut)
                {
                    float t = (r - FillIn) / (FillOut - FillIn);
                    float v = t < 0.25f ? 0.72f : t < 0.75f ? 1f : 0.86f;
                    c = new Color(v, v, v, 1f);
                }
                tex.SetPixel(x, y, c);
            }
        tex.Apply();
        return tex;
    }
}
