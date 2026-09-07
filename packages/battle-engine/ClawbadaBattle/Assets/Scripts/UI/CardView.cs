using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// LOKR-style character card: bevelled frame, team-coloured header band, the lobster's
/// portrait (composited from its own Carapace/Antennae/Eyes sprites, clipped to the card
/// body) and a segmented HP bar along the bottom. Used by the turn strip and the active
/// panel; the active card is scaled up, rimmed gold and gets a pennant.
/// </summary>
public class CardView : MonoBehaviour
{
    public RectTransform Rect { get; private set; }
    public LobsterController Lobster { get; private set; }

    private HudSkin skin;
    private Image frame;
    private Image header;
    private RectTransform parts;
    private Image carapace, antennae, eyes;
    private HpBar hp;
    private Image pennant;
    private Vector2 size;

    public static CardView Create(Transform parent, string name, HudSkin skin, Vector2 size, int segments)
    {
        var rt = HudFactory.Rect(parent, name, HudFactory.Center, HudFactory.Center, HudFactory.Center, Vector2.zero, size);
        var v = rt.gameObject.AddComponent<CardView>();
        v.Rect = rt;
        v.skin = skin;
        v.size = size;

        v.frame = HudFactory.AddImage(rt, skin.cardFrame, Color.white);

        float inset = Mathf.Max(4f, size.x * 0.08f);
        float headerH = Mathf.Max(6f, size.y * 0.12f);
        float barH = Mathf.Max(5f, size.y * 0.1f);

        var headerRt = HudFactory.Rect(rt, "Header", new Vector2(0f, 1f), new Vector2(1f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -inset), new Vector2(-inset * 2f, headerH));
        v.header = HudFactory.AddImage(headerRt, skin.cardHeader, skin.teamA);

        // Portrait window: clipped to the card body between header and bar.
        var windowRt = HudFactory.Rect(rt, "Window", new Vector2(0f, 0f), new Vector2(1f, 1f), HudFactory.Center, Vector2.zero, Vector2.zero);
        windowRt.offsetMin = new Vector2(inset, inset + barH + 2f);
        windowRt.offsetMax = new Vector2(-inset, -(inset + headerH + 1f));
        windowRt.gameObject.AddComponent<RectMask2D>();
        HudFactory.AddImage(windowRt, skin.segFill != null ? skin.segFill : skin.barFill, skin.cardInner); // solid backdrop behind the parts

        v.parts = HudFactory.Rect(windowRt, "Parts", HudFactory.Center, HudFactory.Center, HudFactory.Center, skin.portraitPartOffset * (size.x / 64f), new Vector2(64f, 64f));
        v.carapace = HudFactory.Image(v.parts, "Carapace", null, Color.white, new Vector2(64f, 64f));
        v.antennae = HudFactory.Image(v.parts, "Antennae", null, Color.white, new Vector2(64f, 64f));
        v.eyes = HudFactory.Image(v.parts, "Eyes", null, Color.white, new Vector2(64f, 64f));

        v.hp = HpBar.CreateSegmented(rt, "Hp", skin, new Vector2(size.x - inset * 2f, barH), segments);
        v.hp.Rect.anchorMin = v.hp.Rect.anchorMax = new Vector2(0.5f, 0f);
        v.hp.Rect.pivot = new Vector2(0.5f, 0f);
        v.hp.Rect.anchoredPosition = new Vector2(0f, inset);

        v.pennant = HudFactory.Image(rt, "Pennant", skin.pennant, skin.gold, new Vector2(size.x * 0.28f, size.y * 0.22f));
        v.pennant.rectTransform.anchorMin = v.pennant.rectTransform.anchorMax = new Vector2(0.5f, 0f);
        v.pennant.rectTransform.pivot = new Vector2(0.5f, 1f);
        v.pennant.rectTransform.anchoredPosition = new Vector2(0f, -2f);
        v.pennant.enabled = false;
        return v;
    }

    public void Bind(LobsterController lob, LobsterPartLibrary lib)
    {
        Lobster = lob;
        if (lob == null) return;
        int[] ids = lob.partClassIds;
        bool dna = ids != null && ids.Length == 6;
        Assign(carapace, lib, lob.tier, dna ? ids[0] : lob.classId, "Carapace", lob.className);
        Assign(antennae, lib, lob.tier, dna ? ids[3] : lob.classId, "Antennae", lob.className);
        Assign(eyes, lib, lob.tier, dna ? ids[4] : lob.classId, "Eyes", lob.className);
        float s = size.x * skin.portraitPartScale / 64f;
        parts.localScale = new Vector3(lob.side == "A" ? -s : s, s, 1f);
        header.color = skin.TeamColor(lob.side);
        frame.color = Color.white;
        Refresh();
    }

    private static void Assign(Image img, LobsterPartLibrary lib, int tier, int classId, string part, string hostClass)
    {
        Sprite sprite = null;
        if (lib != null)
        {
            sprite = lib.Get(tier, LobsterClasses.Name(classId), part);
            if (sprite == null) sprite = lib.Get(tier, hostClass, part);
        }
        img.sprite = sprite;
        img.enabled = sprite != null;
        if (sprite != null) img.SetNativeSize();
    }

    public void SetActive(bool active, bool scale = true, bool showPennant = true)
    {
        transform.localScale = active && scale ? new Vector3(skin.activeCardScale, skin.activeCardScale, 1f) : Vector3.one;
        frame.color = active ? skin.activeRing : Color.white;
        pennant.enabled = active && showPennant && skin.pennant != null;
    }

    public void Refresh()
    {
        var lob = Lobster;
        if (lob == null) return;
        hp.Set(lob.currentHp, lob.maxHp);
        var c = lob.alive ? Color.white : new Color(0.45f, 0.45f, 0.45f, 0.9f);
        carapace.color = c; antennae.color = c; eyes.color = c;
    }
}
