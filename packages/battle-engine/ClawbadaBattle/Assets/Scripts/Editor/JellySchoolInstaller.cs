using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Puts the jellyfish school into the Elite arena prefab: a "Jellies" child with a JellySchool component that
/// references Nzib's JellyFish.prefab. Idempotent — a second run changes nothing (the prefab is saved only
/// when something was missing) and it never overwrites a config the designer tuned. The asset is validated
/// first, so a half-landed drop (LFS pointers not pulled, a renamed state) fails here instead of in a battle.
/// Nothing else in the prefab (BG - 2.1, the Fish child, the seaweed, his layer orders) is touched.
/// Menu: Clawbada ▸ Arena ▸ Install Elite Jellyfish. Headless:
///   Unity -batchmode -nographics -quit -executeMethod JellySchoolInstaller.Install
/// </summary>
public static class JellySchoolInstaller
{
    public const string ArenaPrefabPath = "Assets/Art/Arenas/Elite/ArenaArt_Elite.prefab";
    public const string JellyPrefabPath = "Assets/Art/Arenas/Elite/Decoration/Jelly Fish/JellyFish.prefab";
    /// <summary>Nzib's floor plate (Background/0) — it carries the SpriteMask that hides a jellyfish below its edge.</summary>
    public const string GroundName = "Ground";

    [MenuItem("Clawbada/Arena/Install Elite Jellyfish")]
    public static void Install() => InstallInto();

    /// <summary>Remove the Jellies child and install it afresh — after a config field was renamed, so the
    ///         prefab carries no stale serialized keys. The designer's layers are untouched.</summary>
    [MenuItem("Clawbada/Arena/Reinstall Elite Jellyfish (reset config)")]
    public static void Reinstall()
    {
        var root = PrefabUtility.LoadPrefabContents(ArenaPrefabPath);
        try
        {
            var t = root.transform.Find(JellySchool.ChildName);
            if (t != null) { UnityEngine.Object.DestroyImmediate(t.gameObject); PrefabUtility.SaveAsPrefabAsset(root, ArenaPrefabPath); }
        }
        finally { PrefabUtility.UnloadPrefabContents(root); }
        AssetDatabase.SaveAssets();
        InstallInto();
    }

    /// <summary>Returns true when the prefab was changed.</summary>
    public static bool InstallInto()
    {
        var jelly = AssetDatabase.LoadAssetAtPath<GameObject>(JellyPrefabPath);
        if (jelly == null) throw new Exception($"[JellySchoolInstaller] {JellyPrefabPath} missing — land origin/design/vfx-specials and `git lfs pull` first");
        ValidateJelly(jelly);

        var root = PrefabUtility.LoadPrefabContents(ArenaPrefabPath);
        bool changed = false;
        try
        {
            var t = root.transform.Find(JellySchool.ChildName);
            if (t == null)
            {
                t = new GameObject(JellySchool.ChildName).transform;
                t.SetParent(root.transform, false);
                changed = true;
            }
            if (t.localPosition != Vector3.zero || t.localRotation != Quaternion.identity || t.localScale != Vector3.one)
            {
                t.localPosition = Vector3.zero; t.localRotation = Quaternion.identity; t.localScale = Vector3.one;
                changed = true;
            }
            var school = t.GetComponent<JellySchool>();
            if (school == null) { school = t.gameObject.AddComponent<JellySchool>(); changed = true; }
            if (school.jellyPrefab != jelly) { school.jellyPrefab = jelly; changed = true; }
            if (school.config == null) { school.config = new JellySchoolConfig(); changed = true; }
            changed |= InstallFloorMask(root.transform, school.sortingOrder);
            if (changed) PrefabUtility.SaveAsPrefabAsset(root, ArenaPrefabPath);
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(root);
        }
        if (changed) AssetDatabase.SaveAssets();
        Report($"[JellySchoolInstaller] OK — {(changed ? "installed" : "already installed, unchanged")}");
        return changed;
    }

