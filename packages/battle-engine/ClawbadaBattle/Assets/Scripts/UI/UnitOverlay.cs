using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// The "tight" field health bar (LOKR): a small framed, segmented HP bar hugging one lobster.
/// At most two lobsters carry one at a time — the enemy the player's team hit last, and the
/// unit under consideration as a target; everyone else stays bare, and their health lives in
/// the turn strip and the active panel. Charge pips, the defending shield and status icons
/// moved to the strip cards. Positioned every LateUpdate by BattleHud while shown.
/// </summary>
public class UnitOverlay : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }
    /// <summary>Whether BattleHud wants this bar on screen (the unit must also be alive).</summary>
    public bool Shown { get; private set; }

    private HpBar bar;

    public static UnitOverlay Create(Transform parent, HudSkin skin)
    {
        var rt = HudFactory.Rect(parent, "FieldBar", HudFactory.Center, HudFactory.Center, new Vector2(0.5f, 0f), Vector2.zero, new Vector2(64f, 16f));
        var o = rt.gameObject.AddComponent<UnitOverlay>();
        o.Rect = rt;
        // A dark plate behind the segments so the bar reads on any arena floor.
        var plate = HudFactory.Image(rt, "Plate", skin.panelBg, new Color(0.03f, 0.06f, 0.1f, 0.88f), skin.overlayBar + new Vector2(8f, 6f));
        plate.rectTransform.anchoredPosition = new Vector2(0f, 6f);
        o.bar = HpBar.CreateSegmented(rt, "Hp", skin, skin.overlayBar, 6);
        o.bar.Rect.anchoredPosition = new Vector2(0f, 6f);
        rt.gameObject.SetActive(false);
        return o;
    }

    public void Bind(LobsterController lob)
    {
        Lobster = lob;
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
