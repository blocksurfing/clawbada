using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// The acting lobster's avatar, bottom-left, built on Nzib's AvatarUI prefab (drop 28c11f5, 2026-09-28): his frame,
/// the class background in the round portrait window, a curved HP bar (four colour states) and the Special-charge
/// (MP) bar, and an animated "selected" outline behind the frame. We add the portrait: a STILL render of the
/// lobster's own rig taken once at battle load (PortraitSnapshot), clipped to the window, with a second render of
/// just its claws and antennae breaking out over the frame and the bars (user: the bars sit under the lobster).
/// No HP numbers: humans read the bars, agents get exact numbers from the API.
/// One panel per lobster, all six on screen (TeamPanels, Nzib's layout 2026-09-28): his animated outline marks the
/// lobster acting now (white) and the selected-but-unconfirmed target (orange), and a small hex carries the panel's
/// place in the upcoming turn order (1 = acting now) — the same order agents read from the API. Drop 25d2fbe
/// (2026-09-30): the order number is his OrderingBadge (sprite per place, 1–6) and his ClassBadge sits right of the MP
/// bar; statuses (current icons until his land) start just right of the class badge.
/// </summary>
public class ActivePanel : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }
    /// <summary>The class whose background is showing (tests / harness).</summary>
    public int ShownClass { get; private set; } = -1;
    public enum Highlight { None, Turn, Target }
    public Highlight Mark { get; private set; }
    /// <summary>Place in the upcoming turn order (1 = acting now), 0 = none shown.</summary>
    public int Order { get; private set; }
    private static readonly Color TargetOutline = new Color(1f, 0.55f, 0.18f, 1f);

    // AvatarUI geometry in design pixels (docs/AVATAR_UI_VISUAL_HANDOFF.md): 112×64 frame; the portrait window is
    // ClassBackground, 32×32 at (-29, -2) from the centre. The portrait renders cover the frame plus PopMargin
    // on every side (NzibHudBinder.PopMargin — the pop mask is generated to the same size).
    private const float FrameW = 112f, FrameH = 64f, PopMargin = 16f;
    private static readonly Vector2 Aperture = new Vector2(-29f, -2f);
    private static float ViewW => FrameW + 2f * PopMargin;
    private static float ViewH => FrameH + 2f * PopMargin;

    /// <summary>The panel in canvas units: Nzib's design pixels at the canvas's 1.5 units per art pixel.</summary>
    public static float Width => FrameW * ActionBar.ArtScale;
    public static float Height => FrameH * ActionBar.ArtScale;
    /// <summary>Gap from the screen edge.</summary>
    public const float Margin = 12f;

    /// <summary>Portrait zoom over the board's pixel scale. 1 = a lobster pixel is a frame pixel: Nzib's grid.</summary>
    public const float PortraitZoom = 1f;
    /// <summary>Drop the body this share of the view below the window's centre, so the antennae break out on top.</summary>
    public const float PortraitDrop = 0.04f;

    /// <summary>The portrait renders for this layout: the view in world pixels, the front half on the window.</summary>
    public static PortraitSnapshot NewPortraits() =>
        new PortraitSnapshot(Mathf.RoundToInt(ViewW / PortraitZoom), Mathf.RoundToInt(ViewH / PortraitZoom), Aperture / PortraitZoom);

    private HudSkin skin;
    private PortraitSnapshot portraits;
    private Image classBg, hpFill, mpFill;
    private Image outline;
    private Image orderHex;
    private Text orderText;
    private Image orderBadge, classBadge;   // Nzib's (drop 25d2fbe); orderHex/orderText are the fallback
    private RawImage portrait, portraitPop;
    private RectTransform statusRow;
    private readonly List<Image> statusIcons = new();
    private const float IconSize = 16f;
    /// <summary>Status icons per row right of the class badge before wrapping upward (the panel ends ~20 design px on).</summary>
    private const int IconsPerRow = 2;
    private bool statusBesideBadge;

    /// <param name="corner">Anchor and pivot on the canvas (e.g. (0,0) bottom-left, (1,1) top-right).</param>
    public static ActivePanel Create(Transform parent, string name, HudSkin skin, PortraitSnapshot portraits, Vector2 corner, Vector2 pos)
    {
        var rt = HudFactory.Rect(parent, name, corner, corner, corner, pos, new Vector2(Width, Height));
        var p = rt.gameObject.AddComponent<ActivePanel>();
        p.Rect = rt;
        p.skin = skin;
        p.portraits = portraits;
        // Statuses beside the bars' tail, inside the panel (as in his mock) — above it they'd leave the canvas for the
        // top row. Design (20, -13) from the centre, scaled.
        p.statusRow = HudFactory.Rect(rt, "Statuses", HudFactory.Center, HudFactory.Center, new Vector2(0f, 0.5f),
            new Vector2(20f, -13f) * ActionBar.ArtScale, new Vector2(IconSize * 3f + 2f, IconSize));

        if (skin.avatarPrefab == null)
        {
            Debug.LogError("[BattleHud] HudSkin.avatarPrefab is not bound — run Clawbada ▸ HUD ▸ Bind Nzib HUD Art");
            rt.gameObject.SetActive(false);
            return p;
        }
        // Nzib's prefab at design scale, scaled as a unit (his handoff: "scale the parent as a unit").
        var ui = (RectTransform)Instantiate(skin.avatarPrefab, rt, false).transform;
        ui.name = "AvatarUI";
        ui.anchorMin = ui.anchorMax = ui.pivot = HudFactory.Center;
        ui.anchoredPosition = Vector2.zero;
        ui.localScale = new Vector3(ActionBar.ArtScale, ActionBar.ArtScale, 1f);
        p.outline = ui.Find("SelectedOutline")?.GetComponent<Image>();
        p.classBg = ui.Find("ClassBackground")?.GetComponent<Image>();
        p.hpFill = ui.Find("HPFill")?.GetComponent<Image>();
        p.mpFill = ui.Find("MPFill")?.GetComponent<Image>();

        // Portrait: above ClassBackground, below Frame (his handoff), clipped to the round window by using the class
        // background itself as the mask. Sized to the whole view and centred on the frame.
        if (p.classBg != null)
        {
            p.classBg.gameObject.AddComponent<Mask>().showMaskGraphic = true;
            p.portrait = Raw(p.classBg.transform, "Portrait", -Aperture);
        }
        // Break-out: the claws and antennae again, everywhere OUTSIDE the window, over the frame and the bars.
        if (skin.avatarPopMask != null)
        {
            var pop = HudFactory.Image(ui, "BreakOut", skin.avatarPopMask, Color.white, new Vector2(ViewW, ViewH));
            pop.gameObject.AddComponent<Mask>().showMaskGraphic = false;
            p.portraitPop = Raw(pop.transform, "Portrait", Vector2.zero);
        }
        // His badges: drawn over the break-out claws (they are part of the frame's read), bound per lobster.
        p.orderBadge = ui.Find("OrderingBadge")?.GetComponent<Image>();
        p.classBadge = ui.Find("ClassBadge")?.GetComponent<Image>();
        if (p.orderBadge != null) { p.orderBadge.transform.SetAsLastSibling(); p.orderBadge.gameObject.SetActive(false); }
        if (p.classBadge != null)
        {
            p.classBadge.transform.SetAsLastSibling();
            // His note: statuses must not overlap the badge. Badge = 16 px at (28, -6) → start the row just right of
            // it (design x 37), centred on it; icons wrap upward two to a row.
            var sr = p.statusRow;
            sr.pivot = new Vector2(0f, 0f);
            sr.anchoredPosition = new Vector2(37f, -6f) * ActionBar.ArtScale - new Vector2(0f, IconSize * 0.5f);
            p.statusBesideBadge = true;
        }
        // Fallback turn-order hex (placeholder) on the portrait ring's top-left (design (-44, 13)), above everything.
        if (p.orderBadge == null && skin.orderHex != null)
        {
            p.orderHex = HudFactory.Image(rt, "Order", skin.orderHex, Color.white, skin.orderHex.rect.size * ActionBar.ArtScale);
            p.orderHex.rectTransform.anchoredPosition = new Vector2(-44f, 13f) * ActionBar.ArtScale;
            p.orderText = HudFactory.Text(p.orderHex.transform, "N", skin.PixelFontOrDefault(), 16, skin.textPrimary, TextAnchor.MiddleCenter, p.orderHex.rectTransform.sizeDelta);
            p.orderText.rectTransform.anchoredPosition = new Vector2(0.5f, 0.5f);
            p.orderHex.gameObject.SetActive(false);
        }
        p.statusRow.SetAsLastSibling();
        rt.gameObject.SetActive(false);
        return p;
    }

    private static RawImage Raw(Transform parent, string name, Vector2 pos)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, pos, new Vector2(ViewW, ViewH));
        var raw = rt.gameObject.AddComponent<RawImage>();
        raw.raycastTarget = false;
        raw.enabled = false;
        return raw;
    }

    /// <summary>Bind the panel to its lobster for the battle.</summary>
    public void Show(LobsterController lob)
    {
        Lobster = lob;
        if (lob == null) { Hide(); return; }
        gameObject.SetActive(true);
        var bg = skin.AvatarBg(lob.classId);
        if (bg != null && classBg != null) classBg.sprite = bg;
        ShownClass = lob.classId;
        if (classBadge != null)
        {
            var badge = skin.ClassBadge(lob.classId);
            if (badge != null) classBadge.sprite = badge;
            classBadge.gameObject.SetActive(badge != null);
        }

        var pic = portraits?.Get(lob, PortraitDrop);   // taken once at battle load; this only looks it up
        if (portrait != null) { portrait.texture = pic?.Full; portrait.enabled = pic != null; }
        if (portraitPop != null) { portraitPop.texture = pic?.Pop; portraitPop.enabled = pic != null; }
        Refresh();
    }

    /// <summary>His animated outline: white = acting now, orange = the selected target, off otherwise.</summary>
    public void SetHighlight(Highlight h)
    {
        Mark = h;
        if (outline == null) return;
        bool on = h != Highlight.None;
        if (on) outline.color = h == Highlight.Target ? TargetOutline : Color.white;
        // Re-activating restarts his outline animation from its first frame.
        if (outline.gameObject.activeSelf != on) outline.gameObject.SetActive(on);
    }

    /// <summary>Place in the upcoming turn order (1 = acting now); 0 hides the badge.</summary>
    public void SetOrder(int n)
    {
        Order = n;
        if (orderBadge != null)
        {
            var sp = skin.OrderBadge(n);
            if (sp != null) orderBadge.sprite = sp;
            orderBadge.gameObject.SetActive(n > 0 && sp != null);
            return;
        }
        if (orderHex == null) return;
        orderHex.gameObject.SetActive(n > 0);
        if (n > 0) orderText.text = n.ToString();
    }

    public void Hide()
    {
        Lobster = null;
        SetHighlight(Highlight.None);
        SetOrder(0);
        gameObject.SetActive(false);
    }

    public void Refresh()
    {
        var lob = Lobster;
        if (lob == null || !gameObject.activeSelf) return;
        float pct = lob.alive && lob.maxHp > 0 ? Mathf.Clamp01((float)lob.currentHp / lob.maxHp) : 0f;
        if (hpFill != null)
        {
            // His contract: swap the state sprite, never reset fillAmount or scale the bar.
            var state = skin.HpStateSprite(pct);
            if (state != null && hpFill.sprite != state) hpFill.sprite = state;
            hpFill.fillAmount = pct;
        }
        if (mpFill != null) mpFill.fillAmount = lob.alive ? Mathf.Clamp01(lob.charge / 3f) : 0f;
        var tint = lob.alive ? Color.white : new Color(0.45f, 0.45f, 0.45f, 0.9f);
        if (portrait != null) portrait.color = tint;
        if (portraitPop != null) portraitPop.color = tint;

        // Status row: the defending shield first, then up to three statuses (current icons until Nzib's land).
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
            var img = HudFactory.Image(statusRow, "Status", null, Color.white, new Vector2(IconSize, IconSize));
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
            statusIcons[i].rectTransform.anchoredPosition = statusBesideBadge
                ? new Vector2(i % IconsPerRow * (IconSize + 1f), i / IconsPerRow * (IconSize + 1f))
                : new Vector2(i * (IconSize + 1f), 0f);
        }
    }
}
