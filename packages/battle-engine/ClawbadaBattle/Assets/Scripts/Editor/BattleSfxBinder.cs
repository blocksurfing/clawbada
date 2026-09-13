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
    private const string LibraryPath = "Assets/Resources/BattleSfxLibrary.asset";

    /// <summary>Index = LobsterClass. Order is the enum's, not alphabetical — do not sort.</summary>
    private static readonly string[] Classes =
    {
        "Bulwark", "Mantis", "Leviathan", "Tempest", "Specter",
        "Sentinel", "Reaver", "Abyss", "Kraken", "Ember",
    };

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

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        Debug.Log($"[BattleSfxBinder] attack: {bound.Count}/{Classes.Length} bound" +
                  (missing.Count > 0 ? $" — MISSING {string.Join(", ", missing)}" : "") +
                  $" → {LibraryPath}");
    }
}
