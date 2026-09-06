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
        public PortraitView portrait;
        public HpBar hp;
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
        float w = skin.stripPortrait;
        var rt = HudFactory.Rect(parent, "TurnStrip", new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0.5f, 1f),
            new Vector2(0f, -6f), new Vector2(MaxEntries * (w + 6f), w * 1.143f + 30f));
        var strip = rt.gameObject.AddComponent<TurnStrip>();
        strip.Rect = rt;
        strip.skin = skin;
        strip.partLibrary = partLibrary;
        for (int i = 0; i < MaxEntries; i++)
        {
            var slotRt = HudFactory.Rect(rt, $"Slot{i}", new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0.5f, 1f),
                Vector2.zero, new Vector2(w, w * 1.143f + 24f));
            var portrait = PortraitView.Create(slotRt, "Portrait", skin, w);
            portrait.Rect.anchorMin = portrait.Rect.anchorMax = new Vector2(0.5f, 1f);
            portrait.Rect.pivot = new Vector2(0.5f, 1f);
            portrait.Rect.anchoredPosition = new Vector2(0f, -8f);
            var hp = HpBar.Create(slotRt, "Hp", skin, new Vector2(w - 8f, 4f), withLabel: false);
            hp.Rect.anchorMin = hp.Rect.anchorMax = new Vector2(0.5f, 1f);
            hp.Rect.anchoredPosition = new Vector2(0f, -(w * 1.143f) - 12f);
            slotRt.gameObject.SetActive(false);
            strip.slots.Add(new Slot { root = slotRt, portrait = portrait, hp = hp });
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

        float w = skin.stripPortrait;
        float pitch = w + 6f;
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
                slot.portrait.Compose(lob, partLibrary);
            }
            bool isActive = i == 0 && currentIds[0] == activeId;
            slot.root.anchoredPosition = new Vector2(x0 + i * pitch + Rect.sizeDelta.x * 0.5f, isActive ? 0f : -8f);
            slot.portrait.SetActive(isActive, skin.activeRing);
            if (!isActive) slot.portrait.SetFrameColor(skin.TeamColor(lob.side));
        }
        Refresh();
    }

    public void Refresh()
    {
        foreach (var slot in slots)
        {
            if (slot.lob == null || !slot.root.gameObject.activeSelf) continue;
            slot.hp.Set(slot.lob.currentHp, slot.lob.maxHp);
            slot.portrait.SetDimmed(!slot.lob.alive);
        }
    }

    public string DescribeIds()
    {
        var sb = new StringBuilder();
        for (int i = 0; i < currentIds.Count; i++) { if (i > 0) sb.Append(','); sb.Append(currentIds[i]); }
        return sb.ToString();
    }
}
