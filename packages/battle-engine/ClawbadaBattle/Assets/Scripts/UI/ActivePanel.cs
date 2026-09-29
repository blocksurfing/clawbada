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
/// A second instance on the right (<c>rightSide</c>, above the clock) is the TARGET avatar: the lobster the player has
/// selected but not yet confirmed. Selected outline (user 2026-09-28, "both"): on the left while it is your turn,
/// on the right whenever it shows. Class icon and Nzib's status icons are still being designed; statuses use the
/// current icon row above the panel until then.
/// </summary>
public class ActivePanel : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }
    /// <summary>The class whose background is showing (tests / harness).</summary>
    public int ShownClass { get; private set; } = -1;
    public bool Selected { get; private set; }

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
    private bool rightSide;
    private Image classBg, hpFill, mpFill;
    private GameObject outline;
    private RawImage portrait, portraitPop;
    private RectTransform statusRow;
    private readonly List<Image> statusIcons = new();
    private const float IconSize = 18f;

    public static ActivePanel Create(Transform parent, HudSkin skin, LobsterPartLibrary partLibrary, PortraitSnapshot portraits, bool rightSide = false, float bottom = 8f)
    {
        var corner = rightSide ? new Vector2(1f, 0f) : Vector2.zero;
        var rt = HudFactory.Rect(parent, rightSide ? "TargetPanel" : "ActivePanel", corner, corner, corner,
            new Vector2(rightSide ? -Margin : Margin, bottom), new Vector2(Width, Height));
        var p = rt.gameObject.AddComponent<ActivePanel>();
        p.Rect = rt;
        p.skin = skin;
        p.portraits = portraits;
        p.rightSide = rightSide;
        p.statusRow = HudFactory.Rect(rt, "Statuses", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0f, 0f), new Vector2(4f, 2f),
            new Vector2(IconSize * 4f + 3f, IconSize));

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
        p.outline = ui.Find("SelectedOutline")?.gameObject;
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

    /// <param name="isPlayer">The player's own turn: the acting avatar shows the selected outline.</param>
    public void Show(LobsterController lob, bool isPlayer)
    {
        Lobster = lob;
        if (lob == null) { Hide(); return; }
        gameObject.SetActive(true);
        var bg = skin.AvatarBg(lob.classId);
        if (bg != null && classBg != null) classBg.sprite = bg;
        ShownClass = lob.classId;

        var pic = portraits?.Get(lob, PortraitDrop);   // taken once at battle load; this only looks it up
        if (portrait != null) { portrait.texture = pic?.Full; portrait.enabled = pic != null; }
        if (portraitPop != null) { portraitPop.texture = pic?.Pop; portraitPop.enabled = pic != null; }
        SetSelected(rightSide || isPlayer);
        Refresh();
    }

    public void SetSelected(bool on)
    {
        Selected = on;
        // Re-activating restarts his outline animation from its first frame.
        if (outline != null && outline.activeSelf != on) outline.SetActive(on);
    }

    public void Hide()
    {
        Lobster = null;
        SetSelected(false);
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
            statusIcons[i].rectTransform.anchoredPosition = new Vector2(i * (IconSize + 1f), 0f);
        }
    }
}
