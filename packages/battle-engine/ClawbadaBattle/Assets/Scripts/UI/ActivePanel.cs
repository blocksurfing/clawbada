using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Bottom-left panel for the acting lobster: large portrait, class name, tier/team,
/// HP bar with numbers, charge pips and the shot clock (players only).
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
        var rt = HudFactory.Rect(parent, "ActivePanel", Vector2.zero, Vector2.zero, Vector2.zero, new Vector2(8f, 8f), new Vector2(250f, 120f));
        var p = rt.gameObject.AddComponent<ActivePanel>();
        p.Rect = rt;
        p.skin = skin;
        p.partLibrary = partLibrary;
        HudFactory.AddImage(rt, skin.panelBg, new Color(1f, 1f, 1f, 0.92f));

        float pw = skin.activePortrait;
        var cardSize = new Vector2(pw, pw * skin.cardSize.y / skin.cardSize.x);
        p.card = CardView.Create(rt, "Card", skin, cardSize, skin.hpSegments);
        p.card.Rect.anchorMin = p.card.Rect.anchorMax = new Vector2(0f, 0.5f);
        p.card.Rect.pivot = new Vector2(0f, 0.5f);
        p.card.Rect.anchoredPosition = new Vector2(8f, 0f);

        var font = skin.FontOrDefault();
        float tx = pw + 14f;           // text column to the right of the card
        float tw = 176f - tx - 6f;     // ~84 px wide
        p.nameText = HudFactory.Text(rt, "Name", font, 14, skin.textPrimary, TextAnchor.MiddleLeft, new Vector2(tw, 20f));
        p.nameText.rectTransform.anchorMin = p.nameText.rectTransform.anchorMax = new Vector2(0f, 1f);
        p.nameText.rectTransform.pivot = new Vector2(0f, 1f);
        p.nameText.rectTransform.anchoredPosition = new Vector2(tx, -10f);

        p.subText = HudFactory.Text(rt, "Sub", font, 10, skin.textSecondary, TextAnchor.MiddleLeft, new Vector2(tw, 14f));
        p.subText.rectTransform.anchorMin = p.subText.rectTransform.anchorMax = new Vector2(0f, 1f);
        p.subText.rectTransform.pivot = new Vector2(0f, 1f);
        p.subText.rectTransform.anchoredPosition = new Vector2(tx, -30f);

        p.hpText = HudFactory.Text(rt, "HpText", font, 12, skin.textPrimary, TextAnchor.MiddleLeft, new Vector2(tw, 16f));
        p.hpText.rectTransform.anchorMin = p.hpText.rectTransform.anchorMax = new Vector2(0f, 1f);
        p.hpText.rectTransform.pivot = new Vector2(0f, 1f);
        p.hpText.rectTransform.anchoredPosition = new Vector2(tx, -48f);

        p.pips = new Image[3];
        for (int i = 0; i < 3; i++)
        {
            var pip = HudFactory.Image(rt, $"Pip{i}", skin.pip, skin.gold, new Vector2(8f, 8f));
            pip.rectTransform.anchorMin = pip.rectTransform.anchorMax = new Vector2(0f, 1f);
            pip.rectTransform.pivot = new Vector2(0f, 1f);
            pip.rectTransform.anchoredPosition = new Vector2(tx + i * 12f, -70f);
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
