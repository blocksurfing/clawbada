using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Rebuilds Assets/Prefabs/Lobsters/LobsterPartLibrary.asset by scanning every sprite
/// under Assets/Art/Characters/{Tier}/{Class}/ (recursively — segmented parts live in
/// subfolders like "Claw L/"). Entries are keyed by sprite name, which is consistent
/// across classes because all rigs of a tier share one skeleton.
/// </summary>
public static class LobsterPartLibraryBuilder
{
    private const string LibraryPath = "Assets/Prefabs/Lobsters/LobsterPartLibrary.asset";
    private const string ArtRoot = "Assets/Art/Characters";
    private static readonly string[] Tiers = { "Evolved", "Elite", "Apex" };
    private static readonly string[] Classes =
    {
        "Bulwark", "Mantis", "Leviathan", "Tempest", "Specter",
        "Sentinel", "Reaver", "Abyss", "Kraken", "Ember",
    };

    [MenuItem("Clawbada/Rebuild Lobster Part Library")]
    public static void Rebuild()
    {
        var library = AssetDatabase.LoadAssetAtPath<LobsterPartLibrary>(LibraryPath);
        bool created = library == null;
        if (created)
        {
            library = ScriptableObject.CreateInstance<LobsterPartLibrary>();
        }

        var entries = new List<LobsterPartLibrary.Entry>();
        var missingDirs = new List<string>();

        foreach (var tier in Tiers)
        {
            foreach (var cls in Classes)
            {
                string dir = $"{ArtRoot}/{tier}/{cls}";
                if (!AssetDatabase.IsValidFolder(dir))
                {
                    missingDirs.Add(dir);
                    continue;
                }
                foreach (string guid in AssetDatabase.FindAssets("t:Sprite", new[] { dir }))
                {
                    string path = AssetDatabase.GUIDToAssetPath(guid);
                    var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(path);
                    if (sprite == null) continue;
                    entries.Add(new LobsterPartLibrary.Entry
                    {
                        tier = tier.ToLowerInvariant(),
                        className = cls.ToLowerInvariant(),
                        partName = Path.GetFileNameWithoutExtension(path),
                        sprite = sprite,
                    });
                }
            }
        }

        library.entries = entries.ToArray();

        if (created) AssetDatabase.CreateAsset(library, LibraryPath);
        else EditorUtility.SetDirty(library);
        AssetDatabase.SaveAssets();

        Debug.Log($"[LobsterPartLibraryBuilder] {entries.Count} part sprites written to {LibraryPath}" +
                  (missingDirs.Count > 0 ? $"; MISSING DIRS: {string.Join(", ", missingDirs)}" : ""));
    }
}
