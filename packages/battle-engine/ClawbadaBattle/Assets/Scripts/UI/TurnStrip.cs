using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Top-centre initiative strip: the acting lobster first (raised, gold frame),
/// then the next turns from the server's bar projection, as hex portraits with an
/// HP bar each. Dead units are skipped. The server's `turn_started` bar already
/// starts with the actor, so the first entry is deduplicated rather than prepended.
/// </summary>
public class TurnStrip : MonoBehaviour
{
    private const int MaxEntries = 8;

    private class Slot
    {
        public RectTransform root;
        public CardView card;
        public LobsterController lob;
    }

    public RectTransform Rect { get; private set; }
    public IReadOnlyList<string> CurrentIds => currentIds;

    private HudSkin skin;
    private LobsterPartLibrary partLibrary;
    private readonly List<Slot> slots = new();
    private readonly List<string> currentIds = new();
    private readonly Dictionary<string, LobsterController> lookup = new();

    public static TurnStrip Create(Transform parent, HudSkin skin, LobsterPartLibrary partLibrary)
    {
        var size = skin.cardSize;
        float pitch = size.x + 8f;
        var rt = HudFactory.Rect(parent, "TurnStrip", new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0.5f, 1f),
            new Vector2(0f, -4f), new Vector2(MaxEntries * pitch, size.y * skin.activeCardScale + 24f));
        var strip = rt.gameObject.AddComponent<TurnStrip>();
        strip.Rect = rt;
        strip.skin = skin;
        strip.partLibrary = partLibrary;
        for (int i = 0; i < MaxEntries; i++)
        {
            var slotRt = HudFactory.Rect(rt, $"Slot{i}", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0.5f, 1f),
                Vector2.zero, new Vector2(size.x, size.y));
            var card = CardView.Create(slotRt, "Card", skin, size, skin.hpSegments);
            card.Rect.anchorMin = card.Rect.anchorMax = new Vector2(0.5f, 1f);
            card.Rect.pivot = new Vector2(0.5f, 1f);
            card.Rect.anchoredPosition = Vector2.zero;
            slotRt.gameObject.SetActive(false);
            strip.slots.Add(new Slot { root = slotRt, card = card });
        }
        return strip;
    }

    public void Bind(IEnumerable<LobsterController> lobsters)
    {
        lookup.Clear();
        foreach (var l in lobsters) if (l != null) lookup[l.lobsterId] = l;
        currentIds.Clear();
        foreach (var s in slots) { s.lob = null; s.root.gameObject.SetActive(false); }
    }

    public void SetEntries(string activeId, BarEntryData[] entries)
    {
        currentIds.Clear();
        if (!string.IsNullOrEmpty(activeId) && lookup.TryGetValue(activeId, out var active) && active.alive) currentIds.Add(activeId);
        if (entries != null)
        {
            int start = entries.Length > 0 && entries[0] != null && entries[0].lobsterId == activeId ? 1 : 0;
            for (int i = start; i < entries.Length && currentIds.Count < MaxEntries; i++)
            {
                var e = entries[i];
                if (e == null || !lookup.TryGetValue(e.lobsterId ?? "", out var lob) || !lob.alive) continue;
                currentIds.Add(e.lobsterId);
            }
        }

        float pitch = skin.cardSize.x + 8f;
        float x0 = -(currentIds.Count - 1) * pitch * 0.5f;
        for (int i = 0; i < slots.Count; i++)
        {
            var slot = slots[i];
            bool on = i < currentIds.Count;
            slot.root.gameObject.SetActive(on);
            if (!on) { slot.lob = null; continue; }
            var lob = lookup[currentIds[i]];
            if (slot.lob != lob)
            {
                slot.lob = lob;
                slot.card.Bind(lob, partLibrary);
            }
            bool isActive = i == 0 && currentIds[0] == activeId;
            // Active card is scaled about its top-centre pivot; drop the rest so the row reads level.
            slot.root.anchoredPosition = new Vector2(x0 + i * pitch + Rect.sizeDelta.x * 0.5f, isActive ? 0f : -(skin.cardSize.y * (skin.activeCardScale - 1f)) * 0.5f);
            slot.card.SetActive(isActive);
        }
        Refresh();
    }

    public void Refresh()
    {
        foreach (var slot in slots)
        {
            if (slot.lob == null || !slot.root.gameObject.activeSelf) continue;
            slot.card.Refresh();
        }
    }

    public string DescribeIds()
    {
        var sb = new StringBuilder();
        for (int i = 0; i < currentIds.Count; i++) { if (i > 0) sb.Append(','); sb.Append(currentIds[i]); }
        return sb.ToString();
    }
}
