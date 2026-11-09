using System;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Action buttons: Nzib's combined cluster (ActionButtonUI.prefab, drop 107c18b, 2026-11-04) bottom-right — a big
/// Attack, the acting lobster's own class Special above-left of it, Defend to its left. No Wait: it was always worse than
/// Defend (balance pass 2026-11-02; agents keep action "none" in the API). No text: his icons carry their glyphs. Each
/// child's Animator owns its frame and icon: Normal, Hover (pointer over a live button), Pressed while held, Selected
/// (looping shine) for the armed action — driven by ButtonFeel. The Special swaps to the class's override controller
/// (Fortify, Ambush, …), which animates frame AND icon. There is no Undo button, and moves are touch-move (user
/// 2026-09-30): the first tap on a hex picks it (pulsing), a second tap commits the move for good; the hint line says so.
/// Unity only reports presses; React decides what they mean and submits the turn. Its state (which action is armed,
/// what is legal) arrives through Apply. One line above the buttons says why a press went nowhere ("Out of range — move
/// closer first", a server rejection) and shows "Sending…" — inside the canvas, because in fullscreen React's status row
/// is off screen and a silent press reads as a frozen game. That line sits bottom-right (user 2026-09-27) and can be
/// switched off in the options menu (HintsEnabled, remembered in PlayerPrefs); "Sending…" and server errors always show.
/// </summary>
public class ActionBar : MonoBehaviour
{
    public event Action<string> ActionPressed;
    /// <summary>True while something modal (the options menu) owns the keyboard: hotkeys do nothing.</summary>
    public Func<bool> KeysBlocked;

    /// <summary>Canvas units per art pixel: the 960x540 canvas over the 640x360 art frame.</summary>
    public const float ArtScale = 1.5f;
    private const string CancelMoveHint = "Tap the hex again to move there. Moves are final";
    private const string HintsPref = "clawbada.hints";
    /// <summary>Click areas, art px: the opaque frame of each button (his README: Attack 76×83, the shared frame 42×47).
    /// The children's canvases are larger and overlap; the hit areas follow what is drawn.</summary>
    private static readonly Vector2 AttackHit = new Vector2(76f, 83f), SmallHit = new Vector2(42f, 47f);
    /// <summary>The drawn extent of his cluster and its centre in his 192×192 box, art px.</summary>
    private static readonly Vector2 ClusterArt = new Vector2(144f, 134f), ClusterCentreArt = new Vector2(0f, -3f);

    /// <summary>Game hints on/off (options menu). Off keeps only "Sending…" and errors.</summary>
    public static bool HintsEnabled
    {
        get { return PlayerPrefs.GetInt(HintsPref, 1) == 1; }
        set { PlayerPrefs.SetInt(HintsPref, value ? 1 : 0); PlayerPrefs.Save(); }
    }

    private HudSkin skin;
    private Button attack, special, defend;
    private ButtonFeel attackFeel, specialFeel, defendFeel;
    private CanvasGroup attackGroup, specialGroup, defendGroup;
    private Animator specialAnimator;
    private Text hint;
    private string lastNote = "";
    private int actorClass = -1;
    private SelectionData lastSel;

    /// <summary>Size of the whole cluster in canvas units (for the owner's layout).</summary>
    public float Width { get; private set; }
    public float Height { get; private set; }
    public float ButtonHeight { get; private set; }

    /// <summary>Move the hint line's bottom-right corner (from the canvas's bottom-right).</summary>
    public void PlaceHint(Vector2 bottomRight) => hint.rectTransform.anchoredPosition = bottomRight;

