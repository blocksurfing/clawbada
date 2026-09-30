using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Shot clock, top-left. Nzib's TimerCardUI (drop 25d2fbe, 2026-09-30): his hex frame, an outline hex that drains
/// clockwise from the top as the turn runs out (Image Filled / Radial360) and changes colour green → yellow → orange →
/// red, and the seconds in the middle. Without his prefab it falls back to the placeholder hex + number.
/// Counts down locally from the remaining milliseconds React sends at StartTurn (the server owns the real deadline and
/// auto-Defends on expiry). The drain needs the turn's whole budget, which the wire doesn't carry: it is the standard
/// shot clock (60 s) or the time left when the clock starts, whichever is larger (turn 1 carries a grace on top), so a
/// reconnect with 20 s left shows a third of the outline, not a full one. On the opponent's turn the card stays,
/// dimmed and empty.
/// </summary>
public class ClockView : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public bool Running { get; private set; }
    public float RemainingSeconds => Running ? Mathf.Max(0f, deadline - Time.realtimeSinceStartup) : 0f;
    /// <summary>The share of the turn's budget left (the outline's fill), 0..1.</summary>
    public float Fraction => Running && budget > 0f ? Mathf.Clamp01(RemainingSeconds / budget) : 0f;

    /// <summary>The server's standard shot clock (manager.ts DEFAULT_SHOT_CLOCK_MS).</summary>
    public const float StandardBudget = 60f;
    /// <summary>Outline colour by share left: green above [0], yellow above [1], orange above the danger seconds, else red.</summary>
    private static readonly float[] Steps = { 0.5f, 0.25f };

    private HudSkin skin;
    private Image hex, frame, indicator;
    private Text text;
    private float deadline, budget;

    public static ClockView Create(Transform parent, string name, HudSkin skin, float size, int fontSize)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, new Vector2(size, size));
        var view = rt.gameObject.AddComponent<ClockView>();
        view.Rect = rt;
        view.skin = skin;
        if (skin.timerCardPrefab != null)
        {
            // His card at design scale, scaled as a unit to the requested size (48 px → size).
            var card = (RectTransform)Instantiate(skin.timerCardPrefab, rt, false).transform;
            card.name = "TimerCardUI";
            card.anchorMin = card.anchorMax = card.pivot = HudFactory.Center;
            card.anchoredPosition = Vector2.zero;
            float k = size / Mathf.Max(1f, card.sizeDelta.x);
            card.localScale = new Vector3(k, k, 1f);
            view.frame = card.Find("Frame")?.GetComponent<Image>();
            view.indicator = card.Find("Indicator")?.GetComponent<Image>();
            view.text = card.Find("Number")?.GetComponent<Text>();
            if (view.text != null)
            {
                // His note: the numeral reads blurry beside the pixel art. A 16 px Silkscreen scaled ×k is resampled,
                // and the saved style is Bold (synthesised, off the 8 px grid). Undo the card's scale on the text and
                // render it at its on-screen size instead, in the regular weight; the outline keeps its 1 art-pixel.
                var trt = view.text.rectTransform;
                trt.localScale = new Vector3(1f / k, 1f / k, 1f);
                trt.sizeDelta *= k;
                view.text.fontSize = Mathf.RoundToInt(view.text.fontSize * k / 8f) * 8;   // stay on Silkscreen's 8 px grid
                view.text.fontStyle = FontStyle.Normal;
                view.text.font = skin.PixelFontOrDefault();
                var outline = view.text.GetComponent<Outline>();
                if (outline != null) outline.effectDistance = new Vector2(k, -k);
            }
        }
        if (view.text == null)
        {
            view.hex = HudFactory.AddImage(rt, skin.timerHex != null ? skin.timerHex : skin.hexBevel, Color.white);
            view.text = HudFactory.Text(rt, "Text", skin.PixelFontOrDefault(), fontSize, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(size, size));
            view.text.rectTransform.anchoredPosition = new Vector2(0.5f, 0.5f);
        }
        view.SetVisible(false);
        return view;
    }

    public void StartClock(int remainingMs)
    {
        float remaining = Mathf.Max(0, remainingMs) / 1000f;
        // A late deadline for the same turn (turn 1 announced before the server starts it) must not shrink the budget.
        budget = Running ? Mathf.Max(budget, remaining) : Mathf.Max(StandardBudget, remaining);
        deadline = Time.realtimeSinceStartup + remaining;
        Running = true;
        SetVisible(true);
        Tick();
    }

    public void StopClock()
    {
        Running = false;
        budget = 0f;
        SetVisible(false);
    }

    void Update()
    {
        if (Running) Tick();
    }

    private void Tick()
    {
        float remaining = RemainingSeconds;
        text.text = Mathf.CeilToInt(remaining).ToString();
        bool danger = remaining * 1000f < skin.clockDangerMs;
        if (indicator != null)
        {
            float f = Fraction;
            indicator.fillAmount = f;
            int state = danger ? 3 : f > Steps[0] ? 0 : f > Steps[1] ? 1 : 2;
            var sp = skin.timerIndicators != null && state < skin.timerIndicators.Length ? skin.timerIndicators[state] : null;
            if (sp != null && indicator.sprite != sp) indicator.sprite = sp;   // swapping keeps the fill (his handoff)
            text.color = Color.white;
        }
        else text.color = danger ? skin.clockDanger : skin.textPrimary;
    }

    private void SetVisible(bool on)
    {
        text.enabled = on;
        var dim = on ? Color.white : new Color(1f, 1f, 1f, 0.55f);
        if (hex != null) hex.color = dim;
        if (frame != null) frame.color = dim;
        if (indicator != null) { indicator.enabled = on; if (!on) indicator.fillAmount = 0f; }
    }
}
