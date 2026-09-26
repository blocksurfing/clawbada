using UnityEngine;

/// <summary>
/// Stretches a thin strip sprite (pivot at its bottom) from where it stands up to the top edge of the
/// camera's view — "rays from the heavens" that start off-screen instead of 2 units above the lobster
/// (Fortify, user 2026-09-27). The strip is the top row of the designer's own beam frames, animated in
/// step with them, so the extension is seamless. World-space, so the HUD (ATB cards) stays in front.
/// </summary>
[RequireComponent(typeof(SpriteRenderer))]
public class SkyBeam : MonoBehaviour
{
    [Tooltip("Extra world units above the view's top edge, so camera shake never shows the beam's end.")]
    public float overshoot = 0.5f;

    private SpriteRenderer sr;
    private Camera cam;

    void Awake()
    {
        sr = GetComponent<SpriteRenderer>();
        cam = Camera.main;
    }

    void LateUpdate()
    {
        if (sr == null || sr.sprite == null) return;
        if (cam == null) cam = Camera.main;
        if (cam == null) return;
        float stripHeight = sr.sprite.bounds.size.y;
        if (stripHeight <= 0f) return;
        float top = ViewTopAt(transform.position) + overshoot;
        float length = Mathf.Max(0f, top - transform.position.y);
        var s = transform.localScale;
        float parentY = transform.parent != null ? Mathf.Abs(transform.parent.lossyScale.y) : 1f;
        s.y = length / stripHeight / Mathf.Max(0.0001f, parentY);
        transform.localScale = s;
    }

    /// <summary>World y of the view's top edge on the board plane (z = 0), for ortho and perspective alike.</summary>
    private float ViewTopAt(Vector3 at)
    {
        if (cam.orthographic) return cam.transform.position.y + cam.orthographicSize;
        var ray = cam.ViewportPointToRay(new Vector3(0.5f, 1f, 0f));
        if (Mathf.Approximately(ray.direction.z, 0f)) return at.y + 10f;
        float t = (at.z - ray.origin.z) / ray.direction.z;
        return (ray.origin + ray.direction * t).y;
    }
}