    /// <param name="hintBottomRight">Where the hint line's bottom-right corner sits, from the canvas's bottom-right.</param>
    /// <param name="bottomRight">Where the cluster's bottom-right corner sits, from the canvas's bottom-right.</param>
    public static ActionBar Create(Transform parent, HudSkin skin, Vector2 bottomRight, Vector2 hintBottomRight)
    {
        var corner = new Vector2(1f, 0f);
        // The bar is the area his three buttons actually cover — 144×134 art px of his 192×192 box (children at
        // Attack (24,−22) 96², Special (−10,32) 64², Defend (−40,−20) 64²; drawn x −72..72, y −70..64) — so the cluster
        // keeps the old corner instead of floating ~24 px in from it.
        var rt = HudFactory.Rect(parent, "ActionBar", corner, corner, corner, bottomRight, ClusterArt * ArtScale);
        var bar = rt.gameObject.AddComponent<ActionBar>();
        bar.skin = skin;
        bar.Width = rt.sizeDelta.x;
        bar.Height = rt.sizeDelta.y;
        bar.ButtonHeight = 96f * ArtScale;
        if (skin.actionButtonPrefab == null) Debug.LogError("[BattleHud] HudSkin.actionButtonPrefab is not bound — run Clawbada ▸ HUD ▸ Bind Nzib HUD Art");
        else
        {
            var ui = (RectTransform)Instantiate(skin.actionButtonPrefab, rt, false).transform;
            ui.name = "ActionButtonUI";
            ui.anchorMin = ui.anchorMax = ui.pivot = HudFactory.Center;
            ui.anchoredPosition = -ClusterCentreArt * ArtScale;
            ui.localScale = new Vector3(ArtScale, ArtScale, 1f);
            // Hit areas last, so they sit above his art; the Special's last of all — it wins where frames overlap.
            bar.attack = bar.Wire(ui, "Attack", AttackHit, () => bar.Press("attack"), out bar.attackFeel, out bar.attackGroup, out _);
            bar.defend = bar.Wire(ui, "Defend", SmallHit, () => bar.Press("defend"), out bar.defendFeel, out bar.defendGroup, out _);
            bar.special = bar.Wire(ui, "Special", SmallHit, () => bar.Press("special"), out bar.specialFeel, out bar.specialGroup, out bar.specialAnimator);
            bar.attackFeel.onHover = () => BattleSfx.PlayUiHover("attack");
            bar.specialFeel.onHover = () => BattleSfx.PlayUiHover("special");
            bar.defendFeel.onHover = () => BattleSfx.PlayUiHover("defend");
        }

        // On the canvas, not the row: bottom-right, right-aligned so long lines grow leftwards.
        // Upheaval at 20 art px (Nzib 2026-11-09): long hints wrap into a compact block at the right edge, growing upwards
        // (at 560 wide a two-line hint reached the middle of the board and ran over Master Lob's bubble).
        bar.hint = HudFactory.Text(parent, "Hint", skin.FontOrDefault(), HudSkin.HudPx(HudSkin.UpheavalPx), skin.textPrimary, TextAnchor.LowerRight, new Vector2(360f, 24f));
        bar.hint.horizontalOverflow = HorizontalWrapMode.Wrap;
        bar.hint.verticalOverflow = VerticalWrapMode.Overflow;
        var hrt = bar.hint.rectTransform;
        hrt.anchorMin = hrt.anchorMax = hrt.pivot = new Vector2(1f, 0f);
        hrt.anchoredPosition = hintBottomRight;
        bar.hint.gameObject.SetActive(false);

        rt.gameObject.SetActive(false);
        return bar;
    }

    /// <summary>One of his three children: a stationary, invisible click area over its frame (his Pressed state moves only
    /// the Visual inside), the Button, and the ButtonFeel that drives the child's Animator. The child carries the CanvasGroup
    /// that dims it while the action is not available.</summary>
    private Button Wire(RectTransform cluster, string child, Vector2 hitArt, UnityEngine.Events.UnityAction onClick,
        out ButtonFeel feel, out CanvasGroup group, out Animator animator)
    {
        var art = cluster.Find(child) as RectTransform;
        animator = art != null ? art.GetComponent<Animator>() : null;
        if (art == null) Debug.LogError($"[BattleHud] ActionButtonUI has no {child} child — Nzib's cluster prefab expected (drop 107c18b)");
        group = art != null ? (art.GetComponent<CanvasGroup>() ?? art.gameObject.AddComponent<CanvasGroup>()) : null;
        if (group != null) { group.interactable = false; group.blocksRaycasts = false; }   // the hit area takes the input

        var hit = HudFactory.Rect(cluster, child + "Hit", HudFactory.Center, HudFactory.Center, HudFactory.Center,
            art != null ? art.anchoredPosition : Vector2.zero, hitArt);
        var img = HudFactory.AddImage(hit, null, new Color(1f, 1f, 1f, 0f), raycast: true);

        var btn = hit.gameObject.AddComponent<Button>();
        btn.targetGraphic = img;
        btn.transition = Selectable.Transition.None;   // his Animator is the only thing that draws the frame
        btn.navigation = new Navigation { mode = Navigation.Mode.None };
        btn.onClick.AddListener(onClick);

        feel = hit.gameObject.AddComponent<ButtonFeel>();
        feel.animator = animator;
        return btn;
    }

