using UnityEngine;
using UnityEngine.UI;

/// <summary>Horizontal HP bar: 9-sliced track, tinted fill, optional "hp/max" label.</summary>
public class HpBar : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    private HudSkin skin;
    private Image fill;
    private Text label;
    private Image[] segments;

    public static HpBar Create(Transform parent, string name, HudSkin skin, Vector2 size, bool withLabel, int labelSize = 11)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, size);
        var bar = rt.gameObject.AddComponent<HpBar>();
        bar.Rect = rt;
        bar.skin = skin;
        HudFactory.AddImage(rt, skin.barBg, Color.white);

        var fillRt = HudFactory.Rect(rt, "Fill", Vector2.zero, new Vector2(1f, 1f), Vector2.zero, Vector2.zero, Vector2.zero);
        fillRt.offsetMin = new Vector2(1f, 1f);
        fillRt.offsetMax = new Vector2(-1f, -1f);
        bar.fill = HudFactory.AddImage(fillRt, skin.barFill, skin.hpHigh);

        if (withLabel)
        {
            bar.label = HudFactory.Text(rt, "Label", skin.FontOrDefault(), labelSize, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(size.x * 1.5f, size.y + 8f));
        }
        return bar;
    }

    /// <summary>LOKR-style segmented bar: N cells, lit from the left, tinted by HP band.</summary>
    public static HpBar CreateSegmented(Transform parent, string name, HudSkin skin, Vector2 size, int count)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, size);
        var bar = rt.gameObject.AddComponent<HpBar>();
        bar.Rect = rt;
        bar.skin = skin;
        count = Mathf.Max(1, count);
        bar.segments = new Image[count];
        float gap = 1f;
        float w = (size.x - gap * (count - 1)) / count;
        for (int i = 0; i < count; i++)
        {
            var cellRt = HudFactory.Rect(rt, $"Seg{i}", new Vector2(0f, 0f), new Vector2(0f, 1f), new Vector2(0f, 0.5f), new Vector2(i * (w + gap), 0f), new Vector2(w, 0f));
            HudFactory.AddImage(cellRt, skin.segBg, Color.white);
            var fillRt = HudFactory.Stretch(cellRt, "Fill");
            fillRt.offsetMin = new Vector2(1f, 1f);
            fillRt.offsetMax = new Vector2(-1f, -1f);
            bar.segments[i] = HudFactory.AddImage(fillRt, skin.segFill, skin.hpHigh);
        }
        return bar;
    }

    public void Set(int hp, int max)
    {
        if (segments != null)
        {
            float f = max > 0 ? Mathf.Clamp01((float)hp / max) : 0f;
            int lit = hp > 0 ? Mathf.Max(1, Mathf.CeilToInt(f * segments.Length)) : 0;
            var c = skin.HpColor(hp, max);
            for (int i = 0; i < segments.Length; i++) { segments[i].enabled = i < lit; segments[i].color = c; }
            if (label != null) label.text = hp > 0 ? $"{hp}/{max}" : "KO";
            return;
        }
        float frac = max > 0 ? Mathf.Clamp01((float)hp / max) : 0f;
        var rt = fill.rectTransform;
        rt.anchorMax = new Vector2(frac, 1f);
        rt.offsetMin = new Vector2(1f, 1f);
        rt.offsetMax = new Vector2(frac > 0f ? -1f : 0f, -1f);
        fill.color = skin.HpColor(hp, max);
        fill.enabled = frac > 0f;
        if (label != null) label.text = hp > 0 ? $"{hp}/{max}" : "KO";
    }
}
