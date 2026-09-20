using UnityEditor;
using UnityEngine;

/// <summary>
/// Lands the designer-exported Leviathan Crush special VFX.
///
/// Unlike the sheet-slicing binders, the drop already carries a hand-authored prefab
/// (FX_Leviathan_Crush) whose clip drives four layers off one timeline — Strike_Back and
/// Shockwave behind the target, Front_Strike and Front_Stone over it — so this binder
/// only owns the slot settings and leaves the designer's prefab as the source of truth.
///
/// The art is an IMPACT burst, not a wind-up: frame 0 is the full flash and the remaining
/// six frames are the shockwave dissipating. So the effect is spawned on the swing's contact
/// frame (spawnAtContact) with no impactAt beat of its own — the slam IS the beat. Setting
/// impactAt here instead would take the cinematic branch, which spawns the burst at the top
/// of the turn and lands the damage after the ring has already faded.
///
/// Menu: Clawbada ▸ VFX ▸ Bind Leviathan Crush. Headless: -executeMethod InfernoVfxBinder.BindAll
/// </summary>
public static class LeviathanCrushVfxBinder
{
    private const int Leviathan = 2;
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Leviathan_Crush.prefab";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";

    [MenuItem("Clawbada/VFX/Bind Leviathan Crush")]
    public static void Bind()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null) throw new System.Exception($"[LeviathanCrushVfxBinder] missing {PrefabPath}");

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[LeviathanCrushVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];

        lib.specialByClass[Leviathan] = new BattleVfxLibrary.VfxSlot
        {
            prefab = prefab,
            anchor = BattleVfxLibrary.AnchorPoint.TargetImpactFx,
            delay = 0f,
            spawnAtContact = true,    // the burst lands on the slam, not at the top of the turn
            impactAt = 0f,            // the swing's contact frame is the beat — see the class note
            mirrorWithFacing = false, // radially symmetric; nothing to flip
            frontChildPrefix = "Front",
            shakeAmplitude = 0.09f,   // heaviest single-target hit in the game; a slam should land
            shakeSeconds = 0.3f,
        };

        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[LeviathanCrushVfxBinder] OK — {BattleVfxLibrary.ClipLength(prefab):F2}s burst " +
                     "(front: Front_Strike/Front_Stone, behind: Strike_Back/Shockwave) bound to specialByClass[2]/Leviathan Crush";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }
}
