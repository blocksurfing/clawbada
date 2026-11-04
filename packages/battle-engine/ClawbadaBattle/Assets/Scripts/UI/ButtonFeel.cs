using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// Drives Nzib's ActionButtonUI Animator (drop 28c11f5) from input + selection, per his handoff:
///   pointer down            → "Pressed" (frame cell 2, the Visual one design pixel down);
///   release / leave         → back to the resting state;
///   resting state           → "Selected" (looping shine) while this action is armed, else "Hover" while the pointer
///                             rests on a live button (his authored hover frame, drop 107c18b), else "Normal".
/// A press that is released outside does not select; selection only comes from React (ActionBar.Apply → SetArmed).
/// With his cluster (drop 107c18b) hover is his own Hover state; the older single-button art had none, so a soft halo image
/// (glow) stands in when one is set. Disabled buttons rest at Normal and never react.
/// </summary>
public class ButtonFeel : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler, IPointerDownHandler, IPointerUpHandler
{
    public Image glow;
    public Animator animator;
    public Color hoverGlow = new Color(1f, 1f, 0.9f, 0.55f);
    /// <summary>Played once when the pointer comes onto a live (interactable) button — its hover click
    /// (user 2026-09-30: SFX_UI_Hover_Attack / _Special / _Defend / _Wait). Null = silent.</summary>
    public System.Action onHover;

    private Selectable sel;
    private bool over, down, armed, keyDown;
    private string state = "";

    void Awake() => sel = GetComponent<Selectable>();

    /// <summary>True when the animator has an authored Hover state (Nzib's cluster); else hover is the glow image only.</summary>
    private bool hasHover => animator != null && animator.isActiveAndEnabled
        && (animator.HasState(0, HoverPathHash) || animator.HasState(0, HoverHash));
    private static readonly int HoverHash = Animator.StringToHash("Hover");
    private static readonly int HoverPathHash = Animator.StringToHash("Base Layer.Hover");

    /// <summary>The animator's controller was swapped (the Special button follows the acting class): replay the current state.</summary>
    public void Resync()
    {
        state = "";
        Apply();
    }

    void OnEnable() { state = ""; Apply(); }
    void OnDisable() { over = down = keyDown = false; }

    public void SetArmed(bool on)
    {
        armed = on;
        Apply();
    }

    /// <summary>The button's hotkey is held (ActionBar): shows Pressed, like a held pointer.</summary>
    public void SetKeyDown(bool on)
    {
        if (on == keyDown) return;
        keyDown = on;
        Apply();
    }

    public void OnPointerEnter(PointerEventData e)
    {
        over = true;
        Apply();
        if (sel == null || sel.interactable) onHover?.Invoke();   // only a button that lights up clicks
    }
    public void OnPointerExit(PointerEventData e) { over = false; down = false; Apply(); }
    public void OnPointerDown(PointerEventData e) { down = true; Apply(); }
    public void OnPointerUp(PointerEventData e) { down = false; Apply(); }

    void Update()
    {
        // Interactable can flip while the pointer rests on the button (a turn ends under it).
        if ((over || down) && sel != null && !sel.interactable) Apply();
    }

    private void Apply()
    {
        bool live = sel == null || sel.interactable;
        string want = live && (down || keyDown) ? "Pressed" : live && armed ? "Selected" : live && over && hasHover ? "Hover" : "Normal";
        if (animator != null && animator.isActiveAndEnabled && want != state)
        {
            animator.Play(want, 0, 0f);
            state = want;
        }
        if (glow != null)
        {
            glow.enabled = live && over && !down;
            glow.color = hoverGlow;
        }
    }
}
