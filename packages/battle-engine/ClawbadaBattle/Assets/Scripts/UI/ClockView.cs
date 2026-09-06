using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Shot clock. Counts down locally from the remaining milliseconds React sends at
/// StartTurn (the server owns the real deadline and auto-Defends on expiry).
/// </summary>
public class ClockView : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public bool Running { get; private set; }
    public float RemainingSeconds => Running ? Mathf.Max(0f, deadline - Time.realtimeSinceStartup) : 0f;

    private HudSkin skin;
    private Image icon;
    private Text text;
    private float deadline;

    public static ClockView Create(Transform parent, string name, HudSkin skin, int fontSize)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, new Vector2(90f, 28f));
        var view = rt.gameObject.AddComponent<ClockView>();
        view.Rect = rt;
        view.skin = skin;
        view.icon = HudFactory.Image(rt, "Icon", skin.iconClock, Color.white, new Vector2(18f, 18f));
        view.icon.rectTransform.anchoredPosition = new Vector2(-30f, 0f);
        view.text = HudFactory.Text(rt, "Text", skin.FontOrDefault(), fontSize, skin.textPrimary, TextAnchor.MiddleLeft, new Vector2(60f, 28f));
        view.text.rectTransform.anchoredPosition = new Vector2(12f, 0f);
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
        text.text = Mathf.CeilToInt(remaining) + "s";
        bool danger = remaining * 1000f < skin.clockDangerMs;
        text.color = danger ? skin.clockDanger : skin.textPrimary;
        icon.color = danger ? skin.clockDanger : Color.white;
    }

    private void SetVisible(bool on)
    {
        icon.enabled = on;
        text.enabled = on;
    }
}
