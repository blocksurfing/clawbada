using System.Collections;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// A frozen, translucent copy of a lobster left where it stood, fading out — the "it moved faster than
/// the eye" read for a dash (Mantis Ambush). It copies the rig's visible part sprites at their current
/// world pose, so the ghost holds the exact frame the lobster took off in, mirrored the same way.
/// Alpha only, no tint: the parts carry their own palettes and a multiplied tint can only darken them.
/// </summary>
public class Afterimage : MonoBehaviour
{
    public static void Leave(LobsterController lobster, float alpha, float fadeSeconds)
    {
        if (lobster == null || alpha <= 0f) return;
        var ghost = new GameObject($"Afterimage_{lobster.className}");
        var group = ghost.AddComponent<SortingGroup>();
        var source = lobster.GetComponent<SortingGroup>();
        if (source != null)
        {
            group.sortingLayerID = source.sortingLayerID;
            // The row's decor slot: over the dash trail (an actor-FX-slot effect — the speed cue BEHIND the
            // lobster), still under every sprite on the rows in front.
            group.sortingOrder = source.sortingOrder - DepthSort.RowActor + DepthSort.RowDecor;
        }

        int parts = 0;
        var renderers = lobster.GetComponentsInChildren<SpriteRenderer>(false);
        var copies = new SpriteRenderer[renderers.Length];
        var baseAlpha = new float[renderers.Length];
        for (int i = 0; i < renderers.Length; i++)
        {
            var src = renderers[i];
            if (src == null || !src.enabled || src.sprite == null) continue;
            var part = new GameObject(src.gameObject.name);
            part.transform.SetParent(ghost.transform, false);
            part.transform.SetPositionAndRotation(src.transform.position, src.transform.rotation);
            part.transform.localScale = src.transform.lossyScale;
            var sr = part.AddComponent<SpriteRenderer>();
            sr.sprite = src.sprite;
            sr.flipX = src.flipX;
            sr.flipY = src.flipY;
            sr.sharedMaterial = src.sharedMaterial;
            sr.sortingLayerID = src.sortingLayerID;
            sr.sortingOrder = src.sortingOrder;
            var c = src.color;
            baseAlpha[i] = c.a * alpha;
            sr.color = new Color(c.r, c.g, c.b, baseAlpha[i]);
            copies[i] = sr;
            parts++;
        }

        Debug.Log($"[Afterimage] {lobster.className} {parts}/{renderers.Length} parts, layer {SortingLayer.IDToName(group.sortingLayerID)} order {group.sortingOrder}, alpha {alpha:F2} over {fadeSeconds:F2}s");
        if (parts == 0) { Destroy(ghost); return; }
        ghost.AddComponent<Afterimage>().StartCoroutine(Fade(ghost, copies, baseAlpha, Mathf.Max(0.05f, fadeSeconds)));
    }

    private static IEnumerator Fade(GameObject ghost, SpriteRenderer[] copies, float[] baseAlpha, float seconds)
    {
        float t = 0f;
        while (t < seconds)
        {
            t += Time.deltaTime;
            float k = 1f - Mathf.Clamp01(t / seconds);
            for (int i = 0; i < copies.Length; i++)
            {
                var sr = copies[i];
                if (sr == null) continue;
                var c = sr.color;
                sr.color = new Color(c.r, c.g, c.b, baseAlpha[i] * k);
            }
            yield return null;
        }
        Destroy(ghost);
    }
}