    /// <summary>The floor plate masks the jellyfish (user 2026-10-08: "spawn underneath the arena top so they visually
    /// don't just pop on the screen"): a SpriteMask on Ground with the plate's own sprite, limited to the jellyfish's
    /// sorting slot, so a jellyfish that starts below the plate's painted edge rises into view from behind it. Only
    /// the jellyfish opt in (JellySchool sets VisibleOutsideMask); the plate, Nzib's fish and his layers ignore it.
    /// Returns true when something was changed.</summary>
    public static bool InstallFloorMask(Transform root, int jellyOrder)
    {
        var ground = root.Find(GroundName);
        if (ground == null) throw new Exception($"[JellySchoolInstaller] ArenaArt_Elite has no '{GroundName}' child to mask the jellyfish with");
        var sr = ground.GetComponent<SpriteRenderer>();
        if (sr == null || sr.sprite == null) throw new Exception($"[JellySchoolInstaller] '{GroundName}' has no sprite");
        bool changed = false;
        var mask = ground.GetComponent<SpriteMask>();
        if (mask == null) { mask = ground.gameObject.AddComponent<SpriteMask>(); changed = true; }
        int layer = SortingLayer.NameToID("Background");
        if (mask.sprite != sr.sprite) { mask.sprite = sr.sprite; changed = true; }
        if (!mask.isCustomRangeActive) { mask.isCustomRangeActive = true; changed = true; }
        if (mask.frontSortingLayerID != layer || mask.backSortingLayerID != layer) { mask.frontSortingLayerID = layer; mask.backSortingLayerID = layer; changed = true; }
        if (mask.frontSortingOrder != jellyOrder || mask.backSortingOrder != jellyOrder) { mask.frontSortingOrder = jellyOrder; mask.backSortingOrder = jellyOrder; changed = true; }
        if (Mathf.Abs(mask.alphaCutoff - 0.2f) > 1e-4f) { mask.alphaCutoff = 0.2f; changed = true; }
        return changed;
    }

    /// <summary>Everything JellySchool relies on about the designer's asset.</summary>
    public static void ValidateJelly(GameObject jelly)
    {
        var sr = jelly.GetComponent<SpriteRenderer>();
        if (sr == null) throw new Exception("[JellySchoolInstaller] JellyFish.prefab has no SpriteRenderer");
        if (sr.sortingLayerName != "Background")
            throw new Exception($"[JellySchoolInstaller] JellyFish sorts on {sr.sortingLayerName}/{sr.sortingOrder}, expected the Background layer (it must stay behind the floor's board and the actors)");
        var sprite = sr.sprite;
        if (sprite == null) throw new Exception("[JellySchoolInstaller] JellyFish.prefab has no sprite");
        if (sprite.texture == null || sprite.texture.width < 64)
            throw new Exception("[JellySchoolInstaller] JellyFish texture is not a real image — `git lfs pull` the sheets");
        if (Mathf.Abs(sprite.pixelsPerUnit - 64f) > 0.01f) throw new Exception($"[JellySchoolInstaller] JellyFish PPU {sprite.pixelsPerUnit}, expected 64");
        var pivot = new Vector2(sprite.pivot.x / sprite.rect.width, sprite.pivot.y / sprite.rect.height);
        if (Mathf.Abs(pivot.x - 0.5f) > 0.001f || Mathf.Abs(pivot.y - 0.5f) > 0.001f)
            throw new Exception($"[JellySchoolInstaller] JellyFish pivot {pivot}, expected (0.5, 0.5) — spawn/exit heights are centre heights");

        var animator = jelly.GetComponent<Animator>();
        if (animator == null) throw new Exception("[JellySchoolInstaller] JellyFish.prefab has no Animator");
        if (animator.cullingMode != AnimatorCullingMode.AlwaysAnimate)
            throw new Exception("[JellySchoolInstaller] JellyFish animator must AlwaysAnimate (it starts transparent, then off-screen)");
        if (animator.updateMode != AnimatorUpdateMode.Normal)
            throw new Exception("[JellySchoolInstaller] JellyFish animator must use Normal update mode (scaled time, like the sea)");
        var controller = animator.runtimeAnimatorController as AnimatorController;
        if (controller == null) throw new Exception("[JellySchoolInstaller] JellyFish animator has no AnimatorController");
        if (controller.layers.Length == 0) throw new Exception("[JellySchoolInstaller] JellyFish controller has no layers");

        var found = new Dictionary<string, AnimationClip>();
        foreach (var child in controller.layers[0].stateMachine.states)
        {
            var state = child.state;
            var clip = state.motion as AnimationClip;
            if (clip == null) throw new Exception($"[JellySchoolInstaller] state {state.name} has no clip");
            found[state.name] = clip;
        }
        if (!found.TryGetValue("Swim", out var swim)) throw new Exception("[JellySchoolInstaller] JellyFish controller is missing state Swim");
        if (!AnimationUtility.GetAnimationClipSettings(swim).loopTime) throw new Exception("[JellySchoolInstaller] clip Swim must loop");
        if (swim.length <= 0f) throw new Exception("[JellySchoolInstaller] clip Swim has no length");
        var def = controller.layers[0].stateMachine.defaultState;
        if (def == null || def.name != "Swim") throw new Exception($"[JellySchoolInstaller] default state is {(def != null ? def.name : "none")}, expected Swim");
    }

    private static void Report(string msg)
    {
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }
}
