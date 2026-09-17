using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Fills Resources/BattleSfxLibrary.asset from the audio drop, by filename. This is why the
/// naming convention is load-bearing: a clip is found at
///   Assets/Audio/SFX/Attack/SFX_&lt;Class&gt;_Attack.wav
///   Assets/Audio/SFX/Special/SFX_&lt;Class&gt;_&lt;Ability&gt;[_&lt;Tier&gt;].wav          (cast phase)
///   Assets/Audio/SFX/Special/SFX_&lt;Class&gt;_&lt;Ability&gt;_Impact[_&lt;Tier&gt;].wav   (impact phase)
///   Assets/Audio/SFX/Move/SFX_Move_*.wav                                    (movement, any number)
///   Assets/Audio/SFX/Defend/SFX_Defend[_NN].wav                              (defend, shared pool — random pick)
///   Assets/Audio/SFX/Defend/SFX_&lt;Class&gt;_Defend.wav                           (defend, per-class override)
///   Assets/Audio/SFX/UI/SFX_UI_Open.wav, SFX_UI_Close.wav                     (in-game panels)
/// so a misspelled class (Spectre for Specter) binds nothing and that class is simply silent.
///
/// For every impact clip the binder also measures where its loudest 50 ms sits and stores that
/// as the slot's impactLead, so playback can start the clip early enough for the crack to land
/// on the hit beat. Read straight from the WAV rather than through the audio subsystem, which
/// is not guaranteed to decode in a -nographics batch run.
///
/// Menu: Clawbada ▸ Audio ▸ Bind Battle SFX. Headless: -executeMethod BattleSfxBinder.Bind
/// Re-run after any drop; missing files are reported rather than failing the bind, so a
/// partial pack still lands.
/// </summary>
public static class BattleSfxBinder
{
    private const string AttackDir = "Assets/Audio/SFX/Attack/";
    private const string SpecialDir = "Assets/Audio/SFX/Special/";
    private const string MoveDir = "Assets/Audio/SFX/Move";
    private const string DefendDir = "Assets/Audio/SFX/Defend";
    private const string UiDir = "Assets/Audio/SFX/UI/";
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

        // Attacks
        if (lib.attackByClass == null || lib.attackByClass.Length != Classes.Length)
            lib.attackByClass = new AudioClip[Classes.Length];
        var bound = new List<string>();
        var missing = new List<string>();
        for (int i = 0; i < Classes.Length; i++)
        {
            var clip = AssetDatabase.LoadAssetAtPath<AudioClip>($"{AttackDir}SFX_{Classes[i]}_Attack.wav");
            lib.attackByClass[i] = clip;
            (clip != null ? bound : missing).Add(Classes[i]);
        }

        // Specials: cast + impact, each shared or per tier. A class with neither is silent on
        // Special, which is expected while the pack is incomplete.
        if (lib.specialByClass == null || lib.specialByClass.Length != Classes.Length)
            lib.specialByClass = new BattleSfxLibrary.SpecialClips[Classes.Length];
        var specialBound = new List<string>();
        for (int i = 0; i < Classes.Length; i++)
        {
            var slot = lib.specialByClass[i] ?? new BattleSfxLibrary.SpecialClips();
            if (slot.cast == null) slot.cast = new BattleSfxLibrary.TierClips();
            if (slot.impact == null) slot.impact = new BattleSfxLibrary.TierClips();
            string stem = $"{SpecialDir}SFX_{Classes[i]}_{Abilities[i]}";

            int castN = Fill(slot.cast, stem);
            int impactN = Fill(slot.impact, stem + "_Impact");
            string leadSource = FirstExisting(stem + "_Impact");
            slot.impactLead = leadSource != null ? MeasureLoudestMoment(leadSource) : 0f;
            lib.specialByClass[i] = slot;

            if (castN + impactN > 0)
                specialBound.Add($"{Classes[i]}/{Abilities[i]} cast×{castN} impact×{impactN}" +
                                 (impactN > 0 ? $" lead {slot.impactLead:F2}s" : ""));
        }

        // Movement: every SFX_Move_*.wav, in name order. Playback picks one at random per hex
        // step, so two files are enough for a scuttle that doesn't sound like a loop.
        var moveClips = new List<AudioClip>();
        if (AssetDatabase.IsValidFolder(MoveDir))
        {
            foreach (var guid in AssetDatabase.FindAssets("t:AudioClip", new[] { MoveDir }))
            {
                string p = AssetDatabase.GUIDToAssetPath(guid);
                if (!Path.GetFileName(p).StartsWith("SFX_Move_", System.StringComparison.OrdinalIgnoreCase)) continue;
                var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(p);
                if (clip != null) moveClips.Add(clip);
            }
        }
        moveClips.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
        lib.move = moveClips.ToArray();

