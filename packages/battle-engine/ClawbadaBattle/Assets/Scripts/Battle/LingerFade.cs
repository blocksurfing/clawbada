using UnityEngine;

/// <summary>
/// Fades every sprite on an effect to transparent over the last `fade` seconds of its life, so an
/// effect kept past its clip (VfxSlot.lingerSeconds — Inferno's scorch) melts away instead of popping.
/// OneShotVfx still owns the destroy; this only drives alpha.
/// </summary>
public class LingerFade : MonoBehaviour
{
    private float life, fade, t;
    private SpriteRenderer[] renderers;
    private float[] baseAlpha;

    public void Begin(float lifetime, float fadeSeconds)
    {
        life = lifetime;
        fade = Mathf.Max(0.05f, fadeSeconds);
        renderers = GetComponentsInChildren<SpriteRenderer>(true);
        baseAlpha = new float[renderers.Length];
        for (int i = 0; i < renderers.Length; i++) baseAlpha[i] = renderers[i] != null ? renderers[i].color.a : 1f;
    }

    void Update()
    {
        if (renderers == null) return;
        t += Time.deltaTime;
        float k = Mathf.Clamp01((life - t) / fade);
        for (int i = 0; i < renderers.Length; i++)
        {
            var r = renderers[i];
            if (r == null) continue;
            var c = r.color;
            r.color = new Color(c.r, c.g, c.b, baseAlpha[i] * k);
        }
    }
}
