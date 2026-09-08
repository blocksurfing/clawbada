using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Bottom-left box for the acting lobster: card on top, class name, tier/team, HP
/// numbers and charge pips stacked below (124x136). Narrow so it never covers the
/// board's bottom-left hex. The shot clock is BattleHud.Clock (bottom-right).
/// </summary>
public class ActivePanel : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }

    private HudSkin skin;
    private LobsterPartLibrary partLibrary;
    private CardView card;
    private Text nameText;
    private Text subText;
    private Text hpText;
    private Image[] pips;

    public static ActivePanel Create(Transform parent, HudSkin skin, LobsterPartLibrary partLibrary)
    {
        // Narrow vertical box: the board's bottom-left hex begins ~170 px from the left edge
        // at 1020x574, so anything wider than ~150 reference px overlaps it. Card on top,
        // name / tier / HP / pips stacked underneath.
        var rt = HudFactory.Rect(parent, "ActivePanel", Vector2.zero, Vector2.zero, Vector2.zero, new Vector2(8f, 8f), new Vector2(124f, 136f));
        var p = rt.gameObject.AddComponent<ActivePanel>();
        p.Rect = rt;
        p.skin = skin;
        p.partLibrary = partLibrary;
        HudFactory.AddImage(rt, skin.panelBg, new Color(1f, 1f, 1f, 0.92f));

        float pw = 56f;
        var cardSize = new Vector2(pw, pw * skin.cardSize.y / skin.cardSize.x);
        p.card = CardView.Create(rt, "Card", skin, cardSize, skin.hpSegments);
        p.card.Rect.anchorMin = p.card.Rect.anchorMax = new Vector2(0.5f, 1f);
        p.card.Rect.pivot = new Vector2(0.5f, 1f);
        p.card.Rect.anchoredPosition = new Vector2(0f, -7f);

        var font = skin.FontOrDefault();
        float top = -(7f + cardSize.y + 4f);
        p.nameText = HudFactory.Text(rt, "Name", font, 13, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(116f, 18f));
        p.nameText.rectTransform.anchorMin = p.nameText.rectTransform.anchorMax = new Vector2(0.5f, 1f);
        p.nameText.rectTransform.pivot = new Vector2(0.5f, 1f);
        p.nameText.rectTransform.anchoredPosition = new Vector2(0f, top);

        p.subText = HudFactory.Text(rt, "Sub", font, 9, skin.textSecondary, TextAnchor.MiddleCenter, new Vector2(116f, 12f));
        p.subText.rectTransform.anchorMin = p.subText.rectTransform.anchorMax = new Vector2(0.5f, 1f);
        p.subText.rectTransform.pivot = new Vector2(0.5f, 1f);
        p.subText.rectTransform.anchoredPosition = new Vector2(0f, top - 17f);

        p.hpText = HudFactory.Text(rt, "HpText", font, 11, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(116f, 14f));
        p.hpText.rectTransform.anchorMin = p.hpText.rectTransform.anchorMax = new Vector2(0.5f, 1f);
        p.hpText.rectTransform.pivot = new Vector2(0.5f, 1f);
        p.hpText.rectTransform.anchoredPosition = new Vector2(0f, top - 30f);

        p.pips = new Image[3];
        for (int i = 0; i < 3; i++)
        {
            var pip = HudFactory.Image(rt, $"Pip{i}", skin.pip, skin.gold, new Vector2(8f, 8f));
            pip.rectTransform.anchorMin = pip.rectTransform.anchorMax = new Vector2(0.5f, 1f);
            pip.rectTransform.pivot = new Vector2(0.5f, 1f);
            pip.rectTransform.anchoredPosition = new Vector2((i - 1) * 12f, top - 46f);
            p.pips[i] = pip;
        }

        rt.gameObject.SetActive(false);
        return p;
    }

    public void Show(LobsterController lob, bool isPlayer)
    {
        Lobster = lob;
        if (lob == null) { Hide(); return; }
        gameObject.SetActive(true);
        card.Bind(lob, partLibrary);
        card.SetActive(isPlayer, scale: false, showPennant: false);
        nameText.text = string.IsNullOrEmpty(lob.className) ? LobsterClasses.Name(lob.classId) : lob.className;
        nameText.color = skin.TeamColor(lob.side);
        subText.text = $"{LobsterClasses.TierName(lob.tier)} · {lob.side}{(isPlayer ? " · you" : "")}";
        Refresh();
    }

    public void Hide()
    {
        Lobster = null;
        gameObject.SetActive(false);
    }

    public void Refresh()
    {
        var lob = Lobster;
        if (lob == null || !gameObject.activeSelf) return;
        card.Refresh();
        hpText.text = lob.alive ? $"HP {lob.currentHp} / {lob.maxHp}" : "KO";
        hpText.color = skin.HpColor(lob.currentHp, lob.maxHp);
        for (int i = 0; i < pips.Length; i++) pips[i].color = i < lob.charge ? skin.gold : new Color(1f, 1f, 1f, 0.25f);
    }
}