        // Defend: a shared pool (SFX_Defend.wav and/or SFX_Defend_NN.wav — playback picks one at
        // random, like movement), with a per-class file overriding the pool where present.
        var defendClips = new List<AudioClip>();
        if (AssetDatabase.IsValidFolder(DefendDir))
        {
            foreach (var guid in AssetDatabase.FindAssets("t:AudioClip", new[] { DefendDir }))
            {
                string p = AssetDatabase.GUIDToAssetPath(guid);
                string file = Path.GetFileNameWithoutExtension(p);
                if (!(file == "SFX_Defend" || file.StartsWith("SFX_Defend_", System.StringComparison.OrdinalIgnoreCase))) continue;
                var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(p);
                if (clip != null) defendClips.Add(clip);
            }
        }
        defendClips.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
        lib.defend = defendClips.ToArray();
        if (lib.defendByClass == null || lib.defendByClass.Length != Classes.Length) lib.defendByClass = new AudioClip[Classes.Length];
        int defendOverrides = 0;
        for (int i = 0; i < Classes.Length; i++)
        {
            lib.defendByClass[i] = AssetDatabase.LoadAssetAtPath<AudioClip>($"{DefendDir}/SFX_{Classes[i]}_Defend.wav");
            if (lib.defendByClass[i] != null) defendOverrides++;
        }

        // In-game panels: one open and one close clip, shared by every panel.
        lib.uiOpen = AssetDatabase.LoadAssetAtPath<AudioClip>($"{UiDir}SFX_UI_Open.wav");
        lib.uiClose = AssetDatabase.LoadAssetAtPath<AudioClip>($"{UiDir}SFX_UI_Close.wav");

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        Debug.Log($"[BattleSfxBinder] attack: {bound.Count}/{Classes.Length} bound" +
                  (missing.Count > 0 ? $" — MISSING {string.Join(", ", missing)}" : "") +
                  $" | special: {(specialBound.Count > 0 ? string.Join("; ", specialBound) : "none")}" +
                  $" | move ×{lib.move.Length}" +
                  $" | defend ×{lib.defend.Length}{(defendOverrides > 0 ? $" + {defendOverrides} class override(s)" : "")}" +
                  $" | ui: open {(lib.uiOpen != null ? "✓" : "—")} close {(lib.uiClose != null ? "✓" : "—")}" +
                  $" → {LibraryPath}");
    }

    /// <summary>Loads `stem.wav` into shared and `stem_&lt;Tier&gt;.wav` into each tier. Returns how many bound.</summary>
    private static int Fill(BattleSfxLibrary.TierClips t, string stem)
    {
        t.shared = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}.wav");
        t.evolved = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[0]}.wav");
        t.elite = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[1]}.wav");
        t.apex = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[2]}.wav");
        return (t.shared != null ? 1 : 0) + (t.evolved != null ? 1 : 0) + (t.elite != null ? 1 : 0) + (t.apex != null ? 1 : 0);
    }

    private static string FirstExisting(string stem)
    {
        foreach (var suffix in new[] { "", $"_{Tiers[0]}", $"_{Tiers[1]}", $"_{Tiers[2]}" })
        {
            string p = $"{stem}{suffix}.wav";
            if (AssetDatabase.LoadAssetAtPath<AudioClip>(p) != null) return p;
        }
        return null;
    }

    /// <summary>
    /// Seconds from the start of a 16-bit PCM WAV to its loudest 50 ms window — where the strike
    /// actually cracks. 0 if the file can't be read as PCM, which just means "no lead".
    /// </summary>
    private static float MeasureLoudestMoment(string assetPath)
    {
        try
        {
            string full = Path.GetFullPath(Path.Combine(Application.dataPath, "..", assetPath));
            byte[] b = File.ReadAllBytes(full);
            if (b.Length < 44 || System.Text.Encoding.ASCII.GetString(b, 0, 4) != "RIFF") return 0f;

            int pos = 12, channels = 0, rate = 0, bits = 0, dataOff = -1, dataLen = 0;
            while (pos + 8 <= b.Length)
            {
                string id = System.Text.Encoding.ASCII.GetString(b, pos, 4);
                int len = System.BitConverter.ToInt32(b, pos + 4);
                if (id == "fmt ")
                {
                    channels = System.BitConverter.ToInt16(b, pos + 10);
                    rate = System.BitConverter.ToInt32(b, pos + 12);
                    bits = System.BitConverter.ToInt16(b, pos + 22);
                }
                else if (id == "data") { dataOff = pos + 8; dataLen = len; break; }
                pos += 8 + len + (len & 1);
            }
            if (dataOff < 0 || bits != 16 || channels < 1 || rate <= 0) return 0f;
            dataLen = System.Math.Min(dataLen, b.Length - dataOff);

            int frames = dataLen / (2 * channels);
            int win = rate / 20; // 50 ms
            double best = -1; int bestStart = 0;
            for (int start = 0; start + win <= frames; start += win)
            {
                double acc = 0;
                for (int i = 0; i < win; i++)
                {
                    short s = System.BitConverter.ToInt16(b, dataOff + (start + i) * channels * 2); // channel 0
                    acc += (double)s * s;
                }
                if (acc > best) { best = acc; bestStart = start; }
            }
            return bestStart / (float)rate;
        }
        catch (System.Exception e)
        {
            Debug.LogWarning($"[BattleSfxBinder] could not measure {assetPath}: {e.Message}");
            return 0f;
        }
    }
}
