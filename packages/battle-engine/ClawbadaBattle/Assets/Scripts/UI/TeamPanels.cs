using System.Collections.Generic;
using System.Text;
using UnityEngine;

/// <summary>
/// The six team panels of Nzib's layout (user 2026-09-28, replacing the ATB turn strip): the player's three lobsters
/// along the bottom-left, the opponents' three along the top-right (a spectator sees side A at the bottom), each an
/// ActivePanel built on his AvatarUI prefab.
///   • The lobster acting now pulses with his outline (white); the selected-but-unconfirmed target pulses orange.
///   • Every living lobster carries its place in the upcoming turn order (1 = acting now). This is the order the
///     turn strip showed and the API returns: turn order is computable from public state, so humans get exactly
///     what agents see rather than agents being cut down to what the screen shows.
/// </summary>
public class TeamPanels : MonoBehaviour
{
    public const float Gap = 6f;
    public const float Edge = 10f;

    private readonly Dictionary<string, ActivePanel> byId = new();
    private readonly List<ActivePanel> all = new();
    private HudSkin skin;
    private PortraitSnapshot portraits;
    private RectTransform root;
    private string turnId = "", targetId = "";
    private string lastOrderDesc = "";

    /// <summary>Upcoming turn order used for the numbers: acting lobster first, then each living lobster once.</summary>
    public IReadOnlyList<string> CurrentOrder => order;
    private readonly List<string> order = new();

    public static TeamPanels Create(Transform parent, HudSkin skin, PortraitSnapshot portraits)
    {
        var rt = HudFactory.Stretch(parent, "TeamPanels");
        var t = rt.gameObject.AddComponent<TeamPanels>();
        t.root = rt;
        t.skin = skin;
        t.portraits = portraits;
        return t;
    }

    public ActivePanel PanelFor(string lobsterId) => lobsterId != null && byId.TryGetValue(lobsterId, out var p) ? p : null;
    public IReadOnlyList<ActivePanel> Panels => all;

    /// <param name="bottomSide">The side shown along the bottom (the player's; "A" for spectators).</param>
    public void Bind(IEnumerable<LobsterController> lobsters, string bottomSide)
    {
        foreach (var p in all) if (p != null) Destroy(p.gameObject);
        all.Clear();
        byId.Clear();
        turnId = targetId = "";
        order.Clear();

        var bottom = new List<LobsterController>();
        var top = new List<LobsterController>();
        foreach (var lob in lobsters)
        {
            if (lob == null) continue;
            (lob.side == bottomSide ? bottom : top).Add(lob);
        }
        float pitch = ActivePanel.Width + Gap;
        // Bottom row from the left edge; top row ends at the right edge. Slot order left to right in both.
        for (int i = 0; i < bottom.Count; i++)
            Add(bottom[i], $"Panel_{bottom[i].lobsterId}", Vector2.zero, new Vector2(Edge + i * pitch, Edge));
        for (int i = 0; i < top.Count; i++)
            Add(top[i], $"Panel_{top[i].lobsterId}", Vector2.one, new Vector2(-(Edge + (top.Count - 1 - i) * pitch), -Edge));
        Debug.Log($"[BattleHud] team panels bottom={Describe(bottom)} top={Describe(top)}");
    }

    private void Add(LobsterController lob, string name, Vector2 corner, Vector2 pos)
    {
        var p = ActivePanel.Create(root, name, skin, portraits, corner, pos);
        p.Show(lob);
        all.Add(p);
        byId[lob.lobsterId] = p;
    }

    private static string Describe(List<LobsterController> l)
    {
        var sb = new StringBuilder();
        foreach (var x in l) { if (sb.Length > 0) sb.Append(','); sb.Append(x.lobsterId); }
        return sb.ToString();
    }

    /// <summary>The lobster acting now (white outline) and the upcoming bar (turn-order numbers).</summary>
    public void SetTurn(string activeId, BarEntryData[] upcoming)
    {
        turnId = activeId ?? "";
        order.Clear();
        if (!string.IsNullOrEmpty(turnId) && byId.TryGetValue(turnId, out var a) && a.Lobster != null && a.Lobster.alive) order.Add(turnId);
        if (upcoming != null)
            foreach (var e in upcoming)
            {
                if (e == null || string.IsNullOrEmpty(e.lobsterId) || order.Contains(e.lobsterId)) continue;
                if (byId.TryGetValue(e.lobsterId, out var p) && p.Lobster != null && p.Lobster.alive) order.Add(e.lobsterId);
            }
        foreach (var kv in byId) kv.Value.SetOrder(order.IndexOf(kv.Key) + 1);
        ApplyHighlights();
        string desc = string.Join(",", order);
        if (desc != lastOrderDesc) { lastOrderDesc = desc; Debug.Log($"[BattleHud] turn order [{desc}] acting={turnId}"); }
    }

    /// <summary>The selected-but-unconfirmed target (orange outline); "" clears it.</summary>
    public void SetTarget(string id)
    {
        targetId = id ?? "";
        ApplyHighlights();
    }

    private void ApplyHighlights()
    {
        foreach (var kv in byId)
        {
            var h = kv.Key == turnId ? ActivePanel.Highlight.Turn
                  : kv.Key == targetId ? ActivePanel.Highlight.Target
                  : ActivePanel.Highlight.None;
            if (kv.Value.Lobster == null || !kv.Value.Lobster.alive) h = ActivePanel.Highlight.None;
            kv.Value.SetHighlight(h);
        }
    }

    /// <summary>A death or a battle end: dead lobsters lose their number and outline.</summary>
    public void Refresh()
    {
        foreach (var p in all) p.Refresh();
    }

    public void ClearMarks()
    {
        turnId = targetId = "";
        foreach (var p in all) { p.SetHighlight(ActivePanel.Highlight.None); p.SetOrder(0); }
    }
}
