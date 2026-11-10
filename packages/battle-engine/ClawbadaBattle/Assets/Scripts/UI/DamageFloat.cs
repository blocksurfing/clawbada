using UnityEngine;
using UnityEngine.UI;

/// <summary>Floating combat number (hit feel, owner 2026-11-09): pops in larger and settles, hops up on an ease-out arc with a
/// small settle, and blinks out over its last 0.3 s instead of fading. <c>pop</c> is the starting scale (1 = none);
/// <c>blink</c> off keeps the old soft fade (heals, status words).</summary>
public class DamageFloat : MonoBehaviour
{
    private RectTransform rt;
    private Text text;
    private Outline outline;
    private Vector2 start;
    private float rise, duration, t;
    private Color color;
    private float pop = 1f;
    private bool blink;
    private const float PopSeconds = 0.1f, BlinkSeconds = 0.3f, BlinkHz = 12f, SettleFraction = 0.1f;

    public static DamageFloat Spawn(RectTransform layer, HudSkin skin, Vector2 canvasPos, string label, Color color, int fontSize, float pop = 1f, bool blink = false)
    {
        var textRt = HudFactory.Rect(layer, "Float", HudFactory.Center, HudFactory.Center, HudFactory.Center, canvasPos, new Vector2(240f, 70f));   // room for a 60-unit crit
        var f = textRt.gameObject.AddComponent<DamageFloat>();
        f.rt = textRt;
        f.text = HudFactory.AddText(textRt, skin.PixelFontOrDefault(), fontSize, color, TextAnchor.MiddleCenter);
        f.text.text = label;
        f.outline = textRt.GetComponent<Outline>();
        f.start = canvasPos;
        f.rise = skin.floatRise;
        f.duration = Mathf.Max(0.2f, skin.floatSeconds);
        f.color = color;
        f.pop = Mathf.Max(1f, pop);
        f.blink = blink;
        textRt.localScale = Vector3.one * f.pop;
        return f;
    }

    void Update()
    {
        t += Time.deltaTime;
        float p = Mathf.Clamp01(t / duration);
        // Pop: from `pop` down to 1 in the first 0.1 s (ease-out).
        float k = Mathf.Clamp01(t / PopSeconds);
        rt.localScale = Vector3.one * Mathf.Lerp(pop, 1f, 1f - (1f - k) * (1f - k));
        // Hop: up past the top by a little in the first half, settle back to it.
        float h = Mathf.Clamp01(p / 0.5f);
        float arc = 1f - (1f - h) * (1f - h) * (1f - h);
        float settle = p <= 0.5f ? 0f : Mathf.Sin(Mathf.Clamp01((p - 0.5f) / 0.5f) * Mathf.PI * 0.5f);
        rt.anchoredPosition = start + Vector2.up * (rise * (arc * (1f + SettleFraction) - SettleFraction * settle));
        float alpha;
        if (blink) { float left = duration - t; alpha = left > BlinkSeconds ? 1f : (Mathf.FloorToInt(left * BlinkHz * 2f) % 2 == 0 ? 1f : 0f); }
        else alpha = p < 0.6f ? 1f : 1f - (p - 0.6f) / 0.4f;
        text.color = new Color(color.r, color.g, color.b, alpha);
        if (outline != null) outline.effectColor = new Color(0f, 0f, 0f, 0.85f * alpha);
        if (t >= duration) Destroy(gameObject);
    }
}
