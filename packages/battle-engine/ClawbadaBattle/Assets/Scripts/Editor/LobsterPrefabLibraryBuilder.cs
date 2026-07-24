using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Rebuilds Assets/Prefabs/Lobsters/LobsterPrefabLibrary.asset from the prefabs on
/// disk (Assets/Prefabs/Lobsters/{Tier}/Lobster_{Tier}_{Class}.prefab). Run after
/// the designer adds tiers/classes or prefabs are regenerated.
/// </summary>
public static class LobsterPrefabLibraryBuilder
{
    private const string LibraryPath = "Assets/Prefabs/Lobsters/LobsterPrefabLibrary.asset";
    private static readonly string[] Tiers = { "Evolved", "Elite", "Apex" };
    private static readonly string[] Classes =
    {
        "Bulwark", "Mantis", "Leviathan", "Tempest", "Specter",
        "Sentinel", "Reaver", "Abyss", "Kraken", "Ember",
    };

    [MenuItem("Clawbada/Rebuild Lobster Prefab Library")]
    public static void Rebuild()
    {
        var library = AssetDatabase.LoadAssetAtPath<LobsterPrefabLibrary>(LibraryPath);
        bool created = library == null;
        if (created)
        {
            library = ScriptableObject.CreateInstance<LobsterPrefabLibrary>();
        }

        var entries = new List<LobsterPrefabLibrary.Entry>();
        var missing = new List<string>();

        foreach (var tier in Tiers)
        {
            foreach (var cls in Classes)
            {
                string path = $"Assets/Prefabs/Lobsters/{tier}/Lobster_{tier}_{cls}.prefab";
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null)
                {
                    missing.Add(path);
                    continue;
                }
                entries.Add(new LobsterPrefabLibrary.Entry { tier = tier, className = cls, prefab = prefab });
            }
        }

        library.entries = entries.ToArray();

        if (created) AssetDatabase.CreateAsset(library, LibraryPath);
        else EditorUtility.SetDirty(library);
        AssetDatabase.SaveAssets();

        Debug.Log($"[LobsterPrefabLibraryBuilder] {entries.Count} entries written to {LibraryPath}" +
                  (missing.Count > 0 ? $"; MISSING: {string.Join(", ", missing)}" : ""));
    }
}
