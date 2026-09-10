using System;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Gear button in the top-right corner and the options panel behind it. Holds the only
/// in-battle escape hatch: forfeit. Quitting loses the battle, so the press is confirmed
/// before Unity reports it — React owns the actual call to the API.
///
/// Only shown to a participant (spectators have nothing to forfeit) and hidden once the
/// battle ends. Built in code from the HudSkin like the rest of the HUD.
/// </summary>
public class OptionsMenu : MonoBehaviour
{
    /// <summary>Raised after the player confirms the forfeit in the panel.</summary>
    public event Action ForfeitConfirmed;

    private Button gear;
    private RectTransform panel;   // 126 tall: the confirm pair needs a bottom margin
    private RectTransform mainRows, confirmRows;
    private Button forfeitRow, confirmRow, cancelRow, closeRow;

    public bool IsOpen => panel != null && panel.gameObject.activeSelf;

    public static OptionsMenu Create(Transform parent, HudSkin skin)
    {
        var root = HudFactory.Rect(parent, "Options", new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(1f, 1f),
            new Vector2(-8f, -8f), new Vector2(190f, 168f));
        var menu = root.gameObject.AddComponent<OptionsMenu>();
        var font = skin.FontOrDefault();

        float gearSize = 40f;
        menu.gear = HudFactory.Button(root, "Gear", skin.btnGear != null ? skin.btnGear : skin.hexBevel,
            skin.iconGear, "", font, gearSize, menu.Toggle);
        var grt = menu.gear.GetComponent<RectTransform>();
        grt.anchorMin = grt.anchorMax = grt.pivot = new Vector2(1f, 1f);
        grt.anchoredPosition = Vector2.zero;
        // Button() lays the label under the glyph; the gear carries no caption.
        var gearLabel = menu.gear.transform.Find("Label");
        if (gearLabel != null) gearLabel.gameObject.SetActive(false);
        var gearIcon = menu.gear.transform.Find("Icon") as RectTransform;
        if (gearIcon != null)
        {
            gearIcon.sizeDelta = new Vector2(gearSize * 0.56f, gearSize * 0.56f);
            gearIcon.anchoredPosition = Vector2.zero;
        }

        menu.panel = HudFactory.Rect(root, "Panel", new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(1f, 1f),
            new Vector2(0f, -(gearSize * 1.143f + 6f)), new Vector2(176f, 126f));
        HudFactory.AddImage(menu.panel, skin.panelBg, new Color(1f, 1f, 1f, 0.97f), raycast: true);

        var title = HudFactory.Text(menu.panel, "Title", font, 12, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(160f, 18f));
        title.rectTransform.anchorMin = title.rectTransform.anchorMax = title.rectTransform.pivot = new Vector2(0.5f, 1f);
        title.rectTransform.anchoredPosition = new Vector2(0f, -8f);
        title.text = "OPTIONS";

        menu.mainRows = HudFactory.Stretch(menu.panel, "Main");
        menu.forfeitRow = Row(menu.mainRows, skin, "Forfeit", "Forfeit battle", new Color(0.79f, 0.27f, 0.23f, 1f), -34f, menu.AskConfirm);
        menu.closeRow = Row(menu.mainRows, skin, "Close", "Close", new Color(0.23f, 0.28f, 0.36f, 1f), -70f, menu.Close);

        menu.confirmRows = HudFactory.Stretch(menu.panel, "Confirm");
        var warn = HudFactory.Text(menu.confirmRows, "Warn", font, 11, new Color(0.92f, 0.72f, 0.68f), TextAnchor.MiddleCenter, new Vector2(164f, 26f));
        warn.rectTransform.anchorMin = warn.rectTransform.anchorMax = warn.rectTransform.pivot = new Vector2(0.5f, 1f);
        warn.rectTransform.anchoredPosition = new Vector2(0f, -26f);
        warn.text = "Quit now and lose the battle?";
        menu.confirmRow = Row(menu.confirmRows, skin, "Yes", "Yes, forfeit", new Color(0.79f, 0.27f, 0.23f, 1f), -54f, menu.Confirm);
        menu.cancelRow = Row(menu.confirmRows, skin, "No", "Keep playing", new Color(0.23f, 0.28f, 0.36f, 1f), -88f, menu.AskCancel);

        menu.panel.gameObject.SetActive(false);
        root.gameObject.SetActive(false);   // shown by BattleHud for participants only
        return menu;
    }

