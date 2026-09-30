using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Nzib's soft shadow under a lobster (drop 36c7068, Art/Characters/Shared/Character_Shadow.png). Kept OFF the rig
/// on purpose: it is its own object that follows the lobster's ground position every frame, so nothing that walks a
/// lobster's renderers picks it up — afterimage clones, hit blinks, the corpse grey-out, portrait snapshots, body
/// bounds (his handoff asked for exactly that review) — and the body can leave the ground without taking the shadow
/// with it (the intro drop: the shadow waits on the landing hex and grows as the lobster falls onto it).
/// Layering (his approved target): the arena floor &lt; this shadow &lt; the hex highlights &lt; every lobster and effect.
/// The arenas' floor pieces sit on the Default layer at orders 0–3 and HexGrid's highlight tilemap at Default:5, so
/// the shadow draws at Default:<see cref="Order"/>.
/// </summary>
public class CharacterShadow : MonoBehaviour
{
    public const string Layer = "Default";
    public const int Order = 4;
    /// <summary>His placement under the class root: 2 px above the foot baseline at 64 PPU.</summary>
    public static readonly Vector3 Offset = new Vector3(0f, -0.125f, 0f);

    private LobsterController target;
    private SpriteRenderer sr;

    public static CharacterShadow Attach(LobsterController lobster, GameObject prefab)
    {
        if (lobster == null || prefab == null) return null;
        var go = Instantiate(prefab, lobster.transform.parent, false);
        go.name = $"Shadow_{lobster.name}";
        var shadow = go.AddComponent<CharacterShadow>();
        shadow.target = lobster;
        shadow.sr = go.GetComponentInChildren<SpriteRenderer>();
        var group = go.GetComponent<SortingGroup>();
        if (group == null) group = go.AddComponent<SortingGroup>();
        group.sortingLayerName = Layer;
        group.sortingOrder = Order;
        group.sortAtRoot = true;
        shadow.LateUpdate();
        return shadow;
    }

    void LateUpdate()
    {
        if (target == null) { Destroy(gameObject); return; }
        var root = target.transform;
        var s = root.lossyScale;
        float k = Mathf.Max(0f, target.ShadowScale);
        Vector3 ground = target.ShadowGround ?? root.position;
        transform.position = new Vector3(ground.x, ground.y + Offset.y * Mathf.Abs(s.y), 0f);
        transform.localScale = new Vector3(Mathf.Abs(s.x) * k, Mathf.Abs(s.y) * k, 1f);
        if (sr != null) sr.enabled = target.gameObject.activeInHierarchy && s.x != 0f && k > 0f;
    }
}
