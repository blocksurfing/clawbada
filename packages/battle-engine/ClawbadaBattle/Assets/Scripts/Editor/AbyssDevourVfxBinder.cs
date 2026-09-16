using UnityEditor;
using UnityEngine;

/// <summary>
/// Binds the designer-exported Abyss Devour prefab (Assets/Prefabs/VFX/FX_Abyss_Devour.prefab —
/// Spawn / Idle / Suck / Out on one 1.5 s clip) to specialByClass[Abyss]: a cinematic at the
/// target's feet with the hit beat at 0.5 s. The "Suck" child renders above the victim and the
/// vortex below it via VfxSlot.frontChildPrefix, on the lobsters' own sorting layer.
///
/// Menu: Clawbada ▸ VFX ▸ Bind Abyss Devour. Headless: -executeMethod AbyssDevourVfxBinder.Bind
/// </summary>
public static class AbyssDevourVfxBinder
{
    private const int Abyss = 7;
    private const string PrefabPath = "Assets/Prefabs/VFX/FX_Abyss_Devour.prefab";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    private const float ImpactAt = 0.5f;

    [MenuItem("Clawbada/VFX/Bind Abyss Devour")]
    public static void Bind()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null) throw new System.Exception($"[AbyssDevourVfxBinder] missing {PrefabPath}");
        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[AbyssDevourVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];

        lib.specialByClass[Abyss] = new BattleVfxLibrary.VfxSlot
        {
            prefab = prefab,
            anchor = BattleVfxLibrary.AnchorPoint.TargetFeet,
            mirrorWithFacing = false,
            impactAt = ImpactAt,
            frontChildPrefix = "Suck",
        };
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        Debug.Log($"[AbyssDevourVfxBinder] OK — {prefab.name} ({BattleVfxLibrary.ClipLength(prefab):F2}s, impactAt {ImpactAt:F2}s, " +
                  $"front children 'Suck*' above the target, the rest below) bound to specialByClass[7]/Abyss Devour");
    }
}
