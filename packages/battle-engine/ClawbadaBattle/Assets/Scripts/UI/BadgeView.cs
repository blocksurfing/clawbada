using UnityEngine;
using UnityEngine.UI;

/// <summary>Top-corner team label with the Human / Agent / Bot identity badge.</summary>
public class BadgeView : MonoBehaviour
{
    private HudSkin skin;
    private Text label;
    private Image badge;
    private Text badgeText;

    public static BadgeView Create(Transform parent, string name, HudSkin skin, bool left)
    {
        var anchor = left ? new Vector2(0f, 1f) : new Vector2(1f, 1f);
        var rt = HudFactory.Rect(parent, name, anchor, anchor, anchor, new Vector2(left ? 8f : -8f, -8f), new Vector2(170f, 40f));
        var view = rt.gameObject.AddComponent<BadgeView>();
        view.skin = skin;
        HudFactory.AddImage(rt, skin.panelBg, new Color(1f, 1f, 1f, 0.9f));

        view.label = HudFactory.Text(rt, "Label", skin.FontOrDefault(), 12, skin.textPrimary, left ? TextAnchor.MiddleLeft : TextAnchor.MiddleRight, new Vector2(150f, 18f));
        view.label.rectTransform.anchoredPosition = new Vector2(0f, 8f);
        view.badge = HudFactory.Image(rt, "Badge", null, Color.white, new Vector2(48f, 24f));
        view.badge.rectTransform.anchoredPosition = new Vector2(left ? -55f : 55f, -9f);
        view.badgeText = HudFactory.Text(rt, "BadgeText", skin.FontOrDefault(), 10, skin.textSecondary, left ? TextAnchor.MiddleLeft : TextAnchor.MiddleRight, new Vector2(90f, 16f));
        view.badgeText.rectTransform.anchoredPosition = new Vector2(left ? 20f : -20f, -9f);
        return view;
    }

    public void Set(string teamLabel, string badgeKind, Color teamColor)
    {
        label.text = teamLabel;
        label.color = teamColor;
        var sprite = skin.BadgeSprite(badgeKind);
        badge.sprite = sprite;
        badge.enabled = sprite != null;
        badgeText.text = (badgeKind ?? "").ToLowerInvariant() switch
        {
            "player" or "human" => "HUMAN",
            "agent" => "AGENT",
            "bot" => "BOT",
            "spectator" => "SPECTATING",
            _ => "",
        };
    }
}
