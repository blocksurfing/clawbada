using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Binds Nzib's HUD into Resources/UI/HudSkin.asset (drop 28c11f5, 2026-09-28):
///   Prefabs/UI/Avatar/AvatarUI.prefab + Prefabs/UI/ActionButton/ActionButtonUI.prefab → avatarPrefab / actionButtonPrefab
///     (referenced from the skin, so they ship in the build);
///   Art/UI/ActionButton_Frame.png → ActionButton_Frame_Normal → actionFrame;
///   Art/UI/ActionButton.png → ActionButton_Attack / _Defend / _Wait + one ActionButton_&lt;Class&gt;_&lt;Special&gt; per class;
///   Art/UI/Avatar/Avatar_BG.png → Avatar_BG_&lt;Class&gt; → avatarBg[classId];
///   Art/UI/Avatar/HP_Bar.png → HP_Healthy / _Wounded / _Low / _Critical → hpStates.
/// Also generates, to line up with his art pixel for pixel:
///   action_glow.png    — a stepped 3 px halo around the frame's hex (hover glow);
///   hud_timer_hex.png / hud_settings_hex.png — PLACEHOLDERS (user 2026-09-28) for the top-left turn timer and settings
///                        hexes: his button frame with a dark green / dark brown fill, until he draws them;
///   hud_order_hex.png  — a small hex in the same palette for the turn-order number on each team panel;
///   avatar_popmask.png — opaque everywhere OUTSIDE the portrait aperture of Avatar_Frame (plus a PopMargin border),
///                        the mask for the claws/antennae that break out over the frame.
/// Slices are found by NAME, so a re-slice or a re-ordered sheet still binds. Re-run after any HUD drop.
/// Menu: Clawbada ▸ HUD ▸ Bind Nzib HUD Art. Headless: -executeMethod NzibHudBinder.Bind
/// </summary>
public static class NzibHudBinder
{
    private const string ButtonSheet = "Assets/Art/UI/ActionButton.png";
    private const string ButtonFrameSheet = "Assets/Art/UI/ActionButton_Frame.png";
    private const string AvatarBgSheet = "Assets/Art/UI/Avatar/Avatar_BG.png";
    private const string HpSheet = "Assets/Art/UI/Avatar/HP_Bar.png";
    private const string AvatarPrefabPath = "Assets/Prefabs/UI/Avatar/AvatarUI.prefab";
    private const string ButtonPrefabPath = "Assets/Prefabs/UI/ActionButton/ActionButtonUI.prefab";
    private const int GlowPad = 4;

    // Avatar_Frame geometry (docs/AVATAR_UI_VISUAL_HANDOFF.md): a 112×64 frame; the portrait aperture is the circle
    // x=[11,43), y=[18,50) in top-left PNG coordinates → centre (27, 30) from the bottom-left, radius 16.
    public const int FrameW = 112, FrameH = 64, PopMargin = 16;
    private const float ApertureX = 27f, ApertureY = 30f, ApertureR = 16f;

