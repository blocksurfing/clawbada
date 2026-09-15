using System;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Gear button in the top-right corner and the options panel behind it: Music on/off,
/// SFX on/off, and the only in-battle escape hatch, forfeit. Quitting loses the battle, so
/// that press is confirmed before Unity reports it — React owns the actual call to the API.
///
/// The audio rows are a view of React's site-wide preference, not the owner of it: a press
/// raises MusicToggled / SfxToggled, React persists it to localStorage and echoes the state
/// back through BattleBridge.SetAudioPrefs → SetAudioState, so the labels here and the
/// floating toggle on the page can never disagree.
///
/// Only shown to a participant (spectators have nothing to forfeit) and hidden once the
/// battle ends. Built in code from the HudSkin like the rest of the HUD.
/// </summary>
public class OptionsMenu : MonoBehaviour
{
    /// <summary>Raised after the player confirms the forfeit in the panel.</summary>
    public event Action ForfeitConfirmed;
    /// <summary>Raised when the Music row is pressed, with the requested state.</summary>
    public event Action<bool> MusicToggled;
    /// <summary>Raised when the SFX row is pressed, with the requested state.</summary>
    public event Action<bool> SfxToggled;

    private static readonly Color OnTint = new Color(0.20f, 0.42f, 0.36f, 1f);
    private static readonly Color OffTint = new Color(0.23f, 0.28f, 0.36f, 1f);

    private Button gear;
    private RectTransform panel;   // 198 tall: four rows, and the confirm pair needs a bottom margin
    private RectTransform mainRows, confirmRows;
    private Button musicRow, sfxRow, forfeitRow, confirmRow, cancelRow, closeRow;
    private Text musicLabel, sfxLabel;
    private Image musicImage, sfxImage;
    private bool musicOn = true, sfxOn = true;

    public bool IsOpen => panel != null && panel.gameObject.activeSelf;

    public static OptionsMenu Create(Transform parent, HudSkin skin)
    {
        var root = HudFactory.Rect(parent, "Options", new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(1f, 1f),
            new Vector2(-8f, -8f), new Vector2(190f, 240f));
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
            new Vector2(0f, -(gearSize * 1.143f + 6f)), new Vector2(176f, 198f));
        HudFactory.AddImage(menu.panel, skin.panelBg, new Color(1f, 1f, 1f, 0.97f), raycast: true);

        var title = HudFactory.Text(menu.panel, "Title", font, 12, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(160f, 18f));
        title.rectTransform.anchorMin = title.rectTransform.anchorMax = title.rectTransform.pivot = new Vector2(0.5f, 1f);
        title.rectTransform.anchoredPosition = new Vector2(0f, -8f);
        title.text = "OPTIONS";

        menu.mainRows = HudFactory.Stretch(menu.panel, "Main");
        menu.musicRow = Row(menu.mainRows, skin, "Music", "Music: On", OnTint, -34f, menu.ToggleMusic, out menu.musicLabel, out menu.musicImage);
        menu.sfxRow = Row(menu.mainRows, skin, "Sfx", "SFX: On", OnTint, -70f, menu.ToggleSfx, out menu.sfxLabel, out menu.sfxImage);
        menu.forfeitRow = Row(menu.mainRows, skin, "Forfeit", "Forfeit battle", new Color(0.79f, 0.27f, 0.23f, 1f), -106f, menu.AskConfirm, out _, out _);
        menu.closeRow = Row(menu.mainRows, skin, "Close", "Close", OffTint, -142f, menu.Close, out _, out _);

