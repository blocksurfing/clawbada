using System;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Action buttons (Nzib's layout, 2026-09-27): a row of hex buttons right of the round avatar, bottom-left —
/// Attack, Defend, the acting lobster's own class Special, Wait. No text: his buttons carry their glyphs.
/// Hover glows and grows a pixel, press shrinks and darkens (ButtonFeel); the armed action keeps its glow and
/// a gold frame. There is no Undo button: tapping your own lobster (or its start hex) cancels a move, and the
/// hint line says so. Unity only reports presses; React decides what they mean and submits the turn. Its state
/// (which action is armed, what is legal) arrives through Apply. One line above the buttons says why a press
/// went nowhere ("Out of range — move closer first", a server rejection) and shows "Sending…" — inside the
/// canvas, because in fullscreen React's status row is off screen and a silent press reads as a frozen game.
/// That line sits bottom-right under the shot clock (user 2026-09-27) and can be switched off in the options
/// menu (HintsEnabled, remembered in PlayerPrefs); "Sending…" and server errors always show.
/// </summary>
public class ActionBar : MonoBehaviour
{
    public event Action<string> ActionPressed;

    /// <summary>Canvas units per art pixel: the 960x540 canvas over the 640x360 art frame.</summary>
    public const float ArtScale = 1.5f;
    /// <summary>Hex spacing: the frame's hex is 42 art px wide in its 48 px cell, plus a 2 px gap.</summary>
    private const float PitchArt = 44f;
    private static readonly Color ArmedGlow = new Color(1f, 0.82f, 0.4f, 0.9f);
    private const string CancelMoveHint = "Tap your lobster to cancel the move";
    private const string HintsPref = "clawbada.hints";

    /// <summary>Game hints on/off (options menu). Off keeps only "Sending…" and errors.</summary>
    public static bool HintsEnabled
    {
        get { return PlayerPrefs.GetInt(HintsPref, 1) == 1; }
        set { PlayerPrefs.SetInt(HintsPref, value ? 1 : 0); PlayerPrefs.Save(); }
    }

    private HudSkin skin;
    private Button attack, special, defend, wait;
    private Image specialPlate, specialIcon;
    private Image attackFrame, specialFrame, defendFrame, waitFrame;
    private ButtonFeel attackFeel, specialFeel, defendFeel, waitFeel;
    private Text hint;
    private string lastNote = "";
    private int actorClass = -1;
    private SelectionData lastSel;

    /// <summary>Width of the whole row in canvas units (for the owner's layout).</summary>
    public float Width { get; private set; }
    public float ButtonHeight { get; private set; }

    /// <param name="hintBottomRight">Where the hint line's bottom-right corner sits, from the canvas's bottom-right.</param>
    public static ActionBar Create(Transform parent, HudSkin skin, Vector2 bottomLeft, Vector2 hintBottomRight)
    {
        bool nzib = skin.actionFrame != null;
        float size = nzib ? skin.actionFrame.rect.width * ArtScale : skin.buttonSize;
        float pitch = nzib ? PitchArt * ArtScale : skin.buttonSize + 10f;
        float h = nzib ? size : size * 1.143f;
        var rt = HudFactory.Rect(parent, "ActionBar", Vector2.zero, Vector2.zero, Vector2.zero, bottomLeft, new Vector2(pitch * 3f + size, h));
        var bar = rt.gameObject.AddComponent<ActionBar>();
        bar.skin = skin;
        bar.Width = rt.sizeDelta.x;
        bar.ButtonHeight = h;

        bar.attack = bar.Make(rt, "Attack", skin.actionAttack, skin.btnAttack, skin.iconAttack, 0, size, pitch, () => bar.Press("attack"), out bar.attackFrame, out bar.attackFeel, out _, out _);
        bar.defend = bar.Make(rt, "Defend", skin.actionDefend, skin.btnDefend, skin.iconDefend, 1, size, pitch, () => bar.Press("defend"), out bar.defendFrame, out bar.defendFeel, out _, out _);
        bar.special = bar.Make(rt, "Special", skin.SpecialButton(0), skin.btnSpecial, skin.iconSpecial, 2, size, pitch, () => bar.Press("special"), out bar.specialFrame, out bar.specialFeel, out bar.specialPlate, out bar.specialIcon);
        bar.wait = bar.Make(rt, "Wait", skin.actionWait, skin.btnWait, skin.iconWait, 3, size, pitch, () => bar.Press("none"), out bar.waitFrame, out bar.waitFeel, out _, out _);

        // On the canvas, not the row: bottom-right under the clock, right-aligned so long lines grow leftwards.
        bar.hint = HudFactory.Text(parent, "Hint", skin.FontOrDefault(), 12, skin.textPrimary, TextAnchor.LowerRight, new Vector2(560f, 18f));
        var hrt = bar.hint.rectTransform;
        hrt.anchorMin = hrt.anchorMax = hrt.pivot = new Vector2(1f, 0f);
        hrt.anchoredPosition = hintBottomRight;
        bar.hint.gameObject.SetActive(false);

        rt.gameObject.SetActive(false);
        return bar;
    }

    /// <summary>Old generated plate for an action, when Nzib's art is not bound.</summary>
    private Sprite Fallback(Sprite plate) =>
        plate != null ? plate : skin.hexBevel != null ? skin.hexBevel : skin.hexButton64;

    /// <summary>One button: glow (behind), plate (clickable), frame (over). With Nzib's art the plate carries its glyph;
    /// the fallback plate gets the old icon on top.</summary>
    private Button Make(RectTransform row, string name, Sprite art, Sprite oldPlate, Sprite oldIcon, int index, float size, float pitch,
        UnityEngine.Events.UnityAction onClick, out Image frame, out ButtonFeel feel, out Image plate, out Image icon)
    {
        bool nzib = skin.actionFrame != null;
        float h = nzib ? size : size * 1.143f;
        var rt = HudFactory.Rect(row, name, Vector2.zero, Vector2.zero, new Vector2(0.5f, 0.5f), new Vector2(pitch * index + size * 0.5f, h * 0.5f), new Vector2(size, h));

        Image glow = null;
        if (skin.actionGlow != null && nzib)
        {
            float k = size / skin.actionFrame.rect.width;
            glow = HudFactory.Image(rt, "Glow", skin.actionGlow, Color.white, skin.actionGlow.rect.size * k);
            glow.enabled = false;
        }

        plate = HudFactory.AddImage(HudFactory.Stretch(rt, "Plate"), nzib && art != null ? art : Fallback(oldPlate), Color.white, raycast: true);
        icon = null;
        if (!nzib && oldIcon != null) icon = HudFactory.Image(rt, "Icon", oldIcon, Color.white, new Vector2(size * 0.5f, size * 0.5f));
        frame = nzib ? HudFactory.AddImage(HudFactory.Stretch(rt, "Frame"), skin.actionFrame, Color.white) : null;

        var btn = rt.gameObject.AddComponent<Button>();
        btn.targetGraphic = plate;
        var colors = btn.colors;
        colors.normalColor = Color.white;
        colors.highlightedColor = Color.white;          // hover is the glow + grow, not a tint
        colors.selectedColor = Color.white;
        colors.pressedColor = new Color(0.78f, 0.78f, 0.78f, 1f);
        colors.disabledColor = new Color(0.45f, 0.45f, 0.45f, 0.6f);
        colors.fadeDuration = 0.05f;
        btn.colors = colors;
        btn.navigation = new Navigation { mode = Navigation.Mode.None };
        btn.onClick.AddListener(onClick);

        feel = rt.gameObject.AddComponent<ButtonFeel>();
        feel.glow = glow;
        feel.step = 2f * ArtScale / size;   // 2 art px
        return btn;
    }

    /// <summary>The Special button is the acting lobster's own (Fortify, Ambush, …).</summary>
    public void SetActorClass(int classId)
    {
        if (classId == actorClass) return;
        actorClass = classId;
        var art = skin.SpecialButton(classId);
        if (skin.actionFrame != null && art != null) specialPlate.sprite = art;
    }

    private void Press(string action)
    {
        Debug.Log($"[BattleHud] press {action}");
        ActionPressed?.Invoke(action);
    }

    /// <summary>Reflect React's selection state. Null or a non-player turn hides the bar.</summary>
    public void Apply(SelectionData d)
    {
        lastSel = d;
        bool show = d != null && d.isPlayerTurn;
        gameObject.SetActive(show);
        if (!show) { hint.gameObject.SetActive(false); return; }

        bool live = d.canAct && !d.pendingAck;
        attack.interactable = live;
        special.interactable = live && d.canSpecial;
        defend.interactable = live;
        wait.interactable = live;

        ShowHint(d);

        SetArmed(attackFeel, attackFrame, attack, d.action == "attack");
        SetArmed(specialFeel, specialFrame, special, d.action == "special");
        SetArmed(defendFeel, defendFrame, defend, d.action == "defend");
        SetArmed(waitFeel, waitFrame, wait, d.action == "none");

        Canvas.ForceUpdateCanvases();
        LogButtons();
    }

    private void ShowHint(SelectionData d)
    {
        string note = d.pendingAck ? "Sending…" : !string.IsNullOrEmpty(d.hint) ? d.hint : d.canUndo ? CancelMoveHint : "";
        bool always = d.pendingAck || d.hintIsError;
        if (!always && !HintsEnabled) note = "";
        hint.text = note;
        hint.gameObject.SetActive(note.Length > 0);
        if (note != lastNote) { lastNote = note; if (note.Length > 0) Debug.Log($"[BattleHud] hint {note}"); }
    }

    /// <summary>The options toggle flipped: redraw the current line under the new setting.</summary>
    public void RefreshHint()
    {
        if (lastSel != null && lastSel.isPlayerTurn && gameObject.activeSelf) ShowHint(lastSel);
    }

    /// <summary>Armed = gold frame + steady glow; a disabled button's frame dims with its plate.</summary>
    private void SetArmed(ButtonFeel feel, Image frame, Button b, bool armed)
    {
        armed &= b.interactable;
        feel.SetArmed(armed, ArmedGlow);
        if (frame != null) frame.color = armed ? skin.buttonArmed : b.interactable ? Color.white : new Color(0.55f, 0.55f, 0.55f, 0.7f);
    }

    /// <summary>Harness signal: button rects in screen pixels (x, y-from-bottom, w, h).</summary>
    private void LogButtons()
    {
        var sb = new StringBuilder("[BattleHud] buttons");
        Append(sb, "attack", attack);
        Append(sb, "special", special);
        Append(sb, "defend", defend);
        Append(sb, "wait", wait);
        Debug.Log(sb.ToString());
    }

    private static readonly Vector3[] corners = new Vector3[4];

    private static void Append(StringBuilder sb, string name, Button b) => AppendRect(sb, name, b.GetComponent<RectTransform>());

    /// <summary>`name=(x,y,w,h)` in the canvas's world corners — the format the harness and agents parse.</summary>
    public static void AppendRect(StringBuilder sb, string name, RectTransform rt)
    {
        rt.GetWorldCorners(corners);
        sb.Append($" {name}=({corners[0].x:F0},{corners[0].y:F0},{corners[2].x - corners[0].x:F0},{corners[2].y - corners[0].y:F0})");
    }
}
