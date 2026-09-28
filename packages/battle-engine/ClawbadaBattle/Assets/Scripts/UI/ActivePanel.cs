using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Round avatar of the acting lobster, bottom-left (Nzib, 2026-09-27): a STILL portrait rendered from its own rig
/// ONCE at battle load (PortraitSnapshot — how it looks on the board at rest, its own DNA-mixed parts, Idle's first frame)
/// masked by its class-coloured disc, under his silver ring. Framed like his mock: zoomed on the FRONT half (shell,
/// claws, eyes — the tail and back legs fall outside the disc), and the claws and antennae BREAK OUT over the ring
/// and the gauges (a second render of just those, masked to everything outside the disc). Side view, like the rigs;
/// a true front view is post-beta polish (needs a front part set). Outside the
/// ring, as in his mock, two framed gauges: HP on the LEFT (green, yellow when hurt, red when critical) and
/// Special charge on the RIGHT in blue. No HP numbers: humans read the gauges, agents get exact numbers from the
/// API. The gauges are generated placeholders (NzibHudBinder) until his gauge art and class-icon badge land. Statuses and the
/// defending shield sit in a small row above the ring.
/// A second instance on the right (<c>rightSide</c>, above the clock) is the TARGET avatar: the lobster the
/// player has selected but not yet confirmed.
/// </summary>
public class ActivePanel : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }
    /// <summary>The class whose disc is showing (tests / harness).</summary>
    public int ShownClass { get; private set; } = -1;

    /// <summary>The ring's size: Nzib's 80 px frame at the canvas's 1.5 units per art pixel.</summary>
    public static float Size(HudSkin skin) => (skin.avatarFrame != null ? skin.avatarFrame.rect.width : 80f) * ActionBar.ArtScale;

    /// <summary>Gap from the screen edge: the gauges stand ~7.5 units outside the ring.</summary>
    public const float Margin = 16f;
    /// <summary>How far the gauges reach past the ring's 80 px cell, in canvas units (for the button row's spacing).</summary>
    public const float GaugeOverhang = 7.5f;
    // Must match NzibHudBinder's generated gauge art (96 px cell, 130° arcs, 2.2° end caps).
    private const float GaugeCell = 96f, GaugeSpanDeg = 130f, GaugeCapDeg = 2.2f;
    private static float FillSpan => (GaugeSpanDeg - GaugeCapDeg) / 360f;
    /// <summary>Portrait zoom over the board's pixel scale (1 = a lobster pixel is a ring pixel, as Nzib draws).
    /// 1.75: the front half fills the disc and the claws break out (user 2026-09-27: "zoom in a bit more", then
    /// "just a touch more").</summary>
    public const float PortraitZoom = 1.75f;
    /// <summary>Drop the body this share of the view below centre, so the antennae have room to break out on top.</summary>
    public const float PortraitDrop = 0.06f;

    private HudSkin skin;
    private LobsterPartLibrary partLibrary;
    private Image disc;
    private RawImage portrait, portraitPop;
    private PortraitSnapshot portraits;
    private Image hpFill, chargeFill;
    private RectTransform statusRow;
    private readonly List<Image> statusIcons = new();
    private float iconSize;

    /// <summary>The camera frame the portraits are taken in: the whole gauge cell at PortraitZoom × the ring's pixels.</summary>
    public static int PortraitPixels => Mathf.RoundToInt(GaugeCell / PortraitZoom / 2f) * 2;

    public static ActivePanel Create(Transform parent, HudSkin skin, LobsterPartLibrary partLibrary, PortraitSnapshot portraits, bool rightSide = false, float bottom = 8f)
    {
        float size = Size(skin);
        var corner = rightSide ? new Vector2(1f, 0f) : Vector2.zero;
        var rt = HudFactory.Rect(parent, rightSide ? "TargetPanel" : "ActivePanel", corner, corner, corner, new Vector2(rightSide ? -Margin : Margin, bottom), new Vector2(size, size));
        var p = rt.gameObject.AddComponent<ActivePanel>();
        p.Rect = rt;
        p.skin = skin;
        p.partLibrary = partLibrary;

        // Class disc = the portrait's circle mask (Nzib's discs are 60 px circles inside the ring's 80 px cell).
        var discRt = HudFactory.Stretch(rt, "Disc");
        p.disc = HudFactory.AddImage(discRt, skin.AvatarBg(0) != null ? skin.AvatarBg(0) : skin.pip, skin.AvatarBg(0) != null ? Color.white : skin.cardInner);
        if (skin.AvatarBg(0) == null) { discRt.offsetMin = Vector2.one * size * 0.125f; discRt.offsetMax = -Vector2.one * size * 0.125f; }
        discRt.gameObject.AddComponent<Mask>().showMaskGraphic = true;

        // The snapshot covers the whole gauge cell (so the break-out has room), at PortraitZoom × the ring's pixels.
        float cell = GaugeCell * (size / 80f);
        p.portraits = portraits;
        p.portrait = Raw(discRt, "Portrait", null, cell);

        if (skin.avatarFrame != null) HudFactory.AddImage(HudFactory.Stretch(rt, "Frame"), skin.avatarFrame, Color.white);
        else HudFactory.AddImage(HudFactory.Stretch(rt, "Frame"), skin.ring, skin.fieldBarRim);

        // Gauges outside the ring: the frames, then radial fills from each arc's lower end — HP climbs the left
        // side (clockwise from the bottom), charge the right (counter-clockwise).
        float gaugeCell = GaugeCell * ActionBar.ArtScale * (size / (80f * ActionBar.ArtScale));
        if (skin.avatarGaugeTrack != null) HudFactory.Image(rt, "GaugeFrames", skin.avatarGaugeTrack, Color.white, new Vector2(gaugeCell, gaugeCell));
        var fill = skin.avatarArc != null ? skin.avatarArc : skin.ring;
        p.hpFill = Arc(rt, "Hp", fill, gaugeCell, clockwise: true, Color.white);
        p.chargeFill = Arc(rt, "Charge", fill, gaugeCell, clockwise: false, skin.chargeArc);

        // Break-out layer over the ring AND the gauges (user 2026-09-27: the bars sit underneath the lobster): the
        // claws and antennae again, visible only outside the disc.
        if (skin.avatarPopMask != null)
        {
            var pop = HudFactory.Image(rt, "BreakOut", skin.avatarPopMask, Color.white, new Vector2(cell, cell));
            pop.gameObject.AddComponent<Mask>().showMaskGraphic = false;
            p.portraitPop = Raw(pop.transform, "Portrait", null, cell);
        }

        p.iconSize = 18f;
        p.statusRow = HudFactory.Rect(rt, "Statuses", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0f, 0f), new Vector2(rightSide ? 0f : 4f, 0f), new Vector2(p.iconSize * 4f + 3f, p.iconSize));

        rt.gameObject.SetActive(false);
        return p;
    }

    private static RawImage Raw(Transform parent, string name, Texture tex, float size)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, new Vector2(size, size));
        var raw = rt.gameObject.AddComponent<RawImage>();
        raw.texture = tex;
        raw.raycastTarget = false;
        return raw;
    }

    private static Image Arc(RectTransform parent, string name, Sprite sprite, float size, bool clockwise, Color color)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, new Vector2(size, size));
        // Each arc is centred on 9 / 3 o'clock, so its lower end (inside the cap) is this far round from the bottom.
        float start = 90f - (GaugeSpanDeg - GaugeCapDeg) / 2f;
        rt.localRotation = Quaternion.Euler(0f, 0f, clockwise ? -start : start);
        var img = HudFactory.AddImage(rt, sprite, color);
        img.type = Image.Type.Filled;
        img.fillMethod = Image.FillMethod.Radial360;
        img.fillOrigin = (int)Image.Origin360.Bottom;
        img.fillClockwise = clockwise;
        img.fillAmount = 0f;
        return img;
    }

    public void Show(LobsterController lob, bool isPlayer)
    {
        Lobster = lob;
        if (lob == null) { Hide(); return; }
        gameObject.SetActive(true);
        var bg = skin.AvatarBg(lob.classId);
        if (bg != null) disc.sprite = bg;
        ShownClass = lob.classId;

        var pic = portraits?.Get(lob, PortraitDrop);   // taken once at battle load; this only looks it up
        portrait.texture = pic?.Full;
        portrait.enabled = pic != null;
        if (portraitPop != null) { portraitPop.texture = pic?.Pop; portraitPop.enabled = pic != null; }
        Refresh();
    }

    public void Hide()
    {
        Lobster = null;
        gameObject.SetActive(false);
    }

    /// <summary>Full = green, hurt = yellow, critical = red (Nzib).</summary>
    private Color HpColor(float pct) => pct > 0.5f ? skin.hpGaugeFull : pct > 0.25f ? skin.hpMid : skin.hpLow;

    public void Refresh()
    {
        var lob = Lobster;
        if (lob == null || !gameObject.activeSelf) return;
        float span = FillSpan;
        float pct = lob.alive && lob.maxHp > 0 ? Mathf.Clamp01((float)lob.currentHp / lob.maxHp) : 0f;
        hpFill.fillAmount = span * pct;
        hpFill.color = HpColor(pct);
        chargeFill.fillAmount = lob.alive ? span * Mathf.Clamp01(lob.charge / 3f) : 0f;
        var tint = lob.alive ? Color.white : new Color(0.45f, 0.45f, 0.45f, 0.9f);
        portrait.color = tint;
        if (portraitPop != null) portraitPop.color = tint;

        // Status row: the defending shield first, then up to three statuses.
        var sprites = new List<Sprite>(4);
        if (lob.alive && lob.defending && skin.iconShield != null) sprites.Add(skin.iconShield);
        if (lob.alive && lob.statuses != null)
            foreach (var st in lob.statuses)
            {
                if (sprites.Count >= 4) break;
                var sp = skin.StatusSprite(st.type);
                if (sp != null) sprites.Add(sp);
            }
        while (statusIcons.Count < sprites.Count)
        {
            var img = HudFactory.Image(statusRow, "Status", null, Color.white, new Vector2(iconSize, iconSize));
            img.rectTransform.anchorMin = img.rectTransform.anchorMax = Vector2.zero;
            img.rectTransform.pivot = Vector2.zero;
            statusIcons.Add(img);
        }
        for (int i = 0; i < statusIcons.Count; i++)
        {
            bool on = i < sprites.Count;
            statusIcons[i].enabled = on;
            if (!on) continue;
            statusIcons[i].sprite = sprites[i];
            statusIcons[i].rectTransform.anchoredPosition = new Vector2(i * (iconSize + 1f), 0f);
        }
    }
}
