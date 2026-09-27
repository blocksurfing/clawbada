using UnityEngine;

/// <summary>
/// Stopgap life for a status loop whose clip is a single frame (it would sit perfectly still for the whole
/// status and read as frozen): a slow glow pulse on its sprites. Alpha only — tints darken class art.
/// Added at runtime by LobsterController only when the loop is one frame, so real multi-frame loops are
/// never touched and this retires itself the moment the designer's art has frames.
/// </summary>
public class LoopBreath : MonoBehaviour
{
    public float periodSeconds = 1.6f;
    [Range(0f, 1f)] public float minAlpha = 0.55f;

    private SpriteRenderer[] renderers;
    private float[] baseAlpha;
    private float t;

    void Start()
    {
        renderers = GetComponentsInChildren<SpriteRenderer>(true);
        baseAlpha = new float[renderers.Length];
        for (int i = 0; i < renderers.Length; i++) baseAlpha[i] = renderers[i] != null ? renderers[i].color.a : 1f;
    }

    void Update()
    {
        if (renderers == null) return;
        t += Time.deltaTime;
        float k = Mathf.Lerp(minAlpha, 1f, 0.5f + 0.5f * Mathf.Cos(t / periodSeconds * Mathf.PI * 2f));
        for (int i = 0; i < renderers.Length; i++)
        {
            var r = renderers[i];
            if (r == null) continue;
            var c = r.color;
            r.color = new Color(c.r, c.g, c.b, baseAlpha[i] * k);
        }
    }
}
