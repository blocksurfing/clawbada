using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// Drives Nzib's ActionButtonUI Animator (drop 28c11f5) from input + selection, per his handoff:
///   pointer down            → "Pressed" (frame cell 2, the Visual one design pixel down);
///   release / leave         → back to the resting state;
///   resting state           → "Selected" (looping shine) while this action is armed, else "Normal".
/// A press that is released outside does not select; selection only comes from React (ActionBar.Apply → SetArmed).
/// Hover shows a soft halo (a separate image — nothing else touches his Frame sprite). Disabled buttons rest at
/// Normal and never react.
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
    private bool over, down, armed;
    private string state = "";

    void Awake() => sel = GetComponent<Selectable>();

    void OnEnable() { state = ""; Apply(); }
    void OnDisable() { over = down = false; }

    public void SetArmed(bool on)
    {
        armed = on;
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
        string want = live && down ? "Pressed" : live && armed ? "Selected" : "Normal";
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
