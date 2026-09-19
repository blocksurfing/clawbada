using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// The "tight" field health bar (LOKR): a chunky segmented bar in a dark slate frame with a
/// lighter rim, about the character's width, sitting just above its head — green for the
/// player's own lobster, red for an enemy. At most two lobsters carry one at a time — the enemy
/// the player's team hit last, and the unit under consideration as a target; everyone else
/// stays bare, and their health lives in the turn strip and the active panel. Charge pips, the
/// defending shield and status icons live on the strip cards. Positioned every LateUpdate by
/// BattleHud while shown; the frame's bottom edge sits on the anchor point.
/// </summary>
public class UnitOverlay : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }
    /// <summary>Whether BattleHud wants this bar on screen (the unit must also be alive).</summary>
    public bool Shown { get; private set; }

    private HudSkin skin;
    private HpBar bar;

    public static UnitOverlay Create(Transform parent, HudSkin skin)
    {
        Vector2 cells = skin.overlayBar;
        Vector2 frame = cells + new Vector2(8f, 8f);
        var rt = HudFactory.Rect(parent, "FieldBar", HudFactory.Center, HudFactory.Center, new Vector2(0.5f, 0f), Vector2.zero, frame + new Vector2(4f, 4f));
        var o = rt.gameObject.AddComponent<UnitOverlay>();
        o.Rect = rt;
        o.skin = skin;
        float y = frame.y * 0.5f;   // frame bottom on the anchor
        var rim = HudFactory.Image(rt, "Rim", skin.panelBg, skin.fieldBarRim, frame);
        rim.rectTransform.anchoredPosition = new Vector2(0f, y);
        var inner = HudFactory.Image(rt, "Frame", skin.panelBg, skin.fieldBarFrame, frame - new Vector2(2f, 2f));
        inner.rectTransform.anchoredPosition = new Vector2(0f, y);
        o.bar = HpBar.CreateSegmented(rt, "Hp", skin, cells, skin.hpSegments);
        o.bar.Rect.anchoredPosition = new Vector2(0f, y);
        rt.gameObject.SetActive(false);
        return o;
    }

    /// <param name="friendly">On the player's side → green cells; otherwise red (LOKR's read).</param>
    public void Bind(LobsterController lob, bool friendly)
    {
        Lobster = lob;
        bar.SetTint(friendly ? skin.fieldBarFriend : skin.fieldBarEnemy);
        Refresh();
    }

    /// <summary>Kept for callers that marked the acting unit here; the world-space ActiveMarker does that.</summary>
    public void SetActive(bool active) { }

    public void SetShown(bool shown)
    {
        Shown = shown;
        Refresh();
    }

    public void Refresh()
    {
        var lob = Lobster;
        bool on = Shown && lob != null && lob.alive;
        if (gameObject.activeSelf != on) gameObject.SetActive(on);
        if (on) bar.Set(lob.currentHp, lob.maxHp);
    }
}
