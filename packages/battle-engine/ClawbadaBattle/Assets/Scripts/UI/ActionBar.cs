using System;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Action buttons: a row of Nzib's ActionButtonUI prefabs (drop 28c11f5) right of the avatar, bottom-left —
/// Attack, Defend, the acting lobster's own class Special, Wait. No text: his icons carry their glyphs. His
/// Animator owns the frame: Pressed while held (the Visual drops a design pixel), Selected (looping shine) for
/// the armed action, Normal otherwise — driven by ButtonFeel; hover adds a soft halo. There is no Undo button: tapping your own lobster (or its start hex) cancels a move, and the
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
    private Image specialIcon;
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
        float size = 48f * ArtScale;
        float pitch = PitchArt * ArtScale;
        var rt = HudFactory.Rect(parent, "ActionBar", Vector2.zero, Vector2.zero, Vector2.zero, bottomLeft, new Vector2(pitch * 3f + size, size));
        var bar = rt.gameObject.AddComponent<ActionBar>();
        bar.skin = skin;
        bar.Width = rt.sizeDelta.x;
        bar.ButtonHeight = size;
        if (skin.actionButtonPrefab == null) Debug.LogError("[BattleHud] HudSkin.actionButtonPrefab is not bound — run Clawbada ▸ HUD ▸ Bind Nzib HUD Art");

        bar.attack = bar.Make(rt, "Attack", skin.actionAttack, 0, size, pitch, () => bar.Press("attack"), out bar.attackFeel, out _);
        bar.defend = bar.Make(rt, "Defend", skin.actionDefend, 1, size, pitch, () => bar.Press("defend"), out bar.defendFeel, out _);
        bar.special = bar.Make(rt, "Special", skin.SpecialButton(0), 2, size, pitch, () => bar.Press("special"), out bar.specialFeel, out bar.specialIcon);
        bar.wait = bar.Make(rt, "Wait", skin.actionWait, 3, size, pitch, () => bar.Press("none"), out bar.waitFeel, out _);

        // On the canvas, not the row: bottom-right under the clock, right-aligned so long lines grow leftwards.
        bar.hint = HudFactory.Text(parent, "Hint", skin.FontOrDefault(), 12, skin.textPrimary, TextAnchor.LowerRight, new Vector2(560f, 18f));
        var hrt = bar.hint.rectTransform;
        hrt.anchorMin = hrt.anchorMax = hrt.pivot = new Vector2(1f, 0f);
        hrt.anchoredPosition = hintBottomRight;
        bar.hint.gameObject.SetActive(false);

        rt.gameObject.SetActive(false);
        return bar;
    }

    /// <summary>One button: a slot (the stationary click area: transparent raycast image + Button) holding the hover
    /// halo and Nzib's prefab (his root stays put; his Animator moves the Visual). Icon.sprite is the action's.</summary>
    private Button Make(RectTransform row, string name, Sprite icon, int index, float size, float pitch,
        UnityEngine.Events.UnityAction onClick, out ButtonFeel feel, out Image iconImage)
    {
        var rt = HudFactory.Rect(row, name, Vector2.zero, Vector2.zero, HudFactory.Center, new Vector2(pitch * index + size * 0.5f, size * 0.5f), new Vector2(size, size));
        // The click area: invisible, and never moves (his Pressed state moves only the Visual inside).
        var hit = HudFactory.AddImage(rt, skin.actionFrame, new Color(1f, 1f, 1f, 0f), raycast: true);

        Image glow = null;
        if (skin.actionGlow != null)
        {
            glow = HudFactory.Image(rt, "Glow", skin.actionGlow, Color.white, skin.actionGlow.rect.size * ArtScale);
            glow.enabled = false;
        }

        Animator anim = null;
        iconImage = null;
        if (skin.actionButtonPrefab != null)
        {
            var ui = (RectTransform)Instantiate(skin.actionButtonPrefab, rt, false).transform;
            ui.name = "ActionButtonUI";
            ui.anchorMin = ui.anchorMax = ui.pivot = HudFactory.Center;
            ui.anchoredPosition = Vector2.zero;
            ui.localScale = new Vector3(ArtScale, ArtScale, 1f);
            anim = ui.GetComponent<Animator>();
            iconImage = ui.Find("Visual/Icon")?.GetComponent<Image>();
            if (iconImage != null && icon != null) iconImage.sprite = icon;
        }

        var btn = rt.gameObject.AddComponent<Button>();
        btn.targetGraphic = hit;
        btn.transition = Selectable.Transition.None;   // his Animator is the only thing that draws the frame
        btn.navigation = new Navigation { mode = Navigation.Mode.None };
        btn.onClick.AddListener(onClick);

        rt.gameObject.AddComponent<CanvasGroup>();
        feel = rt.gameObject.AddComponent<ButtonFeel>();
        feel.glow = glow;
        feel.animator = anim;
        return btn;
    }

    /// <summary>The Special button is the acting lobster's own (Fortify, Ambush, …).</summary>
    public void SetActorClass(int classId)
    {
        if (classId == actorClass) return;
        actorClass = classId;
        var art = skin.SpecialButton(classId);
        if (art != null && specialIcon != null) specialIcon.sprite = art;
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

        SetArmed(attackFeel, attack, d.action == "attack");
        SetArmed(specialFeel, special, d.action == "special");
        SetArmed(defendFeel, defend, d.action == "defend");
        SetArmed(waitFeel, wait, d.action == "none");

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

    /// <summary>Armed = his looping Selected state; a disabled button is dimmed and held at Normal.</summary>
    private static void SetArmed(ButtonFeel feel, Button b, bool armed)
    {
        feel.SetArmed(armed && b.interactable);
        var group = b.GetComponent<CanvasGroup>();
        if (group != null) group.alpha = b.interactable ? 1f : 0.45f;
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
