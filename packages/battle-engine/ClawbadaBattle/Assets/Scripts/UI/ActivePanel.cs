using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Round avatar of the acting lobster, bottom-left (Nzib, 2026-09-27): its portrait (composited from its own
/// Carapace/Antennae/Eyes, like the cards) masked by its class-coloured disc, under his silver ring. Health is
/// the ring's LEFT arc — green, yellow when hurt, red when critical — and Special charge the RIGHT arc in blue.
/// No HP numbers: humans read the arcs, agents get exact numbers from the API. The arcs are placeholders on
/// the ring until Nzib's arc art lands (and his class-icon badge for the top-right). Statuses and the
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

    /// <summary>Each arc spans the half-ring less this many degrees at each end, so HP and charge read apart.</summary>
    private const float ArcGapDeg = 9f;
    private const float PortraitScale = 3f;   // 2 screen art px per part px — the disc shows head and shoulders

    private HudSkin skin;
    private LobsterPartLibrary partLibrary;
    private Image disc;
    private RectTransform parts;
    private Image carapace, antennae, eyes;
    private Image hpFill, chargeFill;
    private RectTransform statusRow;
    private readonly List<Image> statusIcons = new();
    private float iconSize;

    public static ActivePanel Create(Transform parent, HudSkin skin, LobsterPartLibrary partLibrary, bool rightSide = false, float bottom = 8f)
    {
        float size = Size(skin);
        var corner = rightSide ? new Vector2(1f, 0f) : Vector2.zero;
        var rt = HudFactory.Rect(parent, rightSide ? "TargetPanel" : "ActivePanel", corner, corner, corner, new Vector2(rightSide ? -8f : 8f, bottom), new Vector2(size, size));
        var p = rt.gameObject.AddComponent<ActivePanel>();
        p.Rect = rt;
        p.skin = skin;
        p.partLibrary = partLibrary;

        // Class disc = the portrait's circle mask (Nzib's discs are 60 px circles inside the ring's 80 px cell).
        var discRt = HudFactory.Stretch(rt, "Disc");
        p.disc = HudFactory.AddImage(discRt, skin.AvatarBg(0) != null ? skin.AvatarBg(0) : skin.pip, skin.AvatarBg(0) != null ? Color.white : skin.cardInner);
        if (skin.AvatarBg(0) == null) { discRt.offsetMin = Vector2.one * size * 0.125f; discRt.offsetMax = -Vector2.one * size * 0.125f; }
        discRt.gameObject.AddComponent<Mask>().showMaskGraphic = true;

        float discSize = size * 0.75f;
        p.parts = HudFactory.Rect(discRt, "Parts", HudFactory.Center, HudFactory.Center, HudFactory.Center, skin.portraitPartOffset * (discSize / 64f), new Vector2(64f, 64f));
        p.carapace = HudFactory.Image(p.parts, "Carapace", null, Color.white, new Vector2(64f, 64f));
        p.antennae = HudFactory.Image(p.parts, "Antennae", null, Color.white, new Vector2(64f, 64f));
        p.eyes = HudFactory.Image(p.parts, "Eyes", null, Color.white, new Vector2(64f, 64f));
        p.carapace.enabled = p.antennae.enabled = p.eyes.enabled = false;   // until Show binds a lobster

        if (skin.avatarFrame != null) HudFactory.AddImage(HudFactory.Stretch(rt, "Frame"), skin.avatarFrame, Color.white);
        else HudFactory.AddImage(HudFactory.Stretch(rt, "Frame"), skin.ring, skin.fieldBarRim);

        // Arcs on the ring. Radial fill from the bottom: HP climbs the left side (clockwise), charge the right.
        var arc = skin.avatarArc != null ? skin.avatarArc : skin.ring;
        Arc(rt, "HpTrack", arc, clockwise: true, new Color(0f, 0f, 0f, 0.55f)).fillAmount = (180f - 2f * ArcGapDeg) / 360f;
        p.hpFill = Arc(rt, "Hp", arc, clockwise: true, Color.white);
        Arc(rt, "ChargeTrack", arc, clockwise: false, new Color(0f, 0f, 0f, 0.55f)).fillAmount = (180f - 2f * ArcGapDeg) / 360f;
        p.chargeFill = Arc(rt, "Charge", arc, clockwise: false, skin.chargeArc);

        p.iconSize = 18f;
        p.statusRow = HudFactory.Rect(rt, "Statuses", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0f, 0f), new Vector2(rightSide ? 0f : 4f, 0f), new Vector2(p.iconSize * 4f + 3f, p.iconSize));

        rt.gameObject.SetActive(false);
        return p;
    }

    private static Image Arc(RectTransform parent, string name, Sprite sprite, bool clockwise, Color color)
    {
        var rt = HudFactory.Stretch(parent, name);
        // Start ArcGapDeg past the bottom, in the direction of travel.
        rt.localRotation = Quaternion.Euler(0f, 0f, clockwise ? -ArcGapDeg : ArcGapDeg);
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

        int[] ids = lob.partClassIds;
        bool dna = ids != null && ids.Length == 6;
        Assign(carapace, lob.tier, dna ? ids[0] : lob.classId, "Carapace", lob.className);
        Assign(antennae, lob.tier, dna ? ids[3] : lob.classId, "Antennae", lob.className);
        Assign(eyes, lob.tier, dna ? ids[4] : lob.classId, "Eyes", lob.className);
        parts.localScale = new Vector3(lob.side == "A" ? -PortraitScale : PortraitScale, PortraitScale, 1f);
        Refresh();
    }

    private void Assign(Image img, int tier, int classId, string part, string hostClass)
    {
        Sprite sprite = null;
        if (partLibrary != null)
        {
            sprite = partLibrary.Get(tier, LobsterClasses.Name(classId), part);
            if (sprite == null) sprite = partLibrary.Get(tier, hostClass, part);
        }
        img.sprite = sprite;
        img.enabled = sprite != null;
        if (sprite != null) img.SetNativeSize();
    }

    public void Hide()
    {
        Lobster = null;
        gameObject.SetActive(false);
    }

    /// <summary>Full = green, hurt = yellow, critical = red (Nzib).</summary>
    private Color HpColor(float pct) => pct > 0.5f ? skin.fieldBarFriend : pct > 0.25f ? skin.hpMid : skin.hpLow;

    public void Refresh()
    {
        var lob = Lobster;
        if (lob == null || !gameObject.activeSelf) return;
        float span = (180f - 2f * ArcGapDeg) / 360f;
        float pct = lob.alive && lob.maxHp > 0 ? Mathf.Clamp01((float)lob.currentHp / lob.maxHp) : 0f;
        hpFill.fillAmount = span * pct;
        hpFill.color = HpColor(pct);
        chargeFill.fillAmount = lob.alive ? span * Mathf.Clamp01(lob.charge / 3f) : 0f;
        var tint = lob.alive ? Color.white : new Color(0.45f, 0.45f, 0.45f, 0.9f);
        carapace.color = tint; antennae.color = tint; eyes.color = tint;

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
