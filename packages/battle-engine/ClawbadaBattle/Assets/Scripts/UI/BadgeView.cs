using UnityEngine;
using UnityEngine.UI;

/// <summary>Compact top-corner team tag: a team-coloured band with the team label,
/// and the Human / Agent / Bot identity as small text beside it. No large letter tile.</summary>
public class BadgeView : MonoBehaviour
{
    private HudSkin skin;
    private Image band;
    private Text label;
    private Text kindText;

    public static BadgeView Create(Transform parent, string name, HudSkin skin, bool left)
    {
        var anchor = left ? new Vector2(0f, 1f) : new Vector2(1f, 1f);
        var rt = HudFactory.Rect(parent, name, anchor, anchor, anchor, new Vector2(left ? 6f : -6f, -6f), new Vector2(150f, 20f));
        var view = rt.gameObject.AddComponent<BadgeView>();
        view.skin = skin;
        HudFactory.AddImage(rt, skin.panelBg, new Color(1f, 1f, 1f, 0.85f));

        // Team band: a short coloured strip on the outer edge, like the card headers.
        var bandRt = HudFactory.Rect(rt, "Band", left ? new Vector2(0f, 0f) : new Vector2(1f, 0f), left ? new Vector2(0f, 1f) : new Vector2(1f, 1f),
            left ? new Vector2(0f, 0.5f) : new Vector2(1f, 0.5f), new Vector2(left ? 3f : -3f, 0f), new Vector2(4f, -6f));
        view.band = HudFactory.AddImage(bandRt, skin.cardHeader != null ? skin.cardHeader : skin.barFill, skin.teamA);

        view.label = HudFactory.Text(rt, "Label", skin.FontOrDefault(), 10, skin.textPrimary, left ? TextAnchor.MiddleLeft : TextAnchor.MiddleRight, new Vector2(90f, 18f));
        view.label.rectTransform.anchorMin = view.label.rectTransform.anchorMax = left ? new Vector2(0f, 0.5f) : new Vector2(1f, 0.5f);
        view.label.rectTransform.pivot = left ? new Vector2(0f, 0.5f) : new Vector2(1f, 0.5f);
        view.label.rectTransform.anchoredPosition = new Vector2(left ? 11f : -11f, 0f);

        view.kindText = HudFactory.Text(rt, "Kind", skin.FontOrDefault(), 8, skin.textSecondary, left ? TextAnchor.MiddleRight : TextAnchor.MiddleLeft, new Vector2(50f, 16f));
        view.kindText.rectTransform.anchorMin = view.kindText.rectTransform.anchorMax = left ? new Vector2(1f, 0.5f) : new Vector2(0f, 0.5f);
        view.kindText.rectTransform.pivot = left ? new Vector2(1f, 0.5f) : new Vector2(0f, 0.5f);
        view.kindText.rectTransform.anchoredPosition = new Vector2(left ? -6f : 6f, 0f);
        return view;
    }

    public void Set(string teamLabel, string badgeKind, Color teamColor)
    {
        label.text = teamLabel;
        label.color = teamColor;
        band.color = teamColor;
        kindText.text = (badgeKind ?? "").ToLowerInvariant() switch
        {
            "player" or "human" => "HUMAN",
            "agent" => "AGENT",
            "bot" => "BOT",
            "spectator" => "SPECTATING",
            _ => "",
        };
    }
}
