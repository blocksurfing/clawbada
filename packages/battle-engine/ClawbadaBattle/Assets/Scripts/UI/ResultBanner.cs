using UnityEngine;
using UnityEngine.UI;

/// <summary>Victory / Defeat / Draw banner with the end reason, over a dimmed arena.</summary>
public class ResultBanner : MonoBehaviour
{
    public bool Visible => gameObject.activeSelf;
    private HudSkin skin;
    private Text title;
    private Text subtitle;
    private Image panel;

    public static ResultBanner Create(Transform parent, HudSkin skin)
    {
        var root = HudFactory.Stretch(parent, "Banner");
        var banner = root.gameObject.AddComponent<ResultBanner>();
        banner.skin = skin;
        var dim = HudFactory.Stretch(root, "Dim");
        HudFactory.AddImage(dim, null, new Color(0f, 0f, 0f, 0.35f));

        banner.panel = HudFactory.Image(root, "Panel", skin.panelBg, Color.white, new Vector2(380f, 130f));
        banner.title = HudFactory.Text(banner.panel.rectTransform, "Title", skin.FontOrDefault(), 34, skin.gold, TextAnchor.MiddleCenter, new Vector2(360f, 50f));
        banner.title.rectTransform.anchoredPosition = new Vector2(0f, 16f);
        banner.subtitle = HudFactory.Text(banner.panel.rectTransform, "Subtitle", skin.FontOrDefault(), 14, skin.textSecondary, TextAnchor.MiddleCenter, new Vector2(360f, 24f));
        banner.subtitle.rectTransform.anchoredPosition = new Vector2(0f, -22f);
        root.gameObject.SetActive(false);
        return banner;
    }

    public void Show(string winner, bool playerWon, string reason, string playerSide)
    {
        string t;
        Color c;
        if (winner == "draw") { t = "DRAW"; c = skin.textPrimary; }
        else if (playerSide == "spectator" || string.IsNullOrEmpty(playerSide)) { t = $"TEAM {winner} WINS"; c = skin.TeamColor(winner); }
        else if (playerWon) { t = "VICTORY"; c = skin.gold; }
        else { t = "DEFEAT"; c = skin.hpLow; }
        title.text = t;
        title.color = c;
        subtitle.text = reason switch
        {
            "forfeit" => "by forfeit",
            "turn_cap" => "turn cap reached",
            "wipeout" => "wipeout",
            _ => "",
        };
        gameObject.SetActive(true);
        Debug.Log($"[BattleHud] banner {t} {reason}");
    }

    public void Hide() => gameObject.SetActive(false);
}
