using System.Collections;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// A puff of sand kicked up where something lands on the board — the battle intro's obstacle and lobster drops
/// (user 2026-09-29: "drop into place with some sort of dust and visual impact"). Procedural placeholder until Nzib
/// draws a sheet: a handful of chunky pixel blobs that burst low and wide from the landing point, rise a little,
/// swell and fade. Drawn in the lander's own row band, just in front of it, so the dust hides its feet.
/// </summary>
public static class IntroDust
{
    private static readonly Color Sand = new Color32(0xe8, 0xd6, 0xb0, 0xff);
    private static Sprite puff;

    /// <param name="at">World position of the landing point (the hex centre).</param>
    /// <param name="sortingOrder">The lander's sorting order; the dust draws just in front of it.</param>
    /// <param name="size">1 = an obstacle's puff; a lobster's landing is bigger.</param>
    public static void Burst(MonoBehaviour host, Vector3 at, int sortingOrder, float size)
    {
        if (host == null) return;
        var root = new GameObject("IntroDust");
        root.transform.position = at;
        var group = root.AddComponent<SortingGroup>();
        group.sortingLayerName = DepthSort.Layer;
        group.sortingOrder = sortingOrder + 2;
        int count = 9;
        for (int i = 0; i < count; i++)
        {
            // Mostly sideways, a few up: a ring flattened to the board's foreshortening.
            float a = (i + Random.Range(-0.3f, 0.3f)) / count * Mathf.PI * 2f;
            var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a) * 0.35f);
            float speed = Random.Range(0.7f, 1.1f) * size;
            float scale = Random.Range(0.22f, 0.34f) * size;
            host.StartCoroutine(Blob(root.transform, dir * speed, scale, Random.Range(0.45f, 0.65f)));
        }
        host.StartCoroutine(DestroyAfter(root, 0.8f));
    }

    private static IEnumerator Blob(Transform parent, Vector2 velocity, float scale, float life)
    {
        var go = new GameObject("Puff");
        go.transform.SetParent(parent, false);
        var sr = go.AddComponent<SpriteRenderer>();
        sr.sprite = Puff();
        sr.color = Sand;
        var pos = Vector3.zero;
        for (float t = 0f; t < life && go != null; t += Time.unscaledDeltaTime)
        {
            float k = t / life;
            float slow = 1f - k;                                   // decelerates as it spreads
            pos += (Vector3)(velocity * slow * Time.unscaledDeltaTime);
            pos.y += 0.25f * Time.unscaledDeltaTime * scale;       // drifts up a touch
            go.transform.localPosition = pos;
            go.transform.localScale = Vector3.one * scale * Mathf.Lerp(0.6f, 1.4f, Mathf.Sqrt(k));
            var c = Sand;
            c.a = 0.85f * (1f - k * k);
            sr.color = c;
            yield return null;
        }
    }

    private static IEnumerator DestroyAfter(GameObject go, float s)
    {
        for (float t = 0f; t < s; t += Time.unscaledDeltaTime) yield return null;
        if (go != null) Object.Destroy(go);
    }

    /// <summary>A 12 px blob with a lighter core and stepped (pixel-art) alpha, point-sampled. 1 world unit across.</summary>
    private static Sprite Puff()
    {
        if (puff != null) return puff;
        const int n = 12;
        var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp };
        var px = new Color[n * n];
        for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float dx = (x + 0.5f) / n * 2f - 1f, dy = (y + 0.5f) / n * 2f - 1f;
                float d = Mathf.Sqrt(dx * dx + dy * dy);
                float a = d < 0.55f ? 1f : d < 0.8f ? 0.7f : d < 1f ? 0.35f : 0f;
                float light = d < 0.45f ? 1f : 0.88f;
                px[y * n + x] = new Color(light, light, light, a);
            }
        tex.SetPixels(px);
        tex.Apply();
        puff = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), n);
        puff.name = "IntroDustPuff";
        return puff;
    }
}
