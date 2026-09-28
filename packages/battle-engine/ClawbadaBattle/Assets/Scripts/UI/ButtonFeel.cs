using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// Nzib's button feel (2026-09-27): hover = a subtle glow and 1–2 px larger; press = 1–2 px smaller and a
/// little darker. Scales the button's own rect (so plate, frame and glow move together) and shows the glow
/// image; the Button's colour tint darkens the plate on press. Disabled buttons never react.
/// </summary>
public class ButtonFeel : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler, IPointerDownHandler, IPointerUpHandler
{
    public Image glow;
    /// <summary>Glow colour on hover; ActionBar also drives the glow for the armed action.</summary>
    public Color hoverGlow = new Color(1f, 1f, 0.9f, 0.55f);
    /// <summary>Scale step for "1–2 px" at the button's size (set by the owner).</summary>
    public float step = 0.04f;

    private Selectable sel;
    private bool over, down;
    /// <summary>Armed = its own glow colour, always on (the ActionBar's selection).</summary>
    private bool armed;
    private Color armedGlow;

    void Awake() => sel = GetComponent<Selectable>();

    public void SetArmed(bool on, Color color)
    {
        armed = on;
        armedGlow = color;
        Apply();
    }

    public void OnPointerEnter(PointerEventData e) { over = true; Apply(); }
    public void OnPointerExit(PointerEventData e) { over = false; down = false; Apply(); }
    public void OnPointerDown(PointerEventData e) { down = true; Apply(); }
    public void OnPointerUp(PointerEventData e) { down = false; Apply(); }

    void OnDisable() { over = down = false; transform.localScale = Vector3.one; }

    void Update()
    {
        // Interactable can flip while the pointer rests on the button (a turn ends under it).
        if ((over || down) && sel != null && !sel.interactable) Apply();
    }

    private void Apply()
    {
        bool live = sel == null || sel.interactable;
        float s = !live ? 1f : down ? 1f - step : over ? 1f + step : 1f;
        transform.localScale = new Vector3(s, s, 1f);
        if (glow == null) return;
        bool hoverOn = live && over && !down;
        glow.enabled = armed || hoverOn;
        glow.color = armed ? armedGlow : hoverGlow;
    }
}
