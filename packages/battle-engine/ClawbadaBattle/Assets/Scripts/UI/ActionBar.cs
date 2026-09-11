using System;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Bottom-centre action bar (LOKR-style): hex buttons Attack / Special / Defend / Wait
/// and a small Undo for a tentative move. Unity only reports presses; React decides
/// what they mean and submits the turn. Its state (which action is armed, what is
/// legal) arrives through SetSelection. No prompt line: the armed plate, the lit hexes
/// and the target rings already say what to do, and React still shows "Sending…" in the
/// status row under the canvas.
/// </summary>
public class ActionBar : MonoBehaviour
{
    public event Action<string> ActionPressed;
    public event Action UndoPressed;

    private HudSkin skin;
    private Button attack, special, defend, wait, undo;
    private Image attackGlow, specialGlow, defendGlow, waitGlow;
    private Text specialLabel;
    private SelectionData last;

    public static ActionBar Create(Transform parent, HudSkin skin)
    {
        float s = skin.buttonSize;
        float pitch = s + 10f;
        var rt = HudFactory.Rect(parent, "ActionBar", new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), new Vector2(0.5f, 0f),
            new Vector2(0f, 8f), new Vector2(pitch * 4f + 70f, s * 1.143f + 10f));
        var bar = rt.gameObject.AddComponent<ActionBar>();
        bar.skin = skin;
        var font = skin.FontOrDefault();

        float x0 = -pitch * 1.5f - 20f;
        bar.attack = Make(bar, rt, "Attack", Plate(skin, skin.btnAttack), skin.iconAttack, "Attack", x0, () => bar.Press("attack"), out bar.attackGlow);
        bar.special = Make(bar, rt, "Special", Plate(skin, skin.btnSpecial), skin.iconSpecial, "Special", x0 + pitch, () => bar.Press("special"), out bar.specialGlow);
        bar.specialLabel = bar.special.transform.Find("Label").GetComponent<Text>();
        bar.defend = Make(bar, rt, "Defend", Plate(skin, skin.btnDefend), skin.iconDefend, "Defend", x0 + pitch * 2f, () => bar.Press("defend"), out bar.defendGlow);
        bar.wait = Make(bar, rt, "Wait", Plate(skin, skin.btnWait), skin.iconWait, "Wait", x0 + pitch * 3f, () => bar.Press("none"), out bar.waitGlow);

        bar.undo = HudFactory.Button(rt, "Undo", Plate(skin, skin.btnNeutral), skin.iconUndo, "Undo", font, s * 0.7f, () => bar.PressUndo());
        var urt = bar.undo.GetComponent<RectTransform>();
        urt.anchorMin = urt.anchorMax = new Vector2(0.5f, 0f);
        urt.pivot = new Vector2(0.5f, 0f);
        urt.anchoredPosition = new Vector2(x0 + pitch * 4f + 6f, 8f);

        rt.gameObject.SetActive(false);
        return bar;
    }

    /// <summary>Painted plate for an action, falling back to the placeholder bevel.</summary>
    private static Sprite Plate(HudSkin skin, Sprite plate) =>
        plate != null ? plate : skin.hexBevel != null ? skin.hexBevel : skin.hexButton64;

    private static Button Make(ActionBar bar, RectTransform rt, string name, Sprite plate, Sprite icon, string label, float x, UnityEngine.Events.UnityAction onClick, out Image glow)
    {
        var btn = HudFactory.Button(rt, name, plate, icon, label, bar.skin.FontOrDefault(), bar.skin.buttonSize, onClick);
        var brt = btn.GetComponent<RectTransform>();
        brt.anchorMin = brt.anchorMax = new Vector2(0.5f, 0f);
        brt.pivot = new Vector2(0.5f, 0f);
        brt.anchoredPosition = new Vector2(x, 0f);

        // Armed state is a warm ring straddling the plate edge instead of tinting the plate
        // (the painted faces are already coloured, so a tint just muddies them). Sorted first
        // so the glyph and caption stay on top. Sized from the sprites so it lines up exactly.
        glow = null;
        var ring = bar.skin.hexGlow;
        if (ring != null && plate != null)
        {
            float w = bar.skin.buttonSize * (ring.rect.width / plate.rect.width);
            float h = bar.skin.buttonSize * 1.143f * (ring.rect.height / plate.rect.height);
            glow = HudFactory.Image(btn.transform, "Glow", ring, Color.white, new Vector2(w, h));
            glow.transform.SetAsFirstSibling();
            glow.enabled = false;
        }
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
        SetArmed(attackGlow, d.action == "attack");
        SetArmed(specialGlow, d.action == "special");
        SetArmed(defendGlow, d.action == "defend");
        SetArmed(waitGlow, d.action == "none");

        Canvas.ForceUpdateCanvases();
        LogButtons();
    }

    private static void SetArmed(Image glow, bool armed)
    {
        if (glow != null) glow.enabled = armed;
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
