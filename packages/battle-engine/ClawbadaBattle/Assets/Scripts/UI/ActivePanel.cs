using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Bottom-left panel for the acting lobster: large portrait, class name, tier/team,
/// HP bar with numbers, charge pips and the shot clock (players only).
/// </summary>
public class ActivePanel : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public ClockView Clock { get; private set; }
    public LobsterController Lobster { get; private set; }

    private HudSkin skin;
    private LobsterPartLibrary partLibrary;
    private PortraitView portrait;
    private Text nameText;
    private Text subText;
    private HpBar hp;
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
        p.portrait = PortraitView.Create(rt, "Portrait", skin, pw);
        p.portrait.Rect.anchorMin = p.portrait.Rect.anchorMax = new Vector2(0f, 0.5f);
        p.portrait.Rect.pivot = new Vector2(0f, 0.5f);
        p.portrait.Rect.anchoredPosition = new Vector2(8f, 0f);

        var font = skin.FontOrDefault();
        p.nameText = HudFactory.Text(rt, "Name", font, 16, skin.textPrimary, TextAnchor.MiddleLeft, new Vector2(130f, 22f));
        p.nameText.rectTransform.anchorMin = p.nameText.rectTransform.anchorMax = new Vector2(0f, 1f);
        p.nameText.rectTransform.pivot = new Vector2(0f, 1f);
        p.nameText.rectTransform.anchoredPosition = new Vector2(pw + 16f, -10f);

        p.subText = HudFactory.Text(rt, "Sub", font, 11, skin.textSecondary, TextAnchor.MiddleLeft, new Vector2(130f, 16f));
        p.subText.rectTransform.anchorMin = p.subText.rectTransform.anchorMax = new Vector2(0f, 1f);
        p.subText.rectTransform.pivot = new Vector2(0f, 1f);
        p.subText.rectTransform.anchoredPosition = new Vector2(pw + 16f, -32f);

        p.hp = HpBar.Create(rt, "Hp", skin, new Vector2(124f, 10f), withLabel: true, labelSize: 10);
        p.hp.Rect.anchorMin = p.hp.Rect.anchorMax = new Vector2(0f, 1f);
        p.hp.Rect.pivot = new Vector2(0f, 1f);
        p.hp.Rect.anchoredPosition = new Vector2(pw + 16f, -54f);

        p.pips = new Image[3];
        for (int i = 0; i < 3; i++)
        {
            var pip = HudFactory.Image(rt, $"Pip{i}", skin.pip, skin.gold, new Vector2(8f, 8f));
            pip.rectTransform.anchorMin = pip.rectTransform.anchorMax = new Vector2(0f, 1f);
            pip.rectTransform.pivot = new Vector2(0f, 1f);
            pip.rectTransform.anchoredPosition = new Vector2(pw + 16f + i * 12f, -70f);
            p.pips[i] = pip;
        }

        p.Clock = ClockView.Create(rt, "Clock", skin, 18);
        p.Clock.Rect.anchorMin = p.Clock.Rect.anchorMax = new Vector2(0f, 0f);
        p.Clock.Rect.pivot = new Vector2(0f, 0f);
        p.Clock.Rect.anchoredPosition = new Vector2(pw + 44f, 6f);

        rt.gameObject.SetActive(false);
        return p;
    }

    public void Show(LobsterController lob, bool isPlayer)
    {
        Lobster = lob;
        if (lob == null) { Hide(); return; }
        gameObject.SetActive(true);
        portrait.Compose(lob, partLibrary);
        portrait.SetFrameColor(isPlayer ? skin.activeRing : skin.TeamColor(lob.side));
        nameText.text = string.IsNullOrEmpty(lob.className) ? LobsterClasses.Name(lob.classId) : lob.className;
        nameText.color = skin.TeamColor(lob.side);
        subText.text = $"{LobsterClasses.TierName(lob.tier)} · Team {lob.side}{(isPlayer ? " · you" : "")}";
        Refresh();
    }

    public void Hide()
    {
        Lobster = null;
        Clock.StopClock();
        gameObject.SetActive(false);
    }

    public void Refresh()
    {
        var lob = Lobster;
        if (lob == null || !gameObject.activeSelf) return;
        hp.Set(lob.currentHp, lob.maxHp);
        for (int i = 0; i < pips.Length; i++) pips[i].color = i < lob.charge ? skin.gold : new Color(1f, 1f, 1f, 0.25f);
        portrait.SetDimmed(!lob.alive);
    }
}
