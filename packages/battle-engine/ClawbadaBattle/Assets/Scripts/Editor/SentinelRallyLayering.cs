using UnityEditor;
using UnityEngine;

/// <summary>
/// Sentinel Rally's layer intent (designer, 2026-09-27): "Sigil + Back = under the character,
/// everything else = over it."
///
/// Rally's prefabs are parented under the healed lobster, inside its SortingGroup, where the sorting
/// LAYER outranks the order: the rig's parts sit on Default (0…15), so anything on Foreground draws over
/// the body whatever its order — which is why the BackRing (Foreground −2) and the sigil sat on top.
/// Under = Default at a negative order (like Haunt's sigil at −5): sigil −6, back ring −5 just above it.
/// Over  = Foreground, the designer's own order kept.
///
/// `Apply` fixes the committed prefabs IN PLACE (their GUIDs, and so the library's references, stay);
/// SentinelRallyVfxBinder calls `Place` so a rebuild comes out the same.
/// Menu: Clawbada ▸ VFX ▸ Fix Sentinel Rally Layering. Headless: -executeMethod SentinelRallyLayering.Apply
/// </summary>
public static class SentinelRallyLayering
{
    private static readonly string[] Prefabs =
    {
        "Assets/Prefabs/VFX/FX_Sentinel_Rally_Spawn.prefab",
        "Assets/Prefabs/VFX/FX_Sentinel_Rally_Loop.prefab",
        "Assets/Prefabs/VFX/FX_Sentinel_Rally_Out.prefab",
    };

    /// <summary>Put one Rally renderer on its side of the body, judged by its layer name.</summary>
    public static void Place(SpriteRenderer sr, string name)
    {
        bool sigil = name.Contains("Sigil");
        bool back = name.Contains("Back");
        if (sigil || back)
        {
            sr.sortingLayerName = "Default";
            sr.sortingOrder = sigil ? -6 : -5;
        }
        else
        {
            sr.sortingLayerName = DepthSort.Layer;
        }
    }

    [MenuItem("Clawbada/VFX/Fix Sentinel Rally Layering")]
    public static void Apply()
    {
        var report = new System.Text.StringBuilder();
        foreach (var path in Prefabs)
        {
            var root = PrefabUtility.LoadPrefabContents(path);
            try
            {
                foreach (var sr in root.GetComponentsInChildren<SpriteRenderer>(true))
                {
                    // A single-renderer phase (Spawn/Out) is the sigil itself; a layered one names its parts.
                    string name = sr.gameObject == root ? "Sigil" : sr.gameObject.name;
                    Place(sr, name);
                    report.Append($" {System.IO.Path.GetFileNameWithoutExtension(path)}/{sr.gameObject.name}={sr.sortingLayerName}:{sr.sortingOrder}");
                }
                PrefabUtility.SaveAsPrefabAsset(root, path);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }
        AssetDatabase.SaveAssets();
        string msg = $"[SentinelRallyLayering] OK —{report}";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }
}