    private static Button Row(Transform parent, HudSkin skin, string name, string label, Color tint, float y, UnityEngine.Events.UnityAction onClick)
    {
        var rt = HudFactory.Rect(parent, name, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0.5f, 1f),
            new Vector2(0f, y), new Vector2(152f, 26f));
        // A white sprite so the tint IS the colour: tinting the dark panel sprite produced
        // near-black rows and the destructive action did not read as destructive.
        var img = HudFactory.AddImage(rt, skin.barFill != null ? skin.barFill : skin.panelBg, tint, raycast: true);
        var btn = rt.gameObject.AddComponent<Button>();
        btn.targetGraphic = img;
        var colors = btn.colors;
        colors.highlightedColor = new Color(1.25f, 1.25f, 1.25f, 1f);
        colors.pressedColor = new Color(0.8f, 0.8f, 0.8f, 1f);
        btn.colors = colors;
        btn.onClick.AddListener(onClick);
        var text = HudFactory.Text(rt, "Label", skin.FontOrDefault(), 12, Color.white, TextAnchor.MiddleCenter, new Vector2(148f, 22f));
        text.text = label;
        return btn;
    }

    /// <summary>Show the gear for a participant in a live battle; hide it for spectators
    /// and once the battle is over.</summary>
    public void SetAvailable(bool available)
    {
        if (!available) Close();
        gameObject.SetActive(available);
        if (available) LogRects();
    }

    /// <summary>Harness signal: menu rects in screen pixels (x, y-from-bottom, w, h), the same
    /// shape ActionBar logs — a browser driver has no other way to find these buttons.</summary>
    private void LogRects()
    {
        var sb = new StringBuilder("[BattleHud] options");
        Append(sb, "gear", gear);
        if (IsOpen)
        {
            Append(sb, mainRows.gameObject.activeSelf ? "forfeit" : "yes", mainRows.gameObject.activeSelf ? forfeitRow : confirmRow);
            Append(sb, mainRows.gameObject.activeSelf ? "close" : "no", mainRows.gameObject.activeSelf ? closeRow : cancelRow);
        }
        Debug.Log(sb.ToString());
    }

    private static readonly Vector3[] corners = new Vector3[4];

    private static void Append(StringBuilder sb, string name, Button b)
    {
        if (b == null) return;
        var rt = b.GetComponent<RectTransform>();
        rt.GetWorldCorners(corners);
        sb.Append($" {name}=({corners[0].x:F0},{corners[0].y:F0},{corners[2].x - corners[0].x:F0},{corners[2].y - corners[0].y:F0})");
    }

    private void Toggle()
    {
        if (IsOpen) { Close(); return; }
        ShowMain();
        panel.gameObject.SetActive(true);
        Canvas.ForceUpdateCanvases();
        LogRects();
    }

    private void Close()
    {
        if (panel == null) return;
        if (panel.gameObject.activeSelf) Debug.Log("[BattleHud] options closed");
        panel.gameObject.SetActive(false);
    }

    private void ShowMain()
    {
        mainRows.gameObject.SetActive(true);
        confirmRows.gameObject.SetActive(false);
    }

    private void AskConfirm()
    {
        mainRows.gameObject.SetActive(false);
        confirmRows.gameObject.SetActive(true);
        Canvas.ForceUpdateCanvases();
        LogRects();
    }

    private void AskCancel()
    {
        ShowMain();
        Debug.Log("[BattleHud] forfeit cancelled");
    }

    private void Confirm()
    {
        Close();
        Debug.Log("[BattleHud] forfeit");
        ForfeitConfirmed?.Invoke();
    }
}
