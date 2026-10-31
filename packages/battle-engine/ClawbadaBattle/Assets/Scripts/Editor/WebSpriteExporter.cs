using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Renders battle art out of the Unity rigs for the website (owner 2026-10-30: the Dojo lobby's lineup should idle, and
/// the ninja squirrel should run over the lobby's backdrop like it does in battle). Off-screen, through an orthographic
/// camera at 64 PPU into a point-filtered RenderTexture, so every pixel matches the battle.
///
///   · Idle sheets: apps/web/public/ui/dojo/idle/{Evolved,Elite,Apex}.png — 640 × 320, one column per class in the
///     web's class order (Bulwark … Ember, as the market sheets), one row per Idle frame (5 frames at 12 fps). Each
///     64 × 64 frame stands the rig's root on the class sheets' floor point (32, 44), facing left like the sheets.
///     A framing check compares frame 0 with the market sheet's still frame (foot line, horizontal centre) and logs
///     every class that disagrees by more than a pixel.
///   · Squirrel: apps/web/public/ui/dojo/squirrel.png — a horizontal strip of RunJumpVanish (3.5 s at 20 fps), cropped to
///     the squirrel and its leaves, plus squirrel.json with where the crop sits on the 640 × 360 Dojo backdrop.
///
/// Menu: Clawbada ▸ Web ▸ Export Dojo Sprites. Headless (needs graphics — no -nographics):
///   Unity -batchmode -quit -projectPath … -executeMethod WebSpriteExporter.ExportAll
/// Rerun whenever the rigs, the Idle clips or the squirrel change, and commit the PNGs.
/// </summary>
public static class WebSpriteExporter
{
    private const int Ppu = 64;
    private const int Frame = 64;
    private const int FloorX = 32, FloorY = 44;   // the class sheets' floor point, from the top-left of a frame
    private const int IdleFrames = 5;
    private const float IdleFps = 12f;
    private const float SquirrelFps = 20f;
    private static readonly string[] Classes = { "Bulwark", "Mantis", "Leviathan", "Tempest", "Specter", "Sentinel", "Reaver", "Abyss", "Kraken", "Ember" };
    private static readonly (int index, string name)[] Tiers = { (1, "Evolved"), (2, "Elite"), (3, "Apex") };

    private const string PrefabLibraryPath = "Assets/Prefabs/Lobsters/LobsterPrefabLibrary.asset";
    private const string DojoArenaPath = "Assets/Art/Arenas/Dojo/ArenaArt_Dojo.prefab";
    private const string SquirrelClipPath = "Assets/Art/Arenas/Dojo/Squirrel/Squirrel_NinjaExit.anim";

    private static string RepoRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "../../../.."));
    private static string WebDojoDir => Path.Combine(RepoRoot, "apps/web/public/ui/dojo");

    [MenuItem("Clawbada/Web/Export Dojo Sprites")]
    public static void ExportAll()
    {
        int problems = ExportIdleSheets() + ExportSquirrel();
        Debug.Log($"[WebSpriteExporter] done — {problems} problem(s)");
        if (Application.isBatchMode) EditorApplication.Exit(problems == 0 ? 0 : 1);
    }

    // ─── Idle sheets ───

    private static int ExportIdleSheets()
    {
        var library = AssetDatabase.LoadAssetAtPath<LobsterPrefabLibrary>(PrefabLibraryPath);
        if (library == null) { Debug.LogError($"[WebSpriteExporter] no prefab library at {PrefabLibraryPath}"); return 1; }
        Directory.CreateDirectory(Path.Combine(WebDojoDir, "idle"));
        int problems = 0;
        var report = new StringBuilder();
        foreach (var (tierIndex, tierName) in Tiers)
        {
            var sheet = new Texture2D(Frame * Classes.Length, Frame * IdleFrames, TextureFormat.RGBA32, false);
            sheet.SetPixels32(new Color32[sheet.width * sheet.height]);
            var still = LoadPng(Path.Combine(RepoRoot, $"apps/web/public/ui/market/sheets/{tierName}.png"));
            for (int c = 0; c < Classes.Length; c++)
            {
                var prefab = library.Get(tierIndex, Classes[c]);
                if (prefab == null) { Debug.LogError($"[WebSpriteExporter] no {tierName} {Classes[c]} prefab"); problems++; continue; }
                var rig = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                try
                {
                    rig.transform.position = Vector3.zero;
                    // Face left like the sheets, the way the battle sets it (LobsterController.SetFacing: absolute Y 0) —
                    // some prefabs are saved turned round.
                    rig.transform.rotation = Quaternion.identity;
                    HideShadows(rig);
                    var clip = ClipNamed(rig, "Idle");
                    if (clip == null) { Debug.LogError($"[WebSpriteExporter] {tierName} {Classes[c]}: no Idle clip"); problems++; continue; }
                    var frames = new Color32[IdleFrames][];
                    for (int f = 0; f < IdleFrames; f++)
                    {
                        clip.SampleAnimation(rig, Mathf.Min(f / IdleFps, clip.length));
                        // Root on the floor point: the frame's centre is (32, 32) from the top-left, so the camera looks
                        // (44 − 32) px above the root.
                        frames[f] = Render(new Vector3(0f, (FloorY - Frame / 2f) / Ppu, 0f), Frame, Frame);
                    }
                    // The still sheets were not drawn on the rig root (their feet sit ~9–13 px higher, per tier): line the
                    // idle up with the class's still frame — same foot line, same horizontal centre — so swapping the
                    // still for the idle never moves the lobster.
                    var (sx, sy) = still != null ? Offset(frames[0], still, c) : (0, 0);
                    for (int f = 0; f < IdleFrames; f++)
                    {
                        var shifted = Shift(frames[f], sx, sy);
                        sheet.SetPixels32(c * Frame, (IdleFrames - 1 - f) * Frame, Frame, Frame, shifted);
                        if (f == 0 && still != null) problems += CheckFraming(report, tierName, c, shifted, still, sx, sy);
                    }
                }
                finally { Object.DestroyImmediate(rig); }
            }
            sheet.Apply();
            File.WriteAllBytes(Path.Combine(WebDojoDir, "idle", $"{tierName}.png"), sheet.EncodeToPNG());
            Object.DestroyImmediate(sheet);
            if (still != null) Object.DestroyImmediate(still);
        }
        File.WriteAllText(Path.Combine(WebDojoDir, "idle", "idle.json"),
            $"{{\"frames\":{IdleFrames},\"fps\":{IdleFps},\"frame\":{Frame},\"floor\":[{FloorX},{FloorY}],\"classes\":[{string.Join(",", Classes.Select(n => $"\"{n.ToLowerInvariant()}\""))}]}}\n");
        Debug.Log($"[WebSpriteExporter] idle sheets written\n{report}");
        return problems;
    }

    /// <summary>Frame 0 against the market sheet's still frame: the lowest opaque row and the horizontal centre of the
    /// opaque pixels should agree within a pixel, or the idle would jump against the still art used elsewhere.</summary>
    private static int CheckFraming(StringBuilder report, string tier, int classIndex, Color32[] frame, Texture2D still, int sx, int sy)
    {
        var a = Bounds(frame, Frame, Frame);
        var b = Bounds(StillFrame(still, classIndex), Frame, Frame);
        float dx = (a.xMin + a.xMax) / 2f - (b.xMin + b.xMax) / 2f;
        int dy = a.yMin - b.yMin;   // bottom rows (texture y grows upward)
        // How much of the still's silhouette the idle's first frame covers: a different pose or facing shows up here.
        var stillPixels = StillFrame(still, classIndex);
        int both = 0, either = 0;
        for (int i = 0; i < frame.Length; i++)
        {
            bool p = frame[i].a > 0, q = stillPixels[i].a > 0;
            if (p || q) either++;
            if (p && q) both++;
        }
        float overlap = either > 0 ? (float)both / either : 0f;
        bool ok = Mathf.Abs(dx) <= 1f && Mathf.Abs(dy) <= 1 && overlap >= 0.6f;   // the market stills use a few different poses (Kraken, Ember)
        report.AppendLine($"  {tier,-8} {Classes[classIndex],-9} shifted ({sx,3},{sy,3})  centre Δx {dx,5:F1}  foot Δy {dy,3}  silhouette overlap {overlap:P0}  {(ok ? "ok" : "MISMATCH")}");
        return ok ? 0 : 1;
    }

    private static Color32[] StillFrame(Texture2D still, int classIndex)
    {
        var stillPixels = still.GetPixels32();
        var region = new Color32[Frame * Frame];
        for (int y = 0; y < Frame; y++)
            for (int x = 0; x < Frame; x++)
                region[y * Frame + x] = stillPixels[y * still.width + classIndex * Frame + x];
        return region;
    }

    /// <summary>The integer shift that puts this frame's foot line and horizontal centre on the still frame's.</summary>
    private static (int, int) Offset(Color32[] frame, Texture2D still, int classIndex)
    {
        var a = Bounds(frame, Frame, Frame);
        var b = Bounds(StillFrame(still, classIndex), Frame, Frame);
        if (a.xMax < a.xMin || b.xMax < b.xMin) return (0, 0);
        return (Mathf.RoundToInt((b.xMin + b.xMax - a.xMin - a.xMax) / 2f), b.yMin - a.yMin);
    }

    private static Color32[] Shift(Color32[] src, int dx, int dy)
    {
        if (dx == 0 && dy == 0) return src;
        var dst = new Color32[src.Length];
        for (int y = 0; y < Frame; y++)
            for (int x = 0; x < Frame; x++)
            {
                int sx = x - dx, sy = y - dy;
                if (sx >= 0 && sx < Frame && sy >= 0 && sy < Frame) dst[y * Frame + x] = src[sy * Frame + sx];
            }
        return dst;
    }

    // ─── Squirrel ───

    private static int ExportSquirrel()
    {
        var arenaPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(DojoArenaPath);
        var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(SquirrelClipPath);
        if (arenaPrefab == null || clip == null) { Debug.LogError("[WebSpriteExporter] Dojo arena or squirrel clip missing"); return 1; }
        var arena = (GameObject)PrefabUtility.InstantiatePrefab(arenaPrefab);
        try
        {
            arena.transform.position = Vector3.zero;
            var squirrel = arena.GetComponentsInChildren<Transform>(true).FirstOrDefault(t => t.name.StartsWith("Squirrel"));
            var backdrop = arena.GetComponentsInChildren<SpriteRenderer>(true).FirstOrDefault(r => r.sprite != null && r.sprite.name.StartsWith("BG_Dojo"));
            if (squirrel == null || backdrop == null) { Debug.LogError("[WebSpriteExporter] no squirrel or BG_Dojo in the Dojo arena"); return 1; }
            squirrel.gameObject.SetActive(true);
            foreach (var r in arena.GetComponentsInChildren<Renderer>(true)) r.enabled = r.transform.IsChildOf(squirrel);
            foreach (var behaviour in squirrel.GetComponentsInChildren<MonoBehaviour>(true)) behaviour.enabled = false;

            // The backdrop's own rect is the website's 640 × 360 Dojo image: frame the camera on it exactly.
            var bg = backdrop.bounds;
            int w = Mathf.RoundToInt(bg.size.x * Ppu), h = Mathf.RoundToInt(bg.size.y * Ppu);
            int count = Mathf.RoundToInt(clip.length * SquirrelFps);
            var frames = new List<Color32[]>(count);
            for (int i = 0; i < count; i++)
            {
                clip.SampleAnimation(squirrel.gameObject, i / SquirrelFps);
                frames.Add(Render(new Vector3(bg.center.x, bg.center.y, 0f), w, h));
            }
            // Union of the opaque pixels over the whole run, so every frame shares one rect.
            int xMin = w, yMin = h, xMax = -1, yMax = -1;
            foreach (var f in frames)
            {
                var b = Bounds(f, w, h);
                if (b.xMax < b.xMin) continue;
                xMin = Mathf.Min(xMin, b.xMin); yMin = Mathf.Min(yMin, b.yMin);
                xMax = Mathf.Max(xMax, b.xMax); yMax = Mathf.Max(yMax, b.yMax);
            }
            if (xMax < 0) { Debug.LogError("[WebSpriteExporter] the squirrel rendered nothing"); return 1; }
            var crop = new RectInt(xMin, yMin, xMax - xMin + 1, yMax - yMin + 1);
            var strip = new Texture2D(crop.width * count, crop.height, TextureFormat.RGBA32, false);
            for (int i = 0; i < count; i++)
            {
                var cut = new Color32[crop.width * crop.height];
                for (int y = 0; y < crop.height; y++)
                    for (int x = 0; x < crop.width; x++)
                        cut[y * crop.width + x] = frames[i][(crop.y + y) * w + crop.x + x];
                strip.SetPixels32(i * crop.width, 0, crop.width, crop.height, cut);
            }
            strip.Apply();
            File.WriteAllBytes(Path.Combine(WebDojoDir, "squirrel.png"), strip.EncodeToPNG());
            Object.DestroyImmediate(strip);
            int top = h - (crop.y + crop.height);   // the web measures from the top-left
            File.WriteAllText(Path.Combine(WebDojoDir, "squirrel.json"),
                $"{{\"frames\":{count},\"fps\":{SquirrelFps},\"width\":{crop.width},\"height\":{crop.height},\"x\":{crop.x},\"y\":{top},\"backdrop\":[{w},{h}]}}\n");
            Debug.Log($"[WebSpriteExporter] squirrel: {count} frames, {crop.width}×{crop.height} at ({crop.x},{top}) on {w}×{h}");
            return 0;
        }
        finally { Object.DestroyImmediate(arena); }
    }

    // ─── Rendering ───

    /// <summary>Render the scene's enabled renderers into a w × h image centred on <paramref name="centre"/> (world units),
    /// one pixel per 1/64 unit, transparent background. Pixels bottom-up, as Unity's textures.</summary>
    private static Color32[] Render(Vector3 centre, int w, int h)
    {
        var go = new GameObject("WebSpriteExporter Camera");
        var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32) { filterMode = FilterMode.Point, antiAliasing = 1 };
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        try
        {
            var cam = go.AddComponent<Camera>();
            cam.orthographic = true;
            cam.orthographicSize = h / 2f / Ppu;
            cam.aspect = (float)w / h;
            cam.transform.position = new Vector3(centre.x, centre.y, -10f);
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0, 0, 0, 0);
            cam.allowHDR = false;
            cam.allowMSAA = false;
            cam.targetTexture = rt;
            cam.Render();
            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            tex.Apply();
            RenderTexture.active = prev;
            cam.targetTexture = null;
            return tex.GetPixels32();
        }
        finally
        {
            Object.DestroyImmediate(go);
            Object.DestroyImmediate(rt);
            Object.DestroyImmediate(tex);
        }
    }

    /// <summary>Inclusive opaque bounds (texture coordinates, y up); xMax &lt; xMin when the image is empty.</summary>
    private static (int xMin, int yMin, int xMax, int yMax) Bounds(Color32[] pixels, int w, int h)
    {
        int xMin = w, yMin = h, xMax = -1, yMax = -1;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                if (pixels[y * w + x].a == 0) continue;
                if (x < xMin) xMin = x;
                if (x > xMax) xMax = x;
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
            }
        return (xMin, yMin, xMax, yMax);
    }

    private static AnimationClip ClipNamed(GameObject rig, string name)
    {
        var animator = rig.GetComponent<Animator>();
        var clips = animator != null && animator.runtimeAnimatorController != null ? animator.runtimeAnimatorController.animationClips : null;
        return clips?.FirstOrDefault(c => c != null && c.name == name);
    }

    private static void HideShadows(GameObject rig)
    {
        foreach (var r in rig.GetComponentsInChildren<Renderer>(true))
            if (r.name.Contains("Shadow")) r.enabled = false;
    }

    private static Texture2D LoadPng(string path)
    {
        if (!File.Exists(path)) return null;
        var t = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        return t.LoadImage(File.ReadAllBytes(path)) ? t : null;
    }
}
