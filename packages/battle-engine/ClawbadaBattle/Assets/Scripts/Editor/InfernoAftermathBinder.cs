using UnityEditor;
using UnityEngine;

/// <summary>
/// Binds the designer's Inferno follow-up prefabs (built by InfernoHazardVfxBinder, which deliberately
/// leaves the library alone) as Ember's Special AFTERMATH: cosmetic effects on the target on the burst.
///   EmberScatter — one-shot at the explosion point.
///   FirePatch    — a brief SCORCH at the target's feet: lingers 0.8 s, fades over 0.4 s.
/// Decided with the user 2026-09-27: Inferno leaves NO lingering hazard in the rules, so the patch must
/// never stay long enough to read as a burning-ground zone. Re-run after the designer rebuilds the prefabs.
/// Menu: Clawbada ▸ VFX ▸ Bind Inferno Aftermath. Headless: -executeMethod InfernoAftermathBinder.Bind
/// </summary>
public static class InfernoAftermathBinder
{
    private const int Ember = 9;
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const string ScatterPath = "Assets/Prefabs/VFX/FX_Ember_Inferno_EmberScatter.prefab";
    private const string PatchPath = "Assets/Prefabs/VFX/FX_Ember_Inferno_FirePatch.prefab";
    private const float ScorchLinger = 0.8f;

    [MenuItem("Clawbada/VFX/Bind Inferno Aftermath")]
    public static void Bind()
    {
        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[InfernoAftermathBinder] missing {LibraryPath}");
        var scatter = AssetDatabase.LoadAssetAtPath<GameObject>(ScatterPath);
        var patch = AssetDatabase.LoadAssetAtPath<GameObject>(PatchPath);
        if (scatter == null || patch == null) throw new System.Exception("[InfernoAftermathBinder] missing prefabs — run Clawbada ▸ VFX ▸ Bind Ember Inferno Hazard VFX first");

        if (lib.specialAftermathByClass == null || lib.specialAftermathByClass.Length < 10) lib.specialAftermathByClass = new BattleVfxLibrary.AftermathSet[10];
        for (int i = 0; i < lib.specialAftermathByClass.Length; i++)
            if (lib.specialAftermathByClass[i] == null) lib.specialAftermathByClass[i] = new BattleVfxLibrary.AftermathSet();
        lib.specialAftermathByClass[Ember] = new BattleVfxLibrary.AftermathSet
        {
            slots = new[]
            {
                new BattleVfxLibrary.VfxSlot { prefab = scatter, anchor = BattleVfxLibrary.AnchorPoint.TargetImpactFx, mirrorWithFacing = true },
                new BattleVfxLibrary.VfxSlot { prefab = patch, anchor = BattleVfxLibrary.AnchorPoint.TargetFeet, mirrorWithFacing = false, lingerSeconds = ScorchLinger },
            },
        };
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        string msg = $"[InfernoAftermathBinder] OK — Ember aftermath: EmberScatter at impact + FirePatch scorch ({ScorchLinger:F1}s linger, 0.4s fade)";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }
}
