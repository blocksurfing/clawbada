using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Runtime binding for the designer's Tempest Maelstrom drop (design/vfx-specials):
///  • builds FX_Tempest_Maelstrom_Hit (5-frame electric hit) as a one-shot prefab from the
///    sliced Hit sheet, and
///  • fills BattleVfxLibrary: specialByClass[Tempest] = the full-screen storm prefab
///    (CameraCenter anchor, impact beat on the lightning flash, Hit_* guide children hidden),
///    specialImpactByClass[Tempest] = the electric hit (spawned on every struck enemy).
/// Menu: Clawbada ▸ VFX ▸ Bind Tempest Maelstrom. Headless: -executeMethod MaelstromVfxBinder.Bind
/// </summary>
public static class MaelstromVfxBinder
{
    private const int Tempest = 3;
    private const string HitSheet = "Assets/Art/FX/Attack/Tempest/FX_Tempest_Maelstrom_Hit.png";
    private const string StormPrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom.prefab";
    private const string HitPrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom_Hit.prefab";
    private const string HitClipPath = "Assets/Prefabs/VFX/Clips/FX_Tempest_Maelstrom_Hit.anim";
    private const string HitControllerPath = "Assets/Prefabs/VFX/Clips/AC_FX_Tempest_Maelstrom_Hit.controller";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";
    /// <summary>Lightning flash peak in the designer's committed clip (Flash alpha 0.95 at 3.83 s; hits at 4.0 s).</summary>
    private const float ImpactAt = 3.9f;
    private const float HitFps = 24f;

    [MenuItem("Clawbada/VFX/Bind Tempest Maelstrom")]
    public static void Bind()
    {
        var storm = AssetDatabase.LoadAssetAtPath<GameObject>(StormPrefabPath);
        if (storm == null) throw new System.Exception($"[MaelstromVfxBinder] missing {StormPrefabPath}");
        var hitPrefab = BuildHitPrefab();

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[MaelstromVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];
        if (lib.specialImpactByClass == null || lib.specialImpactByClass.Length < 10) lib.specialImpactByClass = new BattleVfxLibrary.VfxSlot[10];
        lib.specialByClass[Tempest] = new BattleVfxLibrary.VfxSlot
        {
            prefab = storm, anchor = BattleVfxLibrary.AnchorPoint.CameraCenter, delay = 0f,
            mirrorWithFacing = false, impactAt = ImpactAt, hideChildrenPrefix = "Hit_",
        };
        lib.specialImpactByClass[Tempest] = new BattleVfxLibrary.VfxSlot
        {
            prefab = hitPrefab, anchor = BattleVfxLibrary.AnchorPoint.TargetImpactFx, delay = 0f, mirrorWithFacing = false,
            onTop = true, // above the storm's dim overlay and clouds (it was drawn behind them)
        };
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[MaelstromVfxBinder] OK — storm {storm.name} (clip {BattleVfxLibrary.ClipLength(storm):F2}s, impactAt {ImpactAt:F2}s) + hit {hitPrefab.name} ({BattleVfxLibrary.ClipLength(hitPrefab):F2}s) bound for Tempest";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static GameObject BuildHitPrefab()
    {
        var sprites = AssetDatabase.LoadAllAssetsAtPath(HitSheet).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length == 0) throw new System.Exception($"[MaelstromVfxBinder] no sliced sprites in {HitSheet} — run Clawbada/VFX/Build Tempest Maelstrom Animation Asset first");

        var clip = new AnimationClip { frameRate = HitFps };
        var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = "", propertyName = "m_Sprite" };
        var keys = new ObjectReferenceKeyframe[sprites.Length + 1];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = i / HitFps, value = sprites[i] };
        keys[sprites.Length] = new ObjectReferenceKeyframe { time = sprites.Length / HitFps + 0.08f, value = sprites[sprites.Length - 1] }; // short hold on the last frame
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = false;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        AssetDatabase.DeleteAsset(HitClipPath);
        AssetDatabase.CreateAsset(clip, HitClipPath);
        AssetDatabase.DeleteAsset(HitControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(HitControllerPath, clip);

        var go = new GameObject("FX_Tempest_Maelstrom_Hit");
        try
        {
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            sr.sortingLayerName = DepthSort.Layer;
            var animator = go.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            go.AddComponent<OneShotVfx>();
            return PrefabUtility.SaveAsPrefabAsset(go, HitPrefabPath);
        }
        finally
        {
            Object.DestroyImmediate(go);
        }
    }
}
