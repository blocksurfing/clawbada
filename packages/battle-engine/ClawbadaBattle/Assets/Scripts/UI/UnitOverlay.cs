using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Per-lobster overlay on the screen-space canvas: HP bar, three charge pips, a
/// shield when defending, one icon per status, a skull when KO, and a gold ring
/// while it is the acting unit. Lives under the HUD's "Overlays" layer (never under
/// the rig) and is positioned every LateUpdate by BattleHud.
/// </summary>
public class UnitOverlay : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }

    private HudSkin skin;
    private HpBar bar;
    private readonly List<Image> pips = new();
    private Image shield;
    private Image ko;
    private Image ring;
    private RectTransform statusRow;
    private readonly List<Image> statusIcons = new();

    public static UnitOverlay Create(Transform parent, HudSkin skin)
    {
        var rt = HudFactory.Rect(parent, "UnitOverlay", HudFactory.Center, HudFactory.Center, new Vector2(0.5f, 0f), Vector2.zero, new Vector2(60f, 36f));
        var o = rt.gameObject.AddComponent<UnitOverlay>();
        o.Rect = rt;
        o.skin = skin;

        o.ring = HudFactory.Image(rt, "Ring", skin.ring, skin.activeRing, new Vector2(44f, 44f));
        o.ring.rectTransform.anchoredPosition = new Vector2(0f, -46f);
        o.ring.enabled = false;

        o.bar = HpBar.Create(rt, "Hp", skin, skin.overlayBar, withLabel: false);
        o.bar.Rect.anchoredPosition = new Vector2(0f, 6f);

        for (int i = 0; i < 3; i++)
        {
            var pip = HudFactory.Image(rt, $"Pip{i}", skin.pip, skin.gold, new Vector2(5f, 5f));
            pip.rectTransform.anchoredPosition = new Vector2(-7f + i * 7f, 13f);
            o.pips.Add(pip);
        }

        o.shield = HudFactory.Image(rt, "Shield", skin.iconShield, Color.white, new Vector2(12f, 12f));
        o.shield.rectTransform.anchoredPosition = new Vector2(26f, 8f);
        o.shield.enabled = false;

        o.statusRow = HudFactory.Rect(rt, "Statuses", HudFactory.Center, HudFactory.Center, HudFactory.Center, new Vector2(0f, 22f), new Vector2(60f, 12f));

        o.ko = HudFactory.Image(rt, "Ko", skin.iconKo, new Color(1f, 1f, 1f, 0.9f), new Vector2(14f, 14f));
        o.ko.rectTransform.anchoredPosition = new Vector2(0f, 6f);
        o.ko.enabled = false;
        return o;
    }

    public void Bind(LobsterController lob)
    {
        Lobster = lob;
        Refresh();
    }

    public void SetActive(bool active)
    {
        // The world-space ActiveMarker already marks the actor; the ring only added clutter.
        ring.enabled = false;
    }

    public void Refresh()
    {
        var lob = Lobster;
        if (lob == null) { gameObject.SetActive(false); return; }
        gameObject.SetActive(true);

        bool alive = lob.alive;
        bar.gameObject.SetActive(alive);
        if (alive) bar.Set(lob.currentHp, lob.maxHp);
        ko.enabled = !alive;
        shield.enabled = alive && lob.defending;
        for (int i = 0; i < pips.Count; i++)
        {
            pips[i].enabled = alive;
            pips[i].color = i < lob.charge ? skin.gold : new Color(1f, 1f, 1f, 0.25f);
        }

        // Status icons: rebuild only when the set changes.
        var statuses = lob.statuses;
        int wanted = alive && statuses != null ? statuses.Count : 0;
        while (statusIcons.Count < wanted)
        {
            var img = HudFactory.Image(statusRow, "Status", null, Color.white, new Vector2(11f, 11f));
            statusIcons.Add(img);
        }
        for (int i = 0; i < statusIcons.Count; i++)
        {
            bool on = i < wanted;
            statusIcons[i].enabled = on;
            if (!on) continue;
            var sprite = skin.StatusSprite(statuses[i].type);
            statusIcons[i].sprite = sprite;
            statusIcons[i].enabled = sprite != null;
            statusIcons[i].rectTransform.anchoredPosition = new Vector2((i - (wanted - 1) * 0.5f) * 13f, 0f);
        }
    }
}
