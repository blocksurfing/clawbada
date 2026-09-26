using UnityEngine;

/// <summary>
/// World-space active-unit marker: the designer's animated hex selector strip
/// (Art/HexTiles/Sprites/hex_selector) drawn under the acting lobster, above the
/// board tiles and below every actor. Unparented so rig mirroring / death tints
/// never touch it.
/// A second instance, tinted and pulsing, marks the SELECTED target (two-step targeting, LOKR-style):
/// the same designer ring, so the two read as a family — white = whose turn, hot orange = who gets hit.
/// </summary>
public class ActiveMarker : MonoBehaviour
{
    private HudSkin skin;
    private SpriteRenderer sr;
    private LobsterController target;
    private bool pulse;
    private Color tint = Color.white;
    private Color pulseTo = Color.white;
    private const float PulseHz = 1.6f;

    public static ActiveMarker Create(HudSkin skin) => Create(skin, "ActiveMarker", Color.white, Color.white, false);

    public static ActiveMarker Create(HudSkin skin, string name, Color tint, Color pulseTo, bool pulse)
    {
        var go = new GameObject(name);
        var m = go.AddComponent<ActiveMarker>();
        m.skin = skin;
        m.tint = tint;
        m.pulseTo = pulseTo;
        m.pulse = pulse;
        m.sr = go.AddComponent<SpriteRenderer>();
        m.sr.sprite = skin.selectorSprite;
        m.sr.color = tint;
        m.sr.sortingLayerName = DepthSort.Layer;
        m.sr.sortingOrder = DepthSort.ActorOrder - 1;   // re-pinned under its own lobster's row in Place()
        if (skin.selectorController != null)
        {
            var anim = go.AddComponent<Animator>();
            anim.runtimeAnimatorController = skin.selectorController;
        }
        go.SetActive(false);
        return m;
    }

    public void Follow(LobsterController lob)
    {
        target = lob;
        gameObject.SetActive(lob != null && sr.sprite != null);
        if (lob != null) Place();
    }

    public void Hide()
    {
        target = null;
        gameObject.SetActive(false);
    }

    void LateUpdate()
    {
        if (target == null || !target.alive) { gameObject.SetActive(false); return; }
        Place();
        if (pulse) sr.color = Color.Lerp(tint, pulseTo, 0.5f + 0.5f * Mathf.Sin(Time.time * PulseHz * Mathf.PI * 2f));
    }

    private void Place()
    {
        var p = target.transform.position + skin.selectorOffset;
        p.z = 0f;
        transform.position = p;
        // Sit directly under the lobster it follows — inside that row's band, not under the
        // whole board, or a nearer row's obstacle would cover the ring.
        int order = target.SortingOrder - 1;
        if (sr.sortingOrder != order) sr.sortingOrder = order;
    }
}
