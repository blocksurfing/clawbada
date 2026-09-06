using UnityEngine;

/// <summary>
/// World-space active-unit marker: the designer's animated hex selector strip
/// (Art/HexTiles/Sprites/hex_selector) drawn under the acting lobster, above the
/// board tiles and below every actor. Unparented so rig mirroring / death tints
/// never touch it.
/// </summary>
public class ActiveMarker : MonoBehaviour
{
    private HudSkin skin;
    private SpriteRenderer sr;
    private LobsterController target;

    public static ActiveMarker Create(HudSkin skin)
    {
        var go = new GameObject("ActiveMarker");
        var m = go.AddComponent<ActiveMarker>();
        m.skin = skin;
        m.sr = go.AddComponent<SpriteRenderer>();
        m.sr.sprite = skin.selectorSprite;
        m.sr.sortingLayerName = DepthSort.Layer;
        m.sr.sortingOrder = DepthSort.ActorOrder - 1;
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
    }

    private void Place()
    {
        var p = target.transform.position + skin.selectorOffset;
        p.z = 0f;
        transform.position = p;
    }
}
