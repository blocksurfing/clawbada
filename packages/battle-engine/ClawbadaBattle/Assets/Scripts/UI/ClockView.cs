using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Shot clock, as a hex badge top-left (Nzib's layout, 2026-09-28; the hex is a placeholder in his style until he
/// draws it). Counts down locally from the remaining milliseconds React sends at StartTurn (the server owns the real
/// deadline and auto-Defends on expiry). On the opponent's turn the hex stays, dimmed and empty.
/// </summary>
public class ClockView : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public bool Running { get; private set; }
    public float RemainingSeconds => Running ? Mathf.Max(0f, deadline - Time.realtimeSinceStartup) : 0f;

    private HudSkin skin;
    private Image hex;
    private Text text;
    private float deadline;

    public static ClockView Create(Transform parent, string name, HudSkin skin, float size, int fontSize)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, new Vector2(size, size));
        var view = rt.gameObject.AddComponent<ClockView>();
        view.Rect = rt;
        view.skin = skin;
        view.hex = HudFactory.AddImage(rt, skin.timerHex != null ? skin.timerHex : skin.hexBevel, Color.white);
        view.text = HudFactory.Text(rt, "Text", skin.PixelFontOrDefault(), fontSize, skin.textPrimary, TextAnchor.MiddleCenter, new Vector2(size, size));
        view.text.rectTransform.anchoredPosition = new Vector2(0.5f, 0.5f);
        view.SetVisible(false);
        return view;
    }

    public void StartClock(int remainingMs)
    {
        deadline = Time.realtimeSinceStartup + Mathf.Max(0, remainingMs) / 1000f;
        Running = true;
        SetVisible(true);
        Tick();
    }

    public void StopClock()
    {
        Running = false;
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
        text.color = danger ? skin.clockDanger : skin.textPrimary;
    }

    private void SetVisible(bool on)
    {
        text.enabled = on;
        hex.color = on ? Color.white : new Color(1f, 1f, 1f, 0.55f);
    }
}
