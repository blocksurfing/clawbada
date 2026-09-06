using UnityEngine;
using UnityEngine.UI;

/// <summary>Floating combat number: rises, fades over the last 40 %, destroys itself.</summary>
public class DamageFloat : MonoBehaviour
{
    private RectTransform rt;
    private Text text;
    private Outline outline;
    private Vector2 start;
    private float rise, duration, t;
    private Color color;

    public static DamageFloat Spawn(RectTransform layer, HudSkin skin, Vector2 canvasPos, string label, Color color, int fontSize)
    {
        var textRt = HudFactory.Rect(layer, "Float", HudFactory.Center, HudFactory.Center, HudFactory.Center, canvasPos, new Vector2(120f, 30f));
        var f = textRt.gameObject.AddComponent<DamageFloat>();
        f.rt = textRt;
        f.text = HudFactory.AddText(textRt, skin.FontOrDefault(), fontSize, color, TextAnchor.MiddleCenter);
        f.text.text = label;
        f.outline = textRt.GetComponent<Outline>();
        f.start = canvasPos;
        f.rise = skin.floatRise;
        f.duration = Mathf.Max(0.2f, skin.floatSeconds);
        f.color = color;
        return f;
    }

    void Update()
    {
        t += Time.deltaTime;
        float p = Mathf.Clamp01(t / duration);
        rt.anchoredPosition = start + Vector2.up * (rise * p);
        float alpha = p < 0.6f ? 1f : 1f - (p - 0.6f) / 0.4f;
        text.color = new Color(color.r, color.g, color.b, alpha);
        if (outline != null) outline.effectColor = new Color(0f, 0f, 0f, 0.85f * alpha);
        if (t >= duration) Destroy(gameObject);
    }
}
