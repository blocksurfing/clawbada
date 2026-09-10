using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Painted action-button art for the in-canvas HUD, replacing the 1-bit placeholder set:
/// bevelled hex plates with a lit stone rim and a coloured inset face (one per action, plus
/// a neutral plate and a driftwood gear plate), an armed glow ring, and shaded glyphs
/// (blade, starburst, shield, hourglass, cog, undo arrow).
///
/// Everything is rasterised from polygon/SDF geometry at 4x and box-downsampled, so edges
/// are anti-aliased and the gradients survive canvas scaling — the old glyphs were hand-typed
/// 16x16 ASCII bitmaps, which is why they read as flat stencils next to LOKR's buttons.
///
/// Re-runnable: only the slots this generator owns are overwritten, so a designer's later
/// sprite drop can simply replace the PNGs (same names) or the skin references.
/// Menu: Clawbada ▸ Generate HUD Button Art. Headless: -executeMethod HudButtonArt.Generate
/// </summary>
public static class HudButtonArt
{
    /// <summary>Supersample factor: every pixel is the mean of SS×SS geometry samples.</summary>
    private const int SS = 4;
    private const int PlateW = 96, PlateH = 110;
    private const int IconSize = 64;
    /// <summary>Glow canvas is larger than the plate so the outward bloom is not clipped.</summary>
    private const int GlowPad = 14;

    // ─── Palette ───

    private static readonly Color Outline = C(0x10, 0x14, 0x1b);
    private static readonly Color Bezel = C(0x0b, 0x0f, 0x16);
    private static readonly Color RimTop = C(0xd3, 0xda, 0xe2);
    private static readonly Color RimBot = C(0x79, 0x84, 0x90);
    private static readonly Color Armed = C(0xff, 0xd2, 0x80);

