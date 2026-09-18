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
///   Assets/Audio/SFX/Special/SFX_&lt;Class&gt;_&lt;Ability&gt;[_Impact]_NN.wav        (numbered takes, random pick)
///   Assets/Audio/SFX/Move/SFX_Move_*.wav                                    (movement, any number)
///   Assets/Audio/SFX/Defend/SFX_Defend[_NN].wav                              (defend, shared pool — random pick)
///   Assets/Audio/SFX/Defend/SFX_&lt;Class&gt;_Defend.wav                           (defend, per-class override)
///   Assets/Audio/SFX/UI/SFX_UI_Open.wav, SFX_UI_Close.wav                     (in-game panels)
///   Assets/Audio/SFX/Death/SFX_Death[_NN].wav                                (death, shared pool — random pick)
///   Assets/Audio/SFX/Death/SFX_&lt;Class&gt;_Death.wav                             (death, per-class override)
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
    private const string DeathDir = "Assets/Audio/SFX/Death";
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
                specialBound.Add($"{Classes[i]}/{Abilities[i]} cast×{castN}" +
                                 (slot.cast.variantBeats.Length > 0 ? $" (beats {string.Join("/", System.Array.ConvertAll(slot.cast.variantBeats, b => b.ToString("F2")))}s)" : "") +
                                 $" impact×{impactN}" + (impactN > 0 ? $" lead {slot.impactLead:F2}s" : ""));
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

        // Defend and Death: a shared pool (SFX_<Name>.wav and/or SFX_<Name>_NN.wav — playback
        // picks one at random, like movement), with a per-class file overriding the pool.
        lib.defend = Pool(DefendDir, "SFX_Defend");
        int defendOverrides = Overrides(DefendDir, "Defend", ref lib.defendByClass);
        lib.death = Pool(DeathDir, "SFX_Death");
        int deathOverrides = Overrides(DeathDir, "Death", ref lib.deathByClass);

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
                  $" | death ×{lib.death.Length}{(deathOverrides > 0 ? $" + {deathOverrides} class override(s)" : "")}" +
                  $" | ui: open {(lib.uiOpen != null ? "✓" : "—")} close {(lib.uiClose != null ? "✓" : "—")}" +
                  $" → {LibraryPath}");
    }

    /// <summary>Every `stem.wav` / `stem_NN.wav` in a folder, in name order — a pool playback draws from at random.</summary>
    private static AudioClip[] Pool(string dir, string stem)
    {
        var clips = new List<AudioClip>();
        if (AssetDatabase.IsValidFolder(dir))
        {
            foreach (var guid in AssetDatabase.FindAssets("t:AudioClip", new[] { dir }))
            {
                string p = AssetDatabase.GUIDToAssetPath(guid);
                string file = Path.GetFileNameWithoutExtension(p);
                if (!(file == stem || file.StartsWith(stem + "_", System.StringComparison.OrdinalIgnoreCase))) continue;
                var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(p);
                if (clip != null) clips.Add(clip);
            }
        }
        clips.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
        return clips.ToArray();
    }

    /// <summary>`dir/SFX_&lt;Class&gt;_&lt;ability&gt;.wav` per class into the by-class array. Returns how many are set.</summary>
    private static int Overrides(string dir, string ability, ref AudioClip[] byClass)
    {
        if (byClass == null || byClass.Length != Classes.Length) byClass = new AudioClip[Classes.Length];
        int n = 0;
        for (int i = 0; i < Classes.Length; i++)
        {
            byClass[i] = AssetDatabase.LoadAssetAtPath<AudioClip>($"{dir}/SFX_{Classes[i]}_{ability}.wav");
            if (byClass[i] != null) n++;
        }
        return n;
    }

    /// <summary>Loads `stem.wav` into shared, `stem_&lt;Tier&gt;.wav` into each tier and `stem_NN.wav` into the numbered
    /// takes. Returns how many bound.</summary>
    private static int Fill(BattleSfxLibrary.TierClips t, string stem)
    {
        t.shared = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}.wav");
        t.evolved = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[0]}.wav");
        t.elite = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[1]}.wav");
        t.apex = AssetDatabase.LoadAssetAtPath<AudioClip>($"{stem}_{Tiers[2]}.wav");
        // Where the hit sits inside each file: a cast clip that carries its own landing (two
        // connected Bind takes) has the swing timed to it; an impact clip is started early by it.
        t.sharedBeat = t.shared != null ? MeasureLoudestMoment($"{stem}.wav") : 0f;
        t.evolvedBeat = t.evolved != null ? MeasureLoudestMoment($"{stem}_{Tiers[0]}.wav") : 0f;
        t.eliteBeat = t.elite != null ? MeasureLoudestMoment($"{stem}_{Tiers[1]}.wav") : 0f;
        t.apexBeat = t.apex != null ? MeasureLoudestMoment($"{stem}_{Tiers[2]}.wav") : 0f;
        var takes = new List<AudioClip>();
        var beats = new List<float>();
        for (int n = 1; n <= 20; n++)
        {
            string p = $"{stem}_{n:00}.wav";
            var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(p);
            if (clip == null) continue;
            takes.Add(clip);
            beats.Add(MeasureLoudestMoment(p));
        }
        t.variants = takes.ToArray();
        t.variantBeats = beats.ToArray();
        return (t.shared != null ? 1 : 0) + (t.evolved != null ? 1 : 0) + (t.elite != null ? 1 : 0) + (t.apex != null ? 1 : 0) + takes.Count;
    }

    private static string FirstExisting(string stem)
    {
        foreach (var suffix in new[] { "", $"_{Tiers[0]}", $"_{Tiers[1]}", $"_{Tiers[2]}", "_01" })
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
