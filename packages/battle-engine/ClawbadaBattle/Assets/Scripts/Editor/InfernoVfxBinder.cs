using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Runtime binding for the designer's Ember Inferno drop (design/vfx-specials) — the first
/// projectile Special. The designer's preview clip (FX_Ember_Inferno.anim, 12 fps) plays
/// Spawn → TravelLoop ×3 → Impact on one fixed timeline; the runtime needs the three beats as
/// separate pieces so the travel loop can last exactly the caster→target flight:
///  • FX_Ember_Inferno_Spawn   — 23-frame one-shot formation at the caster's AttackFX
///  • FX_Ember_Inferno_Travel  — 5-frame LOOP flown by BattleVfxLibrary.Fly at a fixed speed
///  • FX_Ember_Inferno_Impact  — 12-frame one-shot on the target's ImpactFX (burst on frame 5)
/// and fills BattleVfxLibrary: specialByClass[Ember] = Spawn + travelPrefab/launchAt/impactLead,
/// specialImpactByClass[Ember] = Impact (onTop).
/// Menu: Clawbada ▸ VFX ▸ Bind Ember Inferno. Headless: -executeMethod InfernoVfxBinder.BindAll
/// </summary>
public static class InfernoVfxBinder
{
    private const int Ember = 9;
    private const string SheetDir = "Assets/Art/FX/Attack/Ember/";
    private const string PrefabDir = "Assets/Prefabs/VFX/";
    private const string ClipDir = "Assets/Prefabs/VFX/Clips/";
    private const string LibraryPath = "Assets/Prefabs/VFX/BattleVfxLibrary.asset";

    /// <summary>The designer's committed clip runs at 12 fps; the three runtime pieces keep that rate.</summary>
    private const float Fps = 12f;
    private const int SpawnFrames = 23, TravelFrames = 5, ImpactFrames = 12;
    /// <summary>The projectile leaves on the Spawn strip's last frame (the fireball is already trailing off).</summary>
    private const float LaunchAt = 22f / Fps;
    /// <summary>The Impact strip bursts on frame 5; frames 0–4 are the fireball's dying sparks and a dot.</summary>
    private const float ImpactLead = 5f / Fps;
    /// <summary>World units per second: ~4 hexes/s — adjacent ≈ 0.25 s, Inferno's 4-hex max range ≈ 1.0 s.</summary>
    private const float TravelSpeed = 7f;

    [MenuItem("Clawbada/VFX/Bind Ember Inferno")]
    public static void Bind()
    {
        var spawn = BuildPrefab("FX_Ember_Inferno_Spawn", SheetDir + "FX_Ember_Inferno_Spawn.png", SpawnFrames, loop: false, oneShot: true);
        var travel = BuildPrefab("FX_Ember_Inferno_Travel", SheetDir + "FX_Ember_Inferno_TravelLoop.png", TravelFrames, loop: true, oneShot: false);
        var impact = BuildPrefab("FX_Ember_Inferno_Impact", SheetDir + "FX_Ember_Inferno_Impact.png", ImpactFrames, loop: false, oneShot: true);

        var lib = AssetDatabase.LoadAssetAtPath<BattleVfxLibrary>(LibraryPath);
        if (lib == null) throw new System.Exception($"[InfernoVfxBinder] missing {LibraryPath}");
        if (lib.specialByClass == null || lib.specialByClass.Length < 10) lib.specialByClass = new BattleVfxLibrary.VfxSlot[10];
        if (lib.specialImpactByClass == null || lib.specialImpactByClass.Length < 10) lib.specialImpactByClass = new BattleVfxLibrary.VfxSlot[10];
        lib.specialByClass[Ember] = new BattleVfxLibrary.VfxSlot
        {
            prefab = spawn, anchor = BattleVfxLibrary.AnchorPoint.ActorAttackFx, delay = 0f, mirrorWithFacing = true,
            impactAt = 0f, travelPrefab = travel, travelSpeed = TravelSpeed, launchAt = LaunchAt, impactLead = ImpactLead,
        };
        lib.specialImpactByClass[Ember] = new BattleVfxLibrary.VfxSlot
        {
            prefab = impact, anchor = BattleVfxLibrary.AnchorPoint.TargetImpactFx, delay = 0f, mirrorWithFacing = false, onTop = true,
        };
        EditorUtility.SetDirty(lib);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        string msg = $"[InfernoVfxBinder] OK — spawn {BattleVfxLibrary.ClipLength(spawn):F2}s (launchAt {LaunchAt:F2}s) + travel loop " +
                     $"{BattleVfxLibrary.ClipLength(travel):F2}s/cycle at {TravelSpeed} u/s + impact {BattleVfxLibrary.ClipLength(impact):F2}s (burst at {ImpactLead:F2}s) bound for Ember";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    /// <summary>Headless one-shot: rebinds every Special drop currently landed in this branch.</summary>
    public static void BindAll()
    {
        BulwarkFortifyVfxBinder.Bind();
        MaelstromVfxBinder.Bind();
        Bind();
        HauntVfxBinder.Bind();
    }

    private static GameObject BuildPrefab(string name, string sheet, int expectedFrames, bool loop, bool oneShot)
    {
        var sprites = AssetDatabase.LoadAllAssetsAtPath(sheet).OfType<Sprite>().OrderBy(s => s.name).ToArray();
        if (sprites.Length != expectedFrames)
            throw new System.Exception($"[InfernoVfxBinder] {sheet}: expected {expectedFrames} sliced sprites, found {sprites.Length}");

        // One key per frame. Unity pads a sprite curve by one frame after its last key, so the
        // clip's length is exactly n/Fps and every frame shows for 1/Fps — the travel loop cycles
        // in a clean 5/12 s with no doubled last frame.
        var clip = new AnimationClip { frameRate = Fps };
        var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = "", propertyName = "m_Sprite" };
        var keys = new ObjectReferenceKeyframe[sprites.Length];
        for (int i = 0; i < sprites.Length; i++) keys[i] = new ObjectReferenceKeyframe { time = i / Fps, value = sprites[i] };
        AnimationUtility.SetObjectReferenceCurve(clip, binding, keys);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = loop;
        settings.startTime = 0f;
        settings.stopTime = sprites.Length / Fps;   // explicit: clip.length is exactly n frames
        AnimationUtility.SetAnimationClipSettings(clip, settings);

        string clipPath = ClipDir + name + ".anim";
        string controllerPath = ClipDir + "AC_" + name + ".controller";
        string prefabPath = PrefabDir + name + ".prefab";
        AssetDatabase.DeleteAsset(clipPath);
        AssetDatabase.CreateAsset(clip, clipPath);
        AssetDatabase.DeleteAsset(controllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPathWithClip(controllerPath, clip);

        var go = new GameObject(name);
        try
        {
            var sr = go.AddComponent<SpriteRenderer>();
            sr.sprite = sprites[0];
            sr.sortingLayerName = DepthSort.Layer;
            var animator = go.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            if (oneShot) go.AddComponent<OneShotVfx>();
            return PrefabUtility.SaveAsPrefabAsset(go, prefabPath);
        }
        finally
        {
            Object.DestroyImmediate(go);
        }
    }
}
