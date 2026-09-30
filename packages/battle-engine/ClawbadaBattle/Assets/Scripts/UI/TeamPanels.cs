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
///   • Each row is ordered by that turn order (Nzib 2026-09-30: "horizontal slide effect when the avatar card switching
///     order … add ease in out"): left to right, the lobster acting soonest first, the dead last; when the order
///     changes the cards slide sideways into their new places with an ease-in-out.
/// </summary>
public class TeamPanels : MonoBehaviour
{
    /// <summary>Margin of the other corner widgets (buttons, settings, timer) from the canvas edges.</summary>
    public const float Edge = 10f;

    // Nzib's layout (2026-09-29 target shot). Measured on his art: Avatar_Frame's PAINTED pixels span x 7–104,
    // y 9–55 of its 112×64 cell, so panels are placed by their visible art, not their padded rect.
    private const float ArtLeft = 7f, ArtRight = 8f, ArtTop = 9f, ArtBottom = 9f;   // design px of padding
    /// <summary>3 design px between the painted art of neighbouring panels (Nzib: "3px away between card").</summary>
    private const float VisibleGap = 3f;
    /// <summary>Canvas units from the screen edge to the painted art: bottom row (left, bottom), top row (right, top).</summary>
    private static readonly Vector2 BottomInset = new Vector2(35f, 17f), TopInset = new Vector2(8f, 9f);

    private readonly Dictionary<string, ActivePanel> byId = new();
    private readonly List<ActivePanel> all = new();
    // The two rows: their panels in slot order and the fixed places (left to right) the panels are sorted into.
    private readonly List<ActivePanel> bottomRow = new(), topRow = new();
    private readonly List<Vector2> bottomSlots = new(), topSlots = new();
    private readonly Dictionary<ActivePanel, Coroutine> slides = new();
    /// <summary>How long a card takes to slide to its new place (ease-in-out).</summary>
    public const float SlideSeconds = 0.35f;
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
        bottomRow.Clear(); topRow.Clear(); bottomSlots.Clear(); topSlots.Clear(); slides.Clear();
        turnId = targetId = "";
        order.Clear();

        var bottom = new List<LobsterController>();
        var top = new List<LobsterController>();
        foreach (var lob in lobsters)
        {
            if (lob == null) continue;
            (lob.side == bottomSide ? bottom : top).Add(lob);
        }
        float k = ActionBar.ArtScale;
        float pitch = (112f - ArtLeft - ArtRight + VisibleGap) * k;
        // Bottom row from the left edge; top row ends at the right edge. Slot order left to right in both.
        var b0 = new Vector2(BottomInset.x - ArtLeft * k, BottomInset.y - ArtBottom * k);
        for (int i = 0; i < bottom.Count; i++)
        {
            var at = new Vector2(b0.x + i * pitch, b0.y);
            bottomSlots.Add(at);
            bottomRow.Add(Add(bottom[i], $"Panel_{bottom[i].lobsterId}", Vector2.zero, at));
        }
        var t0 = new Vector2(-(TopInset.x - ArtRight * k), -(TopInset.y - ArtTop * k));
        for (int i = 0; i < top.Count; i++)
        {
            var at = new Vector2(t0.x - (top.Count - 1 - i) * pitch, t0.y);
            topSlots.Add(at);
            topRow.Add(Add(top[i], $"Panel_{top[i].lobsterId}", Vector2.one, at));
        }
        Debug.Log($"[BattleHud] team panels bottom={Describe(bottom)} top={Describe(top)}");
    }

    private ActivePanel Add(LobsterController lob, string name, Vector2 corner, Vector2 pos)
    {
        var p = ActivePanel.Create(root, name, skin, portraits, corner, pos);
        p.Show(lob);
        all.Add(p);
        byId[lob.lobsterId] = p;
        return p;
    }

    /// <summary>Sort each row by turn order (soonest left, unnumbered/dead last, ties by slot) and slide any card whose
    /// place changed. Logs the new rows when they change (harness).</summary>
    private void ArrangeRows()
    {
        string a = Arrange(bottomRow, bottomSlots), b = Arrange(topRow, topSlots);
        if (a != null || b != null) Debug.Log($"[BattleHud] panels reordered bottom=[{a ?? "="}] top=[{b ?? "="}]");
    }

    /// <returns>The row's new order when any card moved, else null.</returns>
    private string Arrange(List<ActivePanel> row, List<Vector2> slots)
    {
        var sorted = new List<ActivePanel>(row);
        sorted.Sort((x, y) =>
        {
            int ox = x.Order > 0 ? x.Order : 100 + row.IndexOf(x), oy = y.Order > 0 ? y.Order : 100 + row.IndexOf(y);
            return ox.CompareTo(oy);
        });
        bool moved = false;
        for (int i = 0; i < sorted.Count; i++)
        {
            var p = sorted[i];
            var to = slots[i];
            if (p == null || (p.Rect.anchoredPosition - to).sqrMagnitude < 0.01f && !slides.ContainsKey(p)) continue;
            if (slides.TryGetValue(p, out var running) && running != null)
            {
                if (slideTargets.TryGetValue(p, out var goingTo) && (goingTo - to).sqrMagnitude < 0.01f) continue;
                StopCoroutine(running);
            }
            slideTargets[p] = to;
            slides[p] = StartCoroutine(Slide(p, to));
            moved = true;
        }
        if (!moved) return null;
        var sb = new StringBuilder();
        foreach (var p in sorted) { if (sb.Length > 0) sb.Append(','); sb.Append(p.Lobster != null ? p.Lobster.lobsterId : "?"); }
        return sb.ToString();
    }

    private readonly Dictionary<ActivePanel, Vector2> slideTargets = new();

    private System.Collections.IEnumerator Slide(ActivePanel p, Vector2 to)
    {
        var from = p.Rect.anchoredPosition;
        for (float t = 0f; t < SlideSeconds; t += Time.unscaledDeltaTime)
        {
            float k = t / SlideSeconds;
            float e = k < 0.5f ? 4f * k * k * k : 1f - Mathf.Pow(-2f * k + 2f, 3f) / 2f;   // ease-in-out (cubic)
            p.Rect.anchoredPosition = Vector2.LerpUnclamped(from, to, e);
            yield return null;
        }
        p.Rect.anchoredPosition = to;
        slides.Remove(p);
        slideTargets.Remove(p);
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
        ArrangeRows();
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
