using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Fills Resources/BattleSfxLibrary.asset from the audio drop, by filename. This is why the
/// naming convention is load-bearing: a clip is found at
/// Assets/Audio/SFX/Attack/SFX_&lt;Class&gt;_Attack.wav, so a misspelled class (Spectre for
/// Specter) binds nothing and that class is simply silent in battle.
///
/// Menu: Clawbada ▸ Audio ▸ Bind Battle SFX. Headless: -executeMethod BattleSfxBinder.Bind
/// Re-run after any drop; missing files are reported rather than failing the bind, so a
/// partial pack still lands.
/// </summary>
public static class BattleSfxBinder
{
    private const string AttackDir = "Assets/Audio/SFX/Attack/";
    private const string SpecialDir = "Assets/Audio/SFX/Special/";
    private const string LibraryPath = "Assets/Resources/BattleSfxLibrary.asset";

    /// <summary>Index = LobsterClass. Order is the enum's, not alphabetical — do not sort.</summary>
    private static readonly string[] Classes =
    {
        "Bulwark", "Mantis", "Leviathan", "Tempest", "Specter",
        "Sentinel", "Reaver", "Abyss", "Kraken", "Ember",
    };

    /// <summary>Special move per class, same index order. Used to build the filename.</summary>
    private static readonly string[] Abilities =
    {
        "Fortify", "Ambush", "Crush", "Maelstrom", "Haunt",
        "Rally", "Rend", "Devour", "Bind", "Inferno",
    };

    /// <summary>Tier suffixes, matching LobsterPrefabLibrary.TierName exactly.</summary>
    private static readonly string[] Tiers = { "Evolved", "Elite", "Apex" };

    [MenuItem("Clawbada/Audio/Bind Battle SFX")]
    public static void Bind()
    {
        var lib = AssetDatabase.LoadAssetAtPath<BattleSfxLibrary>(LibraryPath);
        if (lib == null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LibraryPath)!);
            lib = ScriptableObject.CreateInstance<BattleSfxLibrary>();
            AssetDatabase.CreateAsset(lib, LibraryPath);
        }
        if (lib.attackByClass == null || lib.attackByClass.Length != Classes.Length)
            lib.attackByClass = new AudioClip[Classes.Length];

        var bound = new System.Collections.Generic.List<string>();
        var missing = new System.Collections.Generic.List<string>();
        for (int i = 0; i < Classes.Length; i++)
        {
            string path = $"{AttackDir}SFX_{Classes[i]}_Attack.wav";
            var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(path);
            lib.attackByClass[i] = clip;
            (clip != null ? bound : missing).Add(Classes[i]);
        }

        // Specials: a per-tier clip if it exists, else one shared clip for the class. A class with
        // neither is silent on Special, which is expected while the pack is incomplete.
        if (lib.specialByClass == null || lib.specialByClass.Length != Classes.Length)
            lib.specialByClass = new BattleSfxLibrary.SpecialClips[Classes.Length];
        var specialBound = new System.Collections.Generic.List<string>();
        for (int i = 0; i < Classes.Length; i++)
        {
            var slot = lib.specialByClass[i] ?? new BattleSfxLibrary.SpecialClips();
            string stem = $"{SpecialDir}SFX_{Classes[i]}_{Abilities[i]}";
            slot.shared = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}.wav");
            slot.evolved = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[0]}.wav");
            slot.elite = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[1]}.wav");
            slot.apex = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[2]}.wav");
            lib.specialByClass[i] = slot;

            int n = (slot.shared != null ? 1 : 0) + (slot.evolved != null ? 1 : 0)
                  + (slot.elite != null ? 1 : 0) + (slot.apex != null ? 1 : 0);
            if (n > 0) specialBound.Add($"{Classes[i]}/{Abilities[i]}×{n}");
        }

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        Debug.Log($"[BattleSfxBinder] attack: {bound.Count}/{Classes.Length} bound" +
                  (missing.Count > 0 ? $" — MISSING {string.Join(", ", missing)}" : "") +
                  $" | special: {(specialBound.Count > 0 ? string.Join(", ", specialBound) : "none")}" +
                  $" → {LibraryPath}");
    }
}
