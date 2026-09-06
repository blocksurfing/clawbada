using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// Code-first uGUI builders. The whole battle HUD is constructed at runtime from these
/// (no scene or prefab authoring), so every widget is made the same way: RectTransform
/// first, graphics with raycastTarget=false unless they are meant to be clicked.
/// </summary>
public static class HudFactory
{
    public static readonly Vector2 Center = new Vector2(0.5f, 0.5f);

    public static RectTransform Rect(Transform parent, string name, Vector2 anchorMin, Vector2 anchorMax, Vector2 pivot, Vector2 pos, Vector2 size)
    {
        var go = new GameObject(name, typeof(RectTransform));
        go.layer = parent.gameObject.layer;
        var rt = go.GetComponent<RectTransform>();
        rt.SetParent(parent, false);
        rt.anchorMin = anchorMin;
        rt.anchorMax = anchorMax;
        rt.pivot = pivot;
        rt.anchoredPosition = pos;
        rt.sizeDelta = size;
        return rt;
    }

    /// <summary>A rect that fills its parent.</summary>
    public static RectTransform Stretch(Transform parent, string name)
    {
        var rt = Rect(parent, name, Vector2.zero, Vector2.one, Center, Vector2.zero, Vector2.zero);
        rt.offsetMin = Vector2.zero;
        rt.offsetMax = Vector2.zero;
        return rt;
    }

    /// <summary>Centered image of a fixed size. Sliced when the sprite has a border.</summary>
    public static Image Image(Transform parent, string name, Sprite sprite, Color color, Vector2 size, bool raycast = false)
    {
        var rt = Rect(parent, name, Center, Center, Center, Vector2.zero, size);
        return AddImage(rt, sprite, color, raycast);
    }

    public static Image AddImage(RectTransform rt, Sprite sprite, Color color, bool raycast = false)
    {
        var img = rt.gameObject.AddComponent<Image>();
        img.sprite = sprite;
        img.color = color;
        img.raycastTarget = raycast;
        img.preserveAspect = false;
        if (sprite != null && sprite.border.sqrMagnitude > 0f) img.type = UnityEngine.UI.Image.Type.Sliced;
        return img;
    }

    /// <summary>Legacy UI text with an outline so it reads on any arena.</summary>
    public static Text Text(Transform parent, string name, Font font, int size, Color color, TextAnchor anchor, Vector2 rectSize, bool outline = true)
    {
        var rt = Rect(parent, name, Center, Center, Center, Vector2.zero, rectSize);
        return AddText(rt, font, size, color, anchor, outline);
    }

    public static Text AddText(RectTransform rt, Font font, int size, Color color, TextAnchor anchor, bool outline = true)
    {
        var t = rt.gameObject.AddComponent<Text>();
        t.font = font;
        t.fontSize = size;
        t.color = color;
        t.alignment = anchor;
        t.raycastTarget = false;
        t.supportRichText = false;
        t.horizontalOverflow = HorizontalWrapMode.Overflow;
        t.verticalOverflow = VerticalWrapMode.Overflow;
        if (outline)
        {
            var o = rt.gameObject.AddComponent<Outline>();
            o.effectColor = new Color(0f, 0f, 0f, 0.85f);
            o.effectDistance = new Vector2(1f, -1f);
        }
        return t;
    }

    /// <summary>Hex-shaped button: background (clickable) + icon + small label under it.</summary>
    public static Button Button(Transform parent, string name, Sprite bg, Sprite icon, string label, Font font, float size, UnityAction onClick)
    {
        var rt = Rect(parent, name, Center, Center, Center, Vector2.zero, new Vector2(size, size * 1.143f));
        var bgImg = AddImage(rt, bg, Color.white, raycast: true);
        var btn = rt.gameObject.AddComponent<Button>();
        btn.targetGraphic = bgImg;
        var colors = btn.colors;
        colors.highlightedColor = new Color(1f, 1f, 0.85f, 1f);
        colors.pressedColor = new Color(0.8f, 0.8f, 0.8f, 1f);
        colors.disabledColor = new Color(0.5f, 0.5f, 0.5f, 0.5f);
        btn.colors = colors;
        btn.onClick.AddListener(onClick);

        if (icon != null)
        {
            var ic = Image(rt, "Icon", icon, Color.white, new Vector2(size * 0.45f, size * 0.45f));
            ic.rectTransform.anchoredPosition = new Vector2(0f, size * 0.12f);
        }
        var txt = Text(rt, "Label", font, Mathf.RoundToInt(size * 0.17f), Color.white, TextAnchor.MiddleCenter, new Vector2(size * 1.4f, size * 0.3f));
        txt.rectTransform.anchoredPosition = new Vector2(0f, -size * 0.33f);
        txt.text = label;
        return btn;
    }

    /// <summary>Screen-space overlay canvas scaled to a 16:9 reference resolution.</summary>
    public static Canvas Canvas(string name, int sortingOrder, Vector2 reference, float match, float referencePixelsPerUnit)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        go.layer = LayerMask.NameToLayer("UI");
        var canvas = go.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = sortingOrder;
        canvas.pixelPerfect = false;
        var scaler = go.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = reference;
        scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
        scaler.matchWidthOrHeight = match;
        scaler.referencePixelsPerUnit = referencePixelsPerUnit;
        return canvas;
    }

    /// <summary>uGUI buttons need an EventSystem; the project uses the legacy input manager.</summary>
    public static void EnsureEventSystem()
    {
        if (EventSystem.current != null) return;
        if (Object.FindFirstObjectByType<EventSystem>() != null) return;
        var go = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
        go.layer = LayerMask.NameToLayer("UI");
    }
}
