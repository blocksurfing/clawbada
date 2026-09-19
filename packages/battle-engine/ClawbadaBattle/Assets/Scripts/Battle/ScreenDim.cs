using UnityEngine;

/// <summary>
/// Darkens the arena while a Special plays: a full-screen black layer parented to the main camera (so it
/// rides the screen shake and any zoom), sorted on the lobsters' layer BELOW them, so the board and its
/// decor go dark while the cast and its effects stay lit. Fades in, holds, fades out with the effect.
/// One instance, reused; a new Run restarts it. Data comes from VfxSlot.dimAlpha / dimFadeIn / dimFadeOut.
/// </summary>
public class ScreenDim : MonoBehaviour
{
    /// <summary>Above the ground, glow and decor (Foreground 1–3), below every lobster (100) and the effects sorted around them.</summary>
    public const int Order = 50;

    private static ScreenDim instance;
    private SpriteRenderer sr;
    private Camera cam;
    private float alpha, fadeIn, holdUntil, fadeOut, t;
    private bool running;

    /// <summary>Fade to <paramref name="alpha"/> over <paramref name="fadeIn"/> s, hold, then from
    /// <paramref name="holdUntil"/> s fade back out over <paramref name="fadeOut"/> s.</summary>
    public static void Run(float alpha, float fadeIn, float holdUntil, float fadeOut)
    {
        if (alpha <= 0f) return;
        var cam = Camera.main;
        if (cam == null) return;
        if (instance == null)
        {
            var go = new GameObject("ScreenDim");
            go.transform.SetParent(cam.transform, false);
            instance = go.AddComponent<ScreenDim>();
            instance.cam = cam;
            var tex = new Texture2D(4, 4, TextureFormat.RGBA32, false);
            var px = new Color[16];
            for (int i = 0; i < px.Length; i++) px[i] = Color.white;
            tex.SetPixels(px);
            tex.Apply();
            instance.sr = go.AddComponent<SpriteRenderer>();
            instance.sr.sprite = Sprite.Create(tex, new Rect(0, 0, 4, 4), new Vector2(0.5f, 0.5f), 4f); // 1×1 world unit
            instance.sr.sortingLayerName = DepthSort.Layer;
            instance.sr.sortingOrder = Order;
            instance.sr.color = new Color(0f, 0f, 0f, 0f);
        }
        instance.alpha = Mathf.Clamp01(alpha);
        instance.fadeIn = Mathf.Max(0.01f, fadeIn);
        instance.holdUntil = Mathf.Max(instance.fadeIn, holdUntil);
        instance.fadeOut = Mathf.Max(0.01f, fadeOut);
        instance.t = 0f;
        instance.running = true;
        instance.sr.enabled = true;
        instance.Fit();
        Debug.Log($"[ScreenDim] alpha={alpha:F2} in {fadeIn:F2}s, out from {holdUntil:F2}s over {fadeOut:F2}s");
    }

    void LateUpdate()
    {
        if (!running) return;
        t += Time.deltaTime;
        float k = t < fadeIn ? t / fadeIn : t < holdUntil ? 1f : 1f - (t - holdUntil) / fadeOut;
        if (k <= 0f)
        {
            running = false;
            sr.enabled = false;
            Debug.Log("[ScreenDim] done");
            return;
        }
        Fit();
        sr.color = new Color(0f, 0f, 0f, alpha * Mathf.Clamp01(k));
    }

    /// <summary>Cover the whole view whatever the zoom (fill vs pixel-perfect changes the ortho size), on the z = 0 plane.</summary>
    private void Fit()
    {
        float h = cam.orthographicSize * 2f + 1f;
        transform.localScale = new Vector3(h * cam.aspect + 1f, h, 1f);
        var p = cam.transform.position;
        transform.position = new Vector3(p.x, p.y, 0f);
    }
}