    [MenuItem("Clawbada/Generate HUD Button Art")]
    public static void Generate()
    {
        HudArtGenerator.EnsureFolder(HudArtGenerator.ArtFolder);

        var made = new Dictionary<string, string>();
        // Plates: face gradient per action (top, bottom). Coral attack, claw-gold special,
        // ocean defend, teal wait, slate neutral, driftwood gear — the web palette.
        made["btn_attack"] = HudArtGenerator.WritePng("btn_attack", Plate(C(0xc9, 0x4f, 0x43), C(0x74, 0x24, 0x1f)));
        made["btn_special"] = HudArtGenerator.WritePng("btn_special", Plate(C(0xf5, 0xbe, 0x3f), C(0xa5, 0x66, 0x12)));
        made["btn_defend"] = HudArtGenerator.WritePng("btn_defend", Plate(C(0x46, 0x8b, 0xdc), C(0x1c, 0x44, 0x82)));
        made["btn_wait"] = HudArtGenerator.WritePng("btn_wait", Plate(C(0x37, 0x9c, 0x89), C(0x17, 0x51, 0x49)));
        made["btn_neutral"] = HudArtGenerator.WritePng("btn_neutral", Plate(C(0x53, 0x5f, 0x72), C(0x25, 0x2c, 0x39)));
        made["btn_gear"] = HudArtGenerator.WritePng("btn_gear", Plate(C(0x9c, 0x81, 0x5b), C(0x53, 0x40, 0x2b)));
        made["hex_glow"] = HudArtGenerator.WritePng("hex_glow", Glow());

        made["ic_attack"] = HudArtGenerator.WritePng("ic_attack", Icon(Blade()));
        made["ic_special"] = HudArtGenerator.WritePng("ic_special", Icon(Starburst()));
        made["ic_defend"] = HudArtGenerator.WritePng("ic_defend", Icon(Shield()));
        made["ic_wait"] = HudArtGenerator.WritePng("ic_wait", Icon(Hourglass()));
        made["ic_gear"] = HudArtGenerator.WritePng("ic_gear", Icon(Cog()));
        made["ic_undo"] = HudArtGenerator.WritePng("ic_undo", Icon(UndoArrow()));

        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        foreach (var path in made.Values) SetSmooth(path);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

        AssignSkin(made);
        string msg = $"[HudButtonArt] OK — {made.Count} textures in {HudArtGenerator.ArtFolder} " +
                     $"({PlateW}x{PlateH} plates, {IconSize}px glyphs, {SS}x supersampled)";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    /// <summary>Point-filtered pixel art shimmers when the canvas scales these gradients;
    /// bilinear + no compression keeps the bevels clean at any resolution.</summary>
    private static void SetSmooth(string path)
    {
        if (AssetImporter.GetAtPath(path) is not TextureImporter imp) return;
        imp.filterMode = FilterMode.Bilinear;
        imp.mipmapEnabled = false;
        imp.textureCompression = TextureImporterCompression.Uncompressed;
        imp.SaveAndReimport();
    }

    private static void AssignSkin(Dictionary<string, string> made)
    {
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>(HudArtGenerator.SkinPath);
        if (skin == null)
        {
            Debug.LogWarning($"[HudButtonArt] no {HudArtGenerator.SkinPath} — run Clawbada/Generate HUD Placeholder Art first");
            return;
        }
        Sprite S(string key) => HudArtGenerator.LoadSprite(made[key]);
        skin.btnAttack = S("btn_attack");
        skin.btnSpecial = S("btn_special");
        skin.btnDefend = S("btn_defend");
        skin.btnWait = S("btn_wait");
        skin.btnNeutral = S("btn_neutral");
        skin.btnGear = S("btn_gear");
        skin.hexGlow = S("hex_glow");
        skin.iconAttack = S("ic_attack");
        skin.iconSpecial = S("ic_special");
        skin.iconDefend = S("ic_defend");
        skin.iconWait = S("ic_wait");
        skin.iconGear = S("ic_gear");
        skin.iconUndo = S("ic_undo");
        EditorUtility.SetDirty(skin);
        AssetDatabase.SaveAssets();
    }

    // ─── Plate ───

    /// <summary>Bevelled hex button: dark outline, lit stone rim, inner bezel line, then a
    /// vertical face gradient with a top gloss and a shadow where the face meets the bezel.</summary>
    private static Texture2D Plate(Color faceTop, Color faceBot)
    {
        var hex = Hex(PlateW, PlateH);
        float rim = PlateW * 0.078f, edge = 1.3f, bezel = 1.6f;
        return Render(PlateW, PlateH, (p) =>
        {
            float d = ConvexSdf(p, hex, out Vector2 n);
            if (d > 0f) return Color.clear;
            if (d > -edge) return Outline;

            float t = Mathf.Clamp01(p.y / PlateH + 0.5f);   // 0 bottom → 1 top
            if (d > -(edge + rim))
            {
                // Rim shading follows the edge's outward normal: top edges catch the light,
                // bottom edges fall away. Reads as a metal ring rather than a flat border.
                Color c = Color.Lerp(RimBot, RimTop, t * 0.85f + 0.15f);
                float lit = Mathf.Clamp01(n.y);
                float shade = Mathf.Clamp01(-n.y);
                c = Color.Lerp(c, Color.white, 0.34f * lit);
                c = Color.Lerp(c, Outline, 0.30f * shade);
                return c;
            }
            if (d > -(edge + rim + bezel)) return Bezel;

            Color face = Color.Lerp(faceBot, faceTop, t);
            // Top gloss: soft ellipse in the upper third.
            float gx = p.x / (PlateW * 0.34f), gy = (p.y - PlateH * 0.20f) / (PlateH * 0.17f);
            float gloss = Mathf.Clamp01(1f - (gx * gx + gy * gy));
            face = Color.Lerp(face, Color.white, 0.20f * gloss * gloss);
            // Contact shadow just inside the bezel.
            float inner = -(d + edge + rim + bezel);        // 0 at the bezel, grows inward
            face = Color.Lerp(Color.Lerp(face, Bezel, 0.28f), face, Mathf.Clamp01(inner / 5f));
            return face;
        });
    }

    /// <summary>Armed ring: a warm bloom straddling the plate edge, drawn over the button.</summary>
    private static Texture2D Glow()
    {
        int w = PlateW + GlowPad, h = PlateH + GlowPad;
        var hex = Hex(PlateW, PlateH);
        return Render(w, h, (p) =>
        {
            float d = ConvexSdf(p, hex, out _);
            // Peak on the edge, 6 px out and 4 px in.
            float a = d >= 0f ? 1f - Mathf.Clamp01(d / 6f) : 1f - Mathf.Clamp01(-d / 4f);
            a = a * a * 0.85f;
            return new Color(Armed.r, Armed.g, Armed.b, a);
        });
    }

    // ─── Icons ───

    private class Glyph
    {
        public readonly List<Vector2[]> Fills = new();
        public readonly List<Vector2[]> Holes = new();
        public readonly List<Vector2[]> Accents = new();
        public Color Top = C(0xee, 0xf3, 0xf8), Bottom = C(0x9a, 0xac, 0xbe);
        public Color Accent = C(0xf5, 0xc4, 0x6a);
    }

    /// <summary>Rasterise a glyph: dark inner outline, vertical fill gradient, a highlight
    /// along the upper edge, and accents (hourglass sand, shield boss) on top.</summary>
    private static Texture2D Icon(Glyph g)
    {
        float r = IconSize * 0.5f;
        float outline = IconSize * 0.030f, hi = IconSize * 0.028f;
        return Render(IconSize, IconSize, (p) =>
        {
            Vector2 u = p / r;                              // normalised [-1, 1]
            bool inside = false;
            foreach (var poly in g.Fills) if (InPoly(u, poly)) { inside = true; break; }
            if (inside) foreach (var hole in g.Holes) if (InPoly(u, hole)) { inside = false; break; }
            if (!inside) return Color.clear;

            float dist = float.MaxValue;
            foreach (var poly in g.Fills) dist = Mathf.Min(dist, DistToPoly(u, poly));
            foreach (var hole in g.Holes) dist = Mathf.Min(dist, DistToPoly(u, hole));
            dist *= r;                                      // back to pixels

            foreach (var acc in g.Accents)
            {
                if (!InPoly(u, acc)) continue;
                float ad = DistToPoly(u, acc) * r;
                return ad < outline * 0.8f ? Color.Lerp(g.Accent, Outline, 0.55f) : g.Accent;
            }
            if (dist < outline) return Outline;

            float t = Mathf.Clamp01(u.y * 0.5f + 0.5f);
            Color c = Color.Lerp(g.Bottom, g.Top, t);
            if (dist < outline + hi && u.y > -0.15f) c = Color.Lerp(c, Color.white, 0.45f);
            return c;
        });
    }

    private static Glyph Blade()
    {
        var g = new Glyph();
        // Authored point-up, then leaned right like a raised sword.
        var blade = Poly(-0.15f, -0.10f, 0.15f, -0.10f, 0.15f, 0.60f, 0f, 0.95f, -0.15f, 0.60f);
        var guard = Poly(-0.54f, -0.10f, 0.54f, -0.10f, 0.46f, -0.30f, -0.46f, -0.30f);
        var grip = Poly(-0.11f, -0.30f, 0.11f, -0.30f, 0.11f, -0.76f, -0.11f, -0.76f);
        var pommel = Circle(new Vector2(0f, -0.82f), 0.15f);
        foreach (var poly in new[] { blade, guard, grip, pommel }) g.Fills.Add(Rotate(poly, -32f));
        return g;
    }

    private static Glyph Starburst()
    {
        var g = new Glyph { Top = C(0xff, 0xef, 0xbb), Bottom = C(0xef, 0x9f, 0x1c), Accent = C(0xff, 0xf7, 0xdd) };
        g.Fills.Add(Star(8, 0.97f, 0.34f, 22.5f));
        g.Accents.Add(Circle(Vector2.zero, 0.20f));
        return g;
    }

    private static Glyph Shield()
    {
        var g = new Glyph { Top = C(0xdd, 0xea, 0xfb), Bottom = C(0x74, 0x9f, 0xd2), Accent = C(0xff, 0xe4, 0xa8) };
        // Heater shield: near-flat top with shoulders, straight sides, rounded point. A domed
        // top read as a map pin, which is why the silhouette starts wide instead of curving up.
        g.Fills.Add(Poly(0f, 0.84f, 0.40f, 0.80f, 0.70f, 0.68f, 0.76f, 0.36f, 0.71f, -0.02f, 0.57f, -0.38f,
                         0.33f, -0.70f, 0f, -0.90f, -0.33f, -0.70f, -0.57f, -0.38f, -0.71f, -0.02f,
                         -0.76f, 0.36f, -0.70f, 0.68f, -0.40f, 0.80f));
        g.Accents.Add(Circle(new Vector2(0f, 0.16f), 0.20f));
        return g;
    }

    private static Glyph Hourglass()
    {
        var g = new Glyph { Top = C(0xe8, 0xf7, 0xf3), Bottom = C(0x86, 0xba, 0xb0), Accent = C(0xf3, 0xc0, 0x5e) };
        g.Fills.Add(Poly(-0.72f, 0.90f, 0.72f, 0.90f, 0.72f, 0.70f, -0.72f, 0.70f));
        g.Fills.Add(Poly(-0.72f, -0.90f, 0.72f, -0.90f, 0.72f, -0.70f, -0.72f, -0.70f));
        g.Fills.Add(Poly(-0.50f, 0.70f, 0.50f, 0.70f, 0.09f, 0f, 0.50f, -0.70f, -0.50f, -0.70f, -0.09f, 0f));
        // Sand: a heap in the lower bulb plus the falling stream.
        g.Accents.Add(Poly(-0.34f, -0.66f, 0.34f, -0.66f, 0.06f, -0.30f, -0.06f, -0.30f));
        g.Accents.Add(Poly(-0.045f, -0.30f, 0.045f, -0.30f, 0.045f, 0.24f, -0.045f, 0.24f));
        return g;
    }

    private static Glyph Cog()
    {
        var g = new Glyph { Top = C(0xf6, 0xee, 0xdc), Bottom = C(0xb4, 0x9f, 0x7c) };
        g.Fills.Add(Gear(8, 0.97f, 0.66f));
        g.Fills.Add(Circle(Vector2.zero, 0.68f));
        g.Holes.Add(Circle(Vector2.zero, 0.27f));
        return g;
    }

    private static Glyph UndoArrow()
    {
        var g = new Glyph { Top = C(0xe6, 0xed, 0xf5), Bottom = C(0x93, 0xa4, 0xb6) };
        g.Fills.Add(Arc(0.82f, 0.50f, 130f, -110f, 26));
        // Arrowhead on the leading (counter-clockwise) end of the arc.
        float a = 130f * Mathf.Deg2Rad;
        Vector2 mid = new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * 0.66f;
        Vector2 tangent = new Vector2(-Mathf.Sin(a), Mathf.Cos(a));
        Vector2 radial = mid.normalized;
        g.Fills.Add(new[] { mid + tangent * 0.44f, mid + radial * 0.31f, mid - radial * 0.31f });
        return g;
    }

    // ─── Rasteriser ───

    /// <summary>Sample `shade` on an SS×SS grid per pixel and box-filter the result.
    /// Colours are averaged premultiplied so anti-aliased edges keep their hue.</summary>
    private static Texture2D Render(int w, int h, System.Func<Vector2, Color> shade)
    {
        var tex = HudArtGenerator.NewTex(w, h);
        var px = new Color[w * h];
        float step = 1f / SS, half = step * 0.5f;
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
        {
            float r = 0f, g = 0f, b = 0f, a = 0f;
            for (int sy = 0; sy < SS; sy++)
            for (int sx = 0; sx < SS; sx++)
            {
                var p = new Vector2(x + half + sx * step - w * 0.5f, y + half + sy * step - h * 0.5f);
                var c = shade(p);
                r += c.r * c.a; g += c.g * c.a; b += c.b * c.a; a += c.a;
            }
            int n = SS * SS;
            px[y * w + x] = a <= 0.0001f ? Color.clear : new Color(r / a, g / a, b / a, a / n);
        }
        tex.SetPixels(px);
        tex.Apply();
        return tex;
    }

    // ─── Geometry ───

    private static Color C(int r, int g, int b) => new Color(r / 255f, g / 255f, b / 255f, 1f);

    /// <summary>Pointy-top hexagon inscribed in w×h, counter-clockwise, centred on the origin.</summary>
    private static Vector2[] Hex(float w, float h)
    {
        float a = w * 0.5f, b = h * 0.5f;
        return new[]
        {
            new Vector2(0f, b), new Vector2(-a, b * 0.5f), new Vector2(-a, -b * 0.5f),
            new Vector2(0f, -b), new Vector2(a, -b * 0.5f), new Vector2(a, b * 0.5f),
        };
    }

    /// <summary>Signed distance to a convex CCW polygon (negative inside) plus the outward
    /// normal of the nearest edge plane — used for the rim lighting.</summary>
    private static float ConvexSdf(Vector2 p, Vector2[] verts, out Vector2 normal)
    {
        float best = float.NegativeInfinity;
        normal = Vector2.up;
        for (int i = 0; i < verts.Length; i++)
        {
            Vector2 v0 = verts[i], v1 = verts[(i + 1) % verts.Length];
            Vector2 e = v1 - v0;
            var n = new Vector2(e.y, -e.x).normalized;      // outward for CCW winding
            float d = Vector2.Dot(p - v0, n);
            if (d > best) { best = d; normal = n; }
        }
        return best;
    }

    private static bool InPoly(Vector2 p, Vector2[] poly)
    {
        bool inside = false;
        for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
        {
            Vector2 a = poly[i], b = poly[j];
            if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    }

    private static float DistToPoly(Vector2 p, Vector2[] poly)
    {
        float best = float.MaxValue;
        for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
        {
            Vector2 a = poly[i], b = poly[j], e = b - a;
            float len2 = e.sqrMagnitude;
            float t = len2 <= 1e-8f ? 0f : Mathf.Clamp01(Vector2.Dot(p - a, e) / len2);
            best = Mathf.Min(best, (p - (a + e * t)).magnitude);
        }
        return best;
    }

    private static Vector2[] Poly(params float[] xy)
    {
        var pts = new Vector2[xy.Length / 2];
        for (int i = 0; i < pts.Length; i++) pts[i] = new Vector2(xy[i * 2], xy[i * 2 + 1]);
        return pts;
    }

    private static Vector2[] Circle(Vector2 c, float r, int seg = 32)
    {
        var pts = new Vector2[seg];
        for (int i = 0; i < seg; i++)
        {
            float a = i / (float)seg * Mathf.PI * 2f;
            pts[i] = c + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * r;
        }
        return pts;
    }

    private static Vector2[] Star(int points, float outer, float inner, float rotDeg)
    {
        var pts = new Vector2[points * 2];
        for (int i = 0; i < pts.Length; i++)
        {
            float a = (i / (float)pts.Length * 360f + rotDeg) * Mathf.Deg2Rad;
            float r = (i % 2 == 0) ? outer : inner;
            pts[i] = new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * r;
        }
        return pts;
    }

    private static Vector2[] Gear(int teeth, float outer, float root)
    {
        var pts = new List<Vector2>(teeth * 4);
        float span = Mathf.PI / teeth;                       // half a tooth pitch
        for (int i = 0; i < teeth; i++)
        {
            float a = i * 2f * span;
            AddPolar(pts, root, a - span * 0.88f);
            AddPolar(pts, outer, a - span * 0.52f);
            AddPolar(pts, outer, a + span * 0.52f);
            AddPolar(pts, root, a + span * 0.88f);
        }
        return pts.ToArray();
    }

    /// <summary>Annulus segment (a ring band) from `fromDeg` sweeping `sweepDeg`.</summary>
    private static Vector2[] Arc(float outer, float inner, float fromDeg, float sweepDeg, int seg)
    {
        var pts = new List<Vector2>(seg * 2 + 2);
        for (int i = 0; i <= seg; i++)
        {
            float a = (fromDeg + sweepDeg * i / seg) * Mathf.Deg2Rad;
            pts.Add(new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * outer);
        }
        for (int i = seg; i >= 0; i--)
        {
            float a = (fromDeg + sweepDeg * i / seg) * Mathf.Deg2Rad;
            pts.Add(new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * inner);
        }
        return pts.ToArray();
    }

    private static void AddPolar(List<Vector2> pts, float r, float a) =>
        pts.Add(new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * r);

    private static Vector2[] Rotate(Vector2[] pts, float deg)
    {
        float c = Mathf.Cos(deg * Mathf.Deg2Rad), s = Mathf.Sin(deg * Mathf.Deg2Rad);
        var outPts = new Vector2[pts.Length];
        for (int i = 0; i < pts.Length; i++) outPts[i] = new Vector2(pts[i].x * c - pts[i].y * s, pts[i].x * s + pts[i].y * c);
        return outPts;
    }
}