    [MenuItem("Clawbada/HUD/Bind Nzib HUD Art")]
    public static void Bind()
    {
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>(HudArtGenerator.SkinPath);
        if (skin == null) throw new System.Exception($"[NzibHudBinder] missing {HudArtGenerator.SkinPath} — run Clawbada/Generate HUD Placeholder Art first");

        Sprite[] Sheet(string path) => AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().ToArray();
        Sprite Find(Sprite[] all, string name) => all.FirstOrDefault(s => s.name == name);
        var buttons = Sheet(ButtonSheet);
        var bgs = Sheet(AvatarBgSheet);
        var hp = Sheet(HpSheet);

        skin.avatarPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(AvatarPrefabPath);
        skin.actionButtonPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(ButtonPrefabPath);
        skin.actionFrame = Find(Sheet(ButtonFrameSheet), "ActionButton_Frame_Normal");
        skin.actionAttack = Find(buttons, "ActionButton_Attack");
        skin.actionDefend = Find(buttons, "ActionButton_Defend");
        skin.actionWait = Find(buttons, "ActionButton_Wait");
        skin.hpStates = new[] { Find(hp, "HP_Healthy"), Find(hp, "HP_Wounded"), Find(hp, "HP_Low"), Find(hp, "HP_Critical") };
        skin.specialButtons = new Sprite[LobsterClasses.Names.Length];
        skin.avatarBg = new Sprite[LobsterClasses.Names.Length];
        int specials = 0, nBg = 0;
        for (int c = 0; c < LobsterClasses.Names.Length; c++)
        {
            string cls = LobsterClasses.Names[c];
            skin.specialButtons[c] = buttons.FirstOrDefault(s => s.name.StartsWith($"ActionButton_{cls}_"));
            skin.avatarBg[c] = Find(bgs, $"Avatar_BG_{cls}");
            if (skin.specialButtons[c] != null) specials++;
            if (skin.avatarBg[c] != null) nBg++;
        }
        if (skin.avatarPrefab == null || skin.actionButtonPrefab == null)
            throw new System.Exception($"[NzibHudBinder] missing {AvatarPrefabPath} or {ButtonPrefabPath}");
        if (skin.actionFrame == null || skin.actionAttack == null || skin.actionDefend == null || skin.actionWait == null)
            throw new System.Exception($"[NzibHudBinder] {ButtonFrameSheet} / {ButtonSheet} is missing a Normal frame or Attack/Defend/Wait slice");
        if (skin.hpStates.Any(s => s == null)) throw new System.Exception($"[NzibHudBinder] {HpSheet} is missing an HP_* state");

        skin.actionGlow = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("action_glow", Glow(skin.actionFrame)));
        skin.avatarPopMask = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("avatar_popmask", PopMask()));
        skin.timerHex = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("hud_timer_hex", FilledFrame(skin.actionFrame, new Color32(0x1c, 0x3a, 0x2a, 0xff), new Color32(0x2e, 0x6a, 0x45, 0xff))));
        skin.settingsHex = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("hud_settings_hex", FilledFrame(skin.actionFrame, new Color32(0x3a, 0x2c, 0x26, 0xff), new Color32(0x5a, 0x45, 0x38, 0xff))));
        skin.orderHex = HudArtGenerator.LoadSprite(HudArtGenerator.WritePng("hud_order_hex", OrderHex()));

        // Drop 25d2fbe (2026-09-30): his badges, timer card and settings button replace the placeholders above
        // wherever they are bound (the placeholders stay generated as the fallback).
        var orderSheet = Sheet("Assets/Art/UI/Avatar/OrderingBadge.png");
        var classSheet = Sheet("Assets/Art/UI/Avatar/ClassBadge.png");
        var timerSheet = Sheet("Assets/Art/UI/Timer_Indicator.png");
        var gearSheet = Sheet("Assets/Art/UI/SettingsButton.png");
        skin.orderBadges = Enumerable.Range(1, 6).Select(n => Find(orderSheet, $"OrderingBadge_{n}")).ToArray();
        skin.classBadges = LobsterClasses.Names.Select(c => Find(classSheet, $"ClassBadge_{c}")).ToArray();
        skin.timerCardPrefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/UI/TimerCard/TimerCardUI.prefab");
        skin.timerIndicators = new[] { "Green", "Yellow", "Orange", "Red" }.Select(c => Find(timerSheet, $"Timer_Indicator_{c}")).ToArray();
        skin.settingsNormal = Find(gearSheet, "SettingsButton_Normal");
        skin.settingsPressed = Find(gearSheet, "SettingsButton_Pressed");
        var statusSheet = Sheet("Assets/Art/UI/Avatar/StatusBadge.png");
        skin.statusDefense = Find(statusSheet, "StatusBadge_Defense");
        skin.statusArmorBuff = Find(statusSheet, "StatusBadge_ArmorBuff");
        skin.statusBleeding = Find(statusSheet, "StatusBadge_Bleeding");
        skin.statusDebuff = Find(statusSheet, "StatusBadge_Debuff");
        skin.statusBlockedTurn = Find(statusSheet, "StatusBadge_BlockedTurn");
        int nStatus = new[] { skin.statusDefense, skin.statusArmorBuff, skin.statusBleeding, skin.statusDebuff, skin.statusBlockedTurn }.Count(s => s != null);
        int nOrder = skin.orderBadges.Count(s => s != null), nClass = skin.classBadges.Count(s => s != null), nTimer = skin.timerIndicators.Count(s => s != null);

        EditorUtility.SetDirty(skin);
        AssetDatabase.SaveAssets();
        string msg = $"[NzibHudBinder] OK — prefabs avatar+button, frame + 3 icons, specials {specials}/10, class BGs {nBg}/10, HP states 4/4, glow + pop mask generated" +
                     $" | order badges {nOrder}/6, class badges {nClass}/10, timer card {(skin.timerCardPrefab != null ? "✓" : "—")} states {nTimer}/4, settings {(skin.settingsNormal != null && skin.settingsPressed != null ? "✓" : "—")}, status badges {nStatus}/5";
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

    /// <summary>His hex frame with its hollow interior filled: `fill`, and a 1 px `rim` just inside the frame.</summary>
    private static Texture2D FilledFrame(Sprite frame, Color fill, Color rim)
    {
        var src = SlicePixels(frame);
        int w = src.GetLength(0), h = src.GetLength(1);
        // Interior = transparent pixels reachable from the centre without crossing the frame.
        var inside = new bool[w, h];
        var stack = new System.Collections.Generic.Stack<Vector2Int>();
        stack.Push(new Vector2Int(w / 2, h / 2));
        while (stack.Count > 0)
        {
            var q = stack.Pop();
            if (q.x < 0 || q.y < 0 || q.x >= w || q.y >= h || inside[q.x, q.y] || src[q.x, q.y].a > 0.1f) continue;
            inside[q.x, q.y] = true;
            stack.Push(new Vector2Int(q.x + 1, q.y)); stack.Push(new Vector2Int(q.x - 1, q.y));
            stack.Push(new Vector2Int(q.x, q.y + 1)); stack.Push(new Vector2Int(q.x, q.y - 1));
        }
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        for (int x = 0; x < w; x++)
            for (int y = 0; y < h; y++)
            {
                if (!inside[x, y]) { tex.SetPixel(x, y, src[x, y]); continue; }
                bool edge = false;
                for (int dx = -1; dx <= 1 && !edge; dx++)
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        int nx = x + dx, ny = y + dy;
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !inside[nx, ny]) { edge = true; break; }
                    }
                tex.SetPixel(x, y, edge ? rim : fill);
            }
        tex.Apply();
        return tex;
    }

    /// <summary>A 15×17 pointy-top hex: near-black outline, light rim top-left, dark rim bottom-right, slate fill.</summary>
    private static Texture2D OrderHex()
    {
        const int w = 15, h = 17;
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        Color outline = new Color32(0x0e, 0x0e, 0x0e, 0xff), light = new Color32(0xbf, 0xe6, 0xee, 0xff),
              dark = new Color32(0x5a, 0x76, 0x88, 0xff), fill = new Color32(0x1b, 0x27, 0x33, 0xff);
        float cx = (w - 1) / 2f, cy = (h - 1) / 2f;
        // Pointy-top hex test in pixel space.
        bool In(float x, float y, float r) { float dx = Mathf.Abs(x - cx), dy = Mathf.Abs(y - cy); return dx <= r * 0.866f && dy <= r - dx * 0.577f; }
        for (int x = 0; x < w; x++)
            for (int y = 0; y < h; y++)
            {
                Color c = Color.clear;
                if (In(x, y, 8.4f))
                {
                    if (!In(x, y, 7.3f)) c = outline;
                    else if (!In(x, y, 6.2f)) c = y >= cy ? light : dark;   // lit from above, like his frame
                    else c = fill;
                }
                tex.SetPixel(x, y, c);
            }
        tex.Apply();
        return tex;
    }

    /// <summary>The frame plus PopMargin on every side; alpha 1 except inside the portrait aperture.</summary>
    private static Texture2D PopMask()
    {
        int w = FrameW + PopMargin * 2, h = FrameH + PopMargin * 2;
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        float cx = PopMargin + ApertureX, cy = PopMargin + ApertureY;
        for (int x = 0; x < w; x++)
            for (int y = 0; y < h; y++)
            {
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(cx, cy));
                tex.SetPixel(x, y, d >= ApertureR ? Color.white : Color.clear);
            }
        tex.Apply();
        return tex;
    }

}
