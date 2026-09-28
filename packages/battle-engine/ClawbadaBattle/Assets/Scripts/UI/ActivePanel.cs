using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Round avatar of the acting lobster, bottom-left (Nzib, 2026-09-27): a live mirror of its rig's body parts (its
/// own DNA-mixed parts, its idle animation) masked by its class-coloured disc, under his silver ring. Framed like his
/// mock: zoomed on the FRONT half (shell, claws, eyes — the tail and back legs fall outside the disc), and the claws
/// and antennae BREAK OUT over the ring (a second copy of them masked to everything outside the disc). Side view,
/// like the rigs; a true front view is post-beta polish (needs a front part set). Outside the
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
    /// <summary>Share of the disc the front half (shell + claws + eyes) fills across its wider side.</summary>
    private const float PortraitFill = 1.4f;
    /// <summary>Drop the body this share of the disc below centre, so the antennae have room to break out on top.</summary>
    private const float PortraitDrop = 0.14f;

    private HudSkin skin;
    private LobsterPartLibrary partLibrary;
    private Image disc;
    private RectTransform parts, popParts;
    private float discSize;
    /// <summary>Each mirrored rig part, its image in the disc, and (claws/antennae) its break-out copy over the ring.</summary>
    private readonly List<(SpriteRenderer sr, Image img, Image pop)> mirror = new();
    private Vector3 fitCenter;
    private float fitScale;
    private Image hpFill, chargeFill;
    private RectTransform statusRow;
    private readonly List<Image> statusIcons = new();
    private float iconSize;

    public static ActivePanel Create(Transform parent, HudSkin skin, LobsterPartLibrary partLibrary, bool rightSide = false, float bottom = 8f)
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

        p.discSize = size * 0.75f;
        p.parts = HudFactory.Rect(discRt, "Parts", HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, Vector2.zero);

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
        float cell = GaugeCell * (size / 80f);
        if (skin.avatarPopMask != null)
        {
            var pop = HudFactory.Image(rt, "BreakOut", skin.avatarPopMask, Color.white, new Vector2(cell, cell));
            pop.gameObject.AddComponent<Mask>().showMaskGraphic = false;
            p.popParts = HudFactory.Rect(pop.transform, "Parts", HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, Vector2.zero);
        }

        p.iconSize = 18f;
        p.statusRow = HudFactory.Rect(rt, "Statuses", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0f, 0f), new Vector2(rightSide ? 0f : 4f, 0f), new Vector2(p.iconSize * 4f + 3f, p.iconSize));

        rt.gameObject.SetActive(false);
        return p;
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

        BuildMirror(lob);
        Refresh();
    }

    /// <summary>One Image per body-part renderer, stacked in the rig's draw order; the fit comes from the parts'
    /// bounds now, so the live mirror never breathes in and out with the animation.</summary>
    private void BuildMirror(LobsterController lob)
    {
        foreach (var m in mirror) { if (m.img != null) Destroy(m.img.gameObject); if (m.pop != null) Destroy(m.pop.gameObject); }
        mirror.Clear();
        var srs = new List<SpriteRenderer>();
        foreach (var sr in lob.GetComponentsInChildren<SpriteRenderer>(true))
            if (sr.sprite != null && LobsterController.IsBodyPart(sr.gameObject.name)) srs.Add(sr);
        srs.Sort((a, b) => a.sortingLayerID != b.sortingLayerID
            ? SortingLayer.GetLayerValueFromID(a.sortingLayerID).CompareTo(SortingLayer.GetLayerValueFromID(b.sortingLayerID))
            : a.sortingOrder.CompareTo(b.sortingOrder));
        if (srs.Count == 0) return;

        // Fit to the PAINTED pixels of the front half: every part is a full 64 px layer, so renderer bounds are
        // mostly padding; the sprites import with tight meshes, whose vertices hug the art. The tail, legs and
        // antennae are left out of the fit — the first two crop away, the antennae break out on top.
        bool any = false;
        var bounds = new Bounds();
        foreach (var sr in srs)
        {
            if (!sr.enabled || !sr.gameObject.activeInHierarchy || !FrontHalf(sr.gameObject.name)) continue;
            var m = sr.transform.localToWorldMatrix;
            foreach (var v in sr.sprite.vertices)
            {
                var w = m.MultiplyPoint3x4(v);
                if (!any) { bounds = new Bounds(w, Vector3.zero); any = true; } else bounds.Encapsulate(w);
            }
        }
        if (!any) { bounds = srs[0].bounds; foreach (var sr in srs) bounds.Encapsulate(sr.bounds); }
        fitScale = discSize * PortraitFill / Mathf.Max(bounds.size.x, bounds.size.y, 0.01f);   // canvas units per world unit
        fitCenter = bounds.center - lob.transform.position + new Vector3(0f, discSize * PortraitDrop / fitScale, 0f);

        foreach (var sr in srs)
        {
            var img = HudFactory.Image(parts, sr.gameObject.name, sr.sprite, Color.white, Vector2.zero);
            Image pop = popParts != null && BreaksOut(sr.gameObject.name) ? HudFactory.Image(popParts, sr.gameObject.name, sr.sprite, Color.white, Vector2.zero) : null;
            mirror.Add((sr, img, pop));
        }
        Debug.Log($"[BattleHud] avatar {lob.lobsterId} mirrors {mirror.Count} parts, {bounds.size.x:F2}x{bounds.size.y:F2}u at {fitScale:F0}/u");
    }

    private static bool FrontHalf(string part) =>
        part == "Carapace" || part == "Eyes" || part.StartsWith("Claw_") || part.StartsWith("UpperArm_");

    private static bool BreaksOut(string part) =>
        part == "Antennae" || part.StartsWith("Claw_") || part.StartsWith("UpperArm_");

    /// <summary>Copy each part's sprite, pose and colour from the rig (world-space, so facing comes along).</summary>
    private void SyncMirror(LobsterController lob, Color tint)
    {
        var root = lob.transform.position;
        foreach (var (sr, img, pop) in mirror)
        {
            if (sr == null || img == null) continue;
            Pose(sr, img, root, tint);
            if (pop != null) Pose(sr, pop, root, tint);
        }
    }

    private void Pose(SpriteRenderer sr, Image img, Vector3 root, Color tint)
    {
        bool on = sr.enabled && sr.gameObject.activeInHierarchy && sr.sprite != null;
        img.enabled = on;
        if (!on) return;
        var sp = sr.sprite;
        if (img.sprite != sp) img.sprite = sp;
        var rt = img.rectTransform;
        rt.sizeDelta = sp.rect.size / sp.pixelsPerUnit * fitScale;
        rt.pivot = new Vector2(sp.pivot.x / sp.rect.width, sp.pivot.y / sp.rect.height);
        var d = sr.transform.position - root - fitCenter;
        rt.anchoredPosition = new Vector2(d.x, d.y) * fitScale;
        rt.localRotation = Quaternion.Euler(0f, 0f, sr.transform.eulerAngles.z);
        var ls = sr.transform.lossyScale;
        rt.localScale = new Vector3(ls.x * (sr.flipX ? -1f : 1f), ls.y * (sr.flipY ? -1f : 1f), 1f);
        img.color = sr.color * tint;
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
        SyncMirror(lob, tint);

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
