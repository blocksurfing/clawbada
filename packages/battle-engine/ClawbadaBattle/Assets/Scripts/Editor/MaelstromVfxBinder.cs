using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Runtime binding for the designer's Tempest Maelstrom drop (design/vfx-specials):
///  • builds FX_Tempest_Maelstrom_Hit (5-frame electric hit) as a one-shot prefab from the
///    sliced Hit sheet, and
///  • builds FX_Tempest_Maelstrom_Strike — the per-target composite: the designer's
///    FX_Tempest_Maelstrom_LightningBolt (5 frames, 48×304, pivot at the tip so it strikes
///    DOWN onto the target) plus the electric hit sparks on the body, and
///  • fills BattleVfxLibrary: specialByClass[Tempest] = the full-screen storm prefab
///    (CameraCenter anchor, impact beat on the lightning flash, Hit_* guide children hidden),
///    specialImpactByClass[Tempest] = the strike composite (spawned on every struck enemy, onTop).
/// Menu: Clawbada ▸ VFX ▸ Bind Tempest Maelstrom. Headless: -executeMethod MaelstromVfxBinder.Bind
/// </summary>
public static class MaelstromVfxBinder
{
    private const int Tempest = 3;
    private const string HitSheet = "Assets/Art/FX/Attack/Tempest/FX_Tempest_Maelstrom_Hit.png";
    private const string StormPrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom.prefab";
    private const string HitPrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom_Hit.prefab";
    private const string BoltPrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom_LightningBolt.prefab";
    private const string StrikePrefabPath = "Assets/Prefabs/VFX/FX_Tempest_Maelstrom_Strike.prefab";
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
        var bolt = AssetDatabase.LoadAssetAtPath<GameObject>(BoltPrefabPath);
        var strike = bolt != null ? BuildStrikePrefab(bolt, hitPrefab) : hitPrefab;
        if (bolt == null) Debug.LogWarning($"[MaelstromVfxBinder] no {BoltPrefabPath} — binding the electric hit alone");

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
            prefab = strike, anchor = BattleVfxLibrary.AnchorPoint.TargetImpactFx, delay = 0f, mirrorWithFacing = false,
            onTop = true, // above the storm's dim overlay and clouds (it was drawn behind them)
        };
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[MaelstromVfxBinder] OK — storm {storm.name} (clip {BattleVfxLibrary.ClipLength(storm):F2}s, impactAt {ImpactAt:F2}s) + per-target {strike.name} " +
                     $"(bolt {(bolt != null ? BattleVfxLibrary.ClipLength(bolt) : 0f):F2}s, hit {BattleVfxLibrary.ClipLength(hitPrefab):F2}s) bound for Tempest";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    /// <summary>Bolt + sparks as one per-target effect. The root has no Animator, so its OneShotVfx uses
    /// the fallback lifetime; each child is a nested prefab instance that plays its own one-shot clip.
    /// The sparks sort above the bolt inside the effect's SortingGroup.</summary>
    private static GameObject BuildStrikePrefab(GameObject bolt, GameObject hit)
    {
        var root = new GameObject("FX_Tempest_Maelstrom_Strike");
        try
        {
            var life = root.AddComponent<OneShotVfx>();
            life.fallbackLifetime = Mathf.Max(BattleVfxLibrary.ClipLength(bolt), BattleVfxLibrary.ClipLength(hit)) + 0.1f;
            var boltChild = (GameObject)PrefabUtility.InstantiatePrefab(bolt);
            boltChild.transform.SetParent(root.transform, false);
            // The bolt strikes DOWN: its tip (5 % up from the sheet's bottom edge) must sit on the
            // anchor. The designer's sheet stores a custom pivot but leaves alignment = Center, so
            // Unity ignores it — compute the offset from the sprite's bounds instead. Robust to a
            // later pivot fix: with a tip pivot the offset becomes 0.
            var boltSr = boltChild.GetComponent<SpriteRenderer>();
            if (boltSr != null && boltSr.sprite != null)
            {
                var b = boltSr.sprite.bounds;
                boltChild.transform.localPosition = new Vector3(0f, -(b.min.y + 0.05f * b.size.y), 0f);
            }
            var hitChild = (GameObject)PrefabUtility.InstantiatePrefab(hit);
            hitChild.transform.SetParent(root.transform, false);
            var hitSr = hitChild.GetComponent<SpriteRenderer>();
            if (hitSr != null) hitSr.sortingOrder = 1;
            return PrefabUtility.SaveAsPrefabAsset(root, StrikePrefabPath);
        }
        finally
        {
            Object.DestroyImmediate(root);
        }
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
