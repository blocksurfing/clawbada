using System;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Bottom-centre action bar (LOKR-style): hex buttons Attack / Special / Defend / Wait
/// and a small Undo for a tentative move. Unity only reports presses; React decides
/// what they mean and submits the turn. Its state (which action is armed, what is
/// legal, the hint line) arrives through SetSelection.
/// </summary>
public class ActionBar : MonoBehaviour
{
    public event Action<string> ActionPressed;
    public event Action UndoPressed;

    private HudSkin skin;
    private Button attack, special, defend, wait, undo;
    private Image attackBg, specialBg, defendBg, waitBg;
    private Text specialLabel;
    private Text hint;
    private SelectionData last;

    public static ActionBar Create(Transform parent, HudSkin skin)
    {
        float s = skin.buttonSize;
        float pitch = s + 10f;
        var rt = HudFactory.Rect(parent, "ActionBar", new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), new Vector2(0.5f, 0f),
            new Vector2(0f, 8f), new Vector2(pitch * 4f + 70f, s * 1.143f + 34f));
        var bar = rt.gameObject.AddComponent<ActionBar>();
        bar.skin = skin;
        var font = skin.FontOrDefault();

        bar.hint = HudFactory.Text(rt, "Hint", font, 12, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(360f, 20f));
        bar.hint.rectTransform.anchorMin = bar.hint.rectTransform.anchorMax = new Vector2(0.5f, 1f);
        bar.hint.rectTransform.pivot = new Vector2(0.5f, 1f);
        bar.hint.rectTransform.anchoredPosition = new Vector2(0f, 0f);

        float x0 = -pitch * 1.5f - 20f;
        bar.attack = Make(bar, rt, "Attack", skin.iconAttack, "Attack", x0, () => bar.Press("attack"), out bar.attackBg);
        bar.special = Make(bar, rt, "Special", skin.iconSpecial, "Special", x0 + pitch, () => bar.Press("special"), out bar.specialBg);
        bar.specialLabel = bar.special.transform.Find("Label").GetComponent<Text>();
        bar.defend = Make(bar, rt, "Defend", skin.iconDefend, "Defend", x0 + pitch * 2f, () => bar.Press("defend"), out bar.defendBg);
        bar.wait = Make(bar, rt, "Wait", skin.iconWait, "Wait", x0 + pitch * 3f, () => bar.Press("none"), out bar.waitBg);

        bar.undo = HudFactory.Button(rt, "Undo", skin.hexButton64, skin.iconUndo, "Undo", font, s * 0.7f, () => bar.PressUndo());
        var urt = bar.undo.GetComponent<RectTransform>();
        urt.anchorMin = urt.anchorMax = new Vector2(0.5f, 0f);
        urt.pivot = new Vector2(0.5f, 0f);
        urt.anchoredPosition = new Vector2(x0 + pitch * 4f + 6f, 8f);

        rt.gameObject.SetActive(false);
        return bar;
    }

    private static Button Make(ActionBar bar, RectTransform rt, string name, Sprite icon, string label, float x, UnityEngine.Events.UnityAction onClick, out Image bg)
    {
        var btn = HudFactory.Button(rt, name, bar.skin.hexButton64, icon, label, bar.skin.FontOrDefault(), bar.skin.buttonSize, onClick);
        var brt = btn.GetComponent<RectTransform>();
        brt.anchorMin = brt.anchorMax = new Vector2(0.5f, 0f);
        brt.pivot = new Vector2(0.5f, 0f);
        brt.anchoredPosition = new Vector2(x, 0f);
        bg = btn.GetComponent<Image>();
        return btn;
    }

    private void Press(string action)
    {
        Debug.Log($"[BattleHud] press {action}");
        ActionPressed?.Invoke(action);
    }

    private void PressUndo()
    {
        Debug.Log("[BattleHud] undo");
        UndoPressed?.Invoke();
    }

    /// <summary>Reflect React's selection state. Null or a non-player turn hides the bar.</summary>
    public void Apply(SelectionData d)
    {
        last = d;
        bool show = d != null && d.isPlayerTurn;
        gameObject.SetActive(show);
        if (!show) return;

        bool live = d.canAct && !d.pendingAck;
        attack.interactable = live;
        special.interactable = live && d.canSpecial;
        defend.interactable = live;
        wait.interactable = live;
        undo.gameObject.SetActive(d.canUndo);
        undo.interactable = live;

        specialLabel.text = string.IsNullOrEmpty(d.specialName) ? "Special" : d.specialName;
        Tint(attackBg, d.action == "attack");
        Tint(specialBg, d.action == "special");
        Tint(defendBg, d.action == "defend");
        Tint(waitBg, d.action == "none");
        specialBg.color = d.canSpecial ? specialBg.color : skin.buttonDisabled;

        hint.text = d.pendingAck ? "Sending…" : !string.IsNullOrEmpty(d.hint) ? d.hint : DefaultHint(d);
        Canvas.ForceUpdateCanvases();
        LogButtons();
    }

    private string DefaultHint(SelectionData d)
    {
        switch (d.action)
        {
            case "attack": return d.targetCount > 0 ? "Tap an enemy to attack" : "No enemy in range — move, Defend or Wait";
            case "special": return d.specialKind == "none" ? "" : d.specialKind == "ally" ? "Tap an ally" : "Tap an enemy in range";
            default: return "";
        }
    }

    private void Tint(Image img, bool armed)
    {
        img.color = armed ? skin.buttonArmed : skin.buttonNormal;
    }

    /// <summary>Harness signal: button rects in screen pixels (x, y-from-bottom, w, h).</summary>
    private void LogButtons()
    {
        var sb = new StringBuilder("[BattleHud] buttons");
        Append(sb, "attack", attack);
        Append(sb, "special", special);
        Append(sb, "defend", defend);
        Append(sb, "wait", wait);
        if (undo.gameObject.activeSelf) Append(sb, "undo", undo);
        Debug.Log(sb.ToString());
    }

    private static readonly Vector3[] corners = new Vector3[4];

    private static void Append(StringBuilder sb, string name, Button b)
    {
        var rt = b.GetComponent<RectTransform>();
        rt.GetWorldCorners(corners);
        sb.Append($" {name}=({corners[0].x:F0},{corners[0].y:F0},{corners[2].x - corners[0].x:F0},{corners[2].y - corners[0].y:F0})");
    }
}