        menu.confirmRows = HudFactory.Stretch(menu.panel, "Confirm");
        var warn = HudFactory.Text(menu.confirmRows, "Warn", font, 11, new Color(0.92f, 0.72f, 0.68f), TextAnchor.MiddleCenter, new Vector2(164f, 26f));
        warn.rectTransform.anchorMin = warn.rectTransform.anchorMax = warn.rectTransform.pivot = new Vector2(0.5f, 1f);
        warn.rectTransform.anchoredPosition = new Vector2(0f, -26f);
        warn.text = "Quit now and lose the battle?";
        menu.confirmRow = Row(menu.confirmRows, skin, "Yes", "Yes, forfeit", new Color(0.79f, 0.27f, 0.23f, 1f), -54f, menu.Confirm, out _, out _);
        menu.cancelRow = Row(menu.confirmRows, skin, "No", "Keep playing", OffTint, -88f, menu.AskCancel, out _, out _);

        menu.panel.gameObject.SetActive(false);
        root.gameObject.SetActive(false);   // shown by BattleHud for participants only
        return menu;
    }

    private static Button Row(Transform parent, HudSkin skin, string name, string label, Color tint, float y,
        UnityEngine.Events.UnityAction onClick, out Text labelText, out Image image)
    {
        var rt = HudFactory.Rect(parent, name, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0.5f, 1f),
            new Vector2(0f, y), new Vector2(152f, 26f));
        // A white sprite so the tint IS the colour: tinting the dark panel sprite produced
        // near-black rows and the destructive action did not read as destructive.
        image = HudFactory.AddImage(rt, skin.barFill != null ? skin.barFill : skin.panelBg, tint, raycast: true);
        var btn = rt.gameObject.AddComponent<Button>();
        btn.targetGraphic = image;
        var colors = btn.colors;
        colors.highlightedColor = new Color(1.25f, 1.25f, 1.25f, 1f);
        colors.pressedColor = new Color(0.8f, 0.8f, 0.8f, 1f);
        btn.colors = colors;
        btn.onClick.AddListener(onClick);
        labelText = HudFactory.Text(rt, "Label", skin.FontOrDefault(), 12, Color.white, TextAnchor.MiddleCenter, new Vector2(148f, 22f));
        labelText.text = label;
        return btn;
    }

    /// <summary>React's current preferences — refreshes the rows without raising events.</summary>
    public void SetAudioState(bool music, bool sfx)
    {
        musicOn = music;
        sfxOn = sfx;
        Refresh();
    }

    private void Refresh()
    {
        if (musicLabel != null) musicLabel.text = musicOn ? "Music: On" : "Music: Off";
        if (sfxLabel != null) sfxLabel.text = sfxOn ? "SFX: On" : "SFX: Off";
        if (musicImage != null) musicImage.color = musicOn ? OnTint : OffTint;
        if (sfxImage != null) sfxImage.color = sfxOn ? OnTint : OffTint;
    }

    private void ToggleMusic()
    {
        musicOn = !musicOn;   // optimistic; React echoes the persisted state back via SetAudioState
        Refresh();
        Debug.Log($"[BattleHud] music {(musicOn ? "on" : "off")}");
        MusicToggled?.Invoke(musicOn);
    }

    private void ToggleSfx()
    {
        sfxOn = !sfxOn;
        BattleSfx.Enabled = sfxOn;   // immediate, so the very next hit obeys the press
        Refresh();
        Debug.Log($"[BattleHud] sfx {(sfxOn ? "on" : "off")}");
        SfxToggled?.Invoke(sfxOn);
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
    /// shape ActionBar logs — a browser driver has no other way to find these buttons. The audio
    /// rows also carry their state (music:on / sfx:off) so a driver can assert it.</summary>
    private void LogRects()
    {
        var sb = new StringBuilder("[BattleHud] options");
        Append(sb, "gear", gear);
        if (IsOpen)
        {
            if (mainRows.gameObject.activeSelf)
            {
                Append(sb, $"music:{(musicOn ? "on" : "off")}", musicRow);
                Append(sb, $"sfx:{(sfxOn ? "on" : "off")}", sfxRow);
                Append(sb, "forfeit", forfeitRow);
                Append(sb, "close", closeRow);
            }
            else
            {
                Append(sb, "yes", confirmRow);
                Append(sb, "no", cancelRow);
            }
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
