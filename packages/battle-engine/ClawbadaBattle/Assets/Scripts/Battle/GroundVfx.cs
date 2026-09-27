using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Moves the GROUND parts of an effect onto the ground band (DepthSort.GroundOrder), below every lobster and
/// every effect on every row. A part is "ground" when it is authored UNDER the body — the Default sorting layer
/// at a negative order, the project's convention for sigils, floor rings and pools (Haunt's sigil, Rally's
/// sigil and back ring, the bleed pool).
///
/// Effects parented under a lobster live inside its SortingGroup, which a child can never escape; its band sits
/// above every row behind, so a front-row sigil painted over a back-row lobster's Bind tentacles (designer,
/// 2026-09-27). So ground parts get their own copy OUTSIDE the lobster that follows it: the whole instance if
/// every part is ground, else a second instance keeping only the ground children (the other keeps the rest) —
/// the same split BattleVfxLibrary uses to straddle an effect around its owner. Both start the same frame, so
/// their animations stay in step; the ground copy dies with its partner.
/// </summary>
public static class GroundVfx
{
    public static bool IsGround(SpriteRenderer sr) => sr != null && sr.sortingLayerName == "Default" && sr.sortingOrder < 0;

    /// <summary>Called right after an effect is instantiated under `lobster`. Returns the object to track and
    /// destroy for this effect (unchanged when nothing is ground).</summary>
    public static GameObject Split(GameObject fx, GameObject prefab, LobsterController lobster)
    {
        var renderers = fx.GetComponentsInChildren<SpriteRenderer>(true);
        if (renderers.Length == 0) return fx;
        int ground = 0;
        foreach (var r in renderers) if (IsGround(r)) ground++;
        if (ground == 0) return fx;

        if (ground == renderers.Length)
        {
            // All ground (Haunt's sigil phases): lift the whole instance out of the lobster.
            Lift(fx, lobster);
            return fx;
        }

        // Mixed (Rally's loop, the bleed marker): a second instance keeps only the ground children.
        var twin = Object.Instantiate(prefab, fx.transform.position, fx.transform.rotation);
        twin.transform.localScale = fx.transform.lossyScale;
        KeepChildren(twin.transform, keepGround: true);
        KeepChildren(fx.transform, keepGround: false);
        Lift(twin, lobster);
        var oneShot = twin.GetComponent<OneShotVfx>();
        if (fx.GetComponent<OneShotVfx>() == null && oneShot != null) Object.Destroy(oneShot);   // lives as long as its partner
        fx.AddComponent<DestroyWith>().partner = twin;
        return fx;
    }

    private static void KeepChildren(Transform root, bool keepGround)
    {
        var drop = new List<GameObject>();
        foreach (Transform child in root)
        {
            var sr = child.GetComponent<SpriteRenderer>();
            if (sr == null) continue;
            if (IsGround(sr) != keepGround) drop.Add(child.gameObject);
        }
        foreach (var go in drop) { go.SetActive(false); Object.Destroy(go); }
    }

    private static void Lift(GameObject fx, LobsterController lobster)
    {
        Vector3 offset = fx.transform.position - lobster.transform.position;
        fx.transform.SetParent(null, true);
        var group = fx.GetComponent<UnityEngine.Rendering.SortingGroup>();
        if (group == null) group = fx.AddComponent<UnityEngine.Rendering.SortingGroup>();
        group.sortingLayerName = DepthSort.Layer;
        group.sortingOrder = DepthSort.GroundOrder;
        var follow = fx.AddComponent<FollowLobster>();
        follow.target = lobster;
        follow.offset = offset;
        Debug.Log($"[GroundVfx] {fx.name} on the ground band ({DepthSort.GroundOrder}) under {lobster.lobsterId}");
    }
}

/// <summary>Keeps a lifted ground mark under its lobster (position and facing) — it is no longer a child.</summary>
public class FollowLobster : MonoBehaviour
{
    public LobsterController target;
    public Vector3 offset;

    void LateUpdate()
    {
        if (target == null) { Destroy(gameObject); return; }
        transform.position = target.transform.position + offset;
        transform.rotation = target.transform.rotation;
    }
}

/// <summary>Destroys a linked object with this one (a ground twin with its partner).</summary>
public class DestroyWith : MonoBehaviour
{
    public GameObject partner;
    void OnDestroy() { if (partner != null) Destroy(partner); }
}
