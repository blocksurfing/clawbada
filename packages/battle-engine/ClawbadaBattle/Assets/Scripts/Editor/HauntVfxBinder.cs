using UnityEditor;
using UnityEngine;

/// <summary>
/// Runtime binding for the designer's Specter Haunt drop (design/vfx-specials) — modular pieces,
/// no umbrella prefab, composed by the runtime:
///  • Spirit  = projectile Special: FX_Specter_Haunt_SpiritSpawn at the caster's AttackFX, then
///    FX_Specter_Haunt_SpiritTravel (loop) flown to the target by BattleVfxLibrary.Fly, then
///    FX_Specter_Haunt_PossessImpact on the target; damage lands on the impact.
///    The possession lands on the target's BODY CENTRE (AnchorPoint.TargetBody) and the spirit
///    flies to that same point, so it is absorbed into the lobster rather than stopping at its feet.
///  • Sigil   = status visual for the engine's "haunt" status: FX_Specter_Haunt_SigilSpawn →
///    FX_Specter_Haunt_SigilIdle (loop, parented under the target, sortingOrder −5 = under the
///    body, follows hex moves) → FX_Specter_Haunt_SigilOut when the status expires or is cleansed.
/// Menu: Clawbada ▸ VFX ▸ Bind Specter Haunt. Headless: -executeMethod InfernoVfxBinder.BindAll
/// </summary>
public static class HauntVfxBinder
{
    private const int Specter = 4;
    private const string Dir = "Assets/Prefabs/VFX/";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const float Fps = 12f;
    /// <summary>The spirit detaches on the last SpiritSpawn frame (7 frames).</summary>
    private const float LaunchAt = 6f / Fps;
    /// <summary>Possession starts absorbing on the impact's second frame.</summary>
    private const float ImpactLead = 1f / Fps;
    /// <summary>A drifting ghost: slower than Inferno's fireball (7 u/s); Haunt's 3-hex range ≈ 0.95 s.</summary>
    private const float TravelSpeed = 5.5f;

    [MenuItem("Clawbada/VFX/Bind Specter Haunt")]
    public static void Bind()
    {
        var spiritSpawn = Load("FX_Specter_Haunt_SpiritSpawn", oneShot: true);
        var spiritTravel = Load("FX_Specter_Haunt_SpiritTravel", oneShot: false);
        var possess = Load("FX_Specter_Haunt_PossessImpact", oneShot: true);
        var sigilSpawn = Load("FX_Specter_Haunt_SigilSpawn", oneShot: true);
        var sigilIdle = Load("FX_Specter_Haunt_SigilIdle", oneShot: false);
        var sigilOut = Load("FX_Specter_Haunt_SigilOut", oneShot: true);

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[HauntVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];
        if (lib.specialImpactByClass == null || lib.specialImpactByClass.Length < 10) lib.specialImpactByClass = new BattleVfxLibrary.VfxSlot[10];
        lib.specialByClass[Specter] = new BattleVfxLibrary.VfxSlot
        {
            prefab = spiritSpawn, anchor = BattleVfxLibrary.AnchorPoint.ActorAttackFx, delay = 0f, mirrorWithFacing = true,
            impactAt = 0f, travelPrefab = spiritTravel, travelSpeed = TravelSpeed, launchAt = LaunchAt, impactLead = ImpactLead,
        };
        lib.specialImpactByClass[Specter] = new BattleVfxLibrary.VfxSlot
        {
            // Body centre, not the rig's ImpactFX (every rig authors that at the root = the feet):
            // the spirit should read as being absorbed into the target, not landing beside it.
            prefab = possess, anchor = BattleVfxLibrary.AnchorPoint.TargetBody, delay = 0f, mirrorWithFacing = false, onTop = false,
        };

        var visuals = new System.Collections.Generic.List<BattleVfxLibrary.StatusVfx>(lib.statusVisuals ?? new BattleVfxLibrary.StatusVfx[0]);
        visuals.RemoveAll(v => v != null && string.Equals(v.status, "haunt", System.StringComparison.OrdinalIgnoreCase));
        visuals.Add(new BattleVfxLibrary.StatusVfx { status = "haunt", spawn = sigilSpawn, loop = sigilIdle, end = sigilOut, yOffset = 0f });
        lib.statusVisuals = visuals.ToArray();

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[HauntVfxBinder] OK — spirit spawn {BattleVfxLibrary.ClipLength(spiritSpawn):F2}s (launchAt {LaunchAt:F2}s) + travel loop " +
                     $"{BattleVfxLibrary.ClipLength(spiritTravel):F2}s at {TravelSpeed} u/s + possess {BattleVfxLibrary.ClipLength(possess):F2}s; " +
                     $"sigil spawn {BattleVfxLibrary.ClipLength(sigilSpawn):F2}s / idle loop {BattleVfxLibrary.ClipLength(sigilIdle):F2}s / out {BattleVfxLibrary.ClipLength(sigilOut):F2}s bound for Specter";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static GameObject Load(string name, bool oneShot)
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(Dir + name + ".prefab");
        if (prefab == null) throw new System.Exception($"[HauntVfxBinder] missing {Dir}{name}.prefab");
        bool has = prefab.GetComponent<OneShotVfx>() != null;
        if (oneShot && !has) Debug.LogWarning($"[HauntVfxBinder] {name} is a one-shot but has no OneShotVfx — it will never be destroyed");
        if (!oneShot && has) Debug.LogWarning($"[HauntVfxBinder] {name} is a loop but carries OneShotVfx — the runtime strips it at spawn");
        return prefab;
    }
}