    /// <summary>The Special button is the acting lobster's own (Fortify, Ambush, …): its override controller.</summary>
    public void SetActorClass(int classId)
    {
        if (classId == actorClass) return;
        actorClass = classId;
        var controller = skin.SpecialController(classId);
        if (controller == null || specialAnimator == null) return;
        specialAnimator.runtimeAnimatorController = controller;
        specialFeel?.Resync();
    }

    // Hotkeys (Nzib's suggestion, owner 2026-11-01): 1–3 and A/S/D press the three buttons exactly like a click (the
    // button shows Pressed while the key is held); Space/Enter confirms — the second tap on a selected target or a
    // picked move hex. React decides what a press means, as for clicks. (4/W pressed Wait until it was removed.)
    private static readonly KeyCode[] AttackKeys = { KeyCode.Alpha1, KeyCode.Keypad1, KeyCode.A };
    private static readonly KeyCode[] SpecialKeys = { KeyCode.Alpha2, KeyCode.Keypad2, KeyCode.S };
    private static readonly KeyCode[] DefendKeys = { KeyCode.Alpha3, KeyCode.Keypad3, KeyCode.D };
    private static readonly KeyCode[] ConfirmKeys = { KeyCode.Space, KeyCode.Return, KeyCode.KeypadEnter };

    void Update()
    {
        if (attack == null) return;
        bool blocked = lastSel == null || !lastSel.isPlayerTurn || (KeysBlocked != null && KeysBlocked());
        Hotkey(attackFeel, attack, "attack", AttackKeys, blocked);
        Hotkey(specialFeel, special, "special", SpecialKeys, blocked);
        Hotkey(defendFeel, defend, "defend", DefendKeys, blocked);
        if (!blocked && lastSel.canAct && !lastSel.pendingAck && AnyDown(ConfirmKeys)) Press("confirm");
    }

    private void Hotkey(ButtonFeel feel, Button b, string action, KeyCode[] keys, bool blocked)
    {
        bool live = !blocked && b.interactable;
        bool held = false;
        foreach (var k in keys) held |= Input.GetKey(k);
        feel.SetKeyDown(live && held);
        if (live && AnyDown(keys)) Press(action);
    }

    private static bool AnyDown(KeyCode[] keys)
    {
        foreach (var k in keys) if (Input.GetKeyDown(k)) return true;
        return false;
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

        ShowHint(d);
        if (attack == null) return;
        bool live = d.canAct && !d.pendingAck;
        attack.interactable = live;
        special.interactable = live && d.canSpecial;
        defend.interactable = live;

        SetArmed(attackFeel, attack, attackGroup, d.action == "attack");
        SetArmed(specialFeel, special, specialGroup, d.action == "special");
        SetArmed(defendFeel, defend, defendGroup, d.action == "defend");

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
    private static void SetArmed(ButtonFeel feel, Button b, CanvasGroup group, bool armed)
    {
        feel.SetArmed(armed && b.interactable);
        if (group != null) group.alpha = b.interactable ? 1f : 0.45f;
    }

    /// <summary>Harness signal: button rects in screen pixels (x, y-from-bottom, w, h).</summary>
    private void LogButtons()
    {
        var sb = new StringBuilder("[BattleHud] buttons");
        Append(sb, "attack", attack);
        Append(sb, "special", special);
        Append(sb, "defend", defend);
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
