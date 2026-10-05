using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Puts the angler fish school into the Elite arena prefab: a "Fish" child with an AnglerSchool component
/// that references Nzib's AnglerFish.prefab. Idempotent — a second run changes nothing (the prefab is saved
/// only when something was missing) and it never overwrites a config the designer tuned. The fish asset is
/// validated first, so a half-landed drop (LFS pointers not pulled, a renamed state) fails here instead of
/// in a battle. Nothing else in the prefab (the seaweed Nzib placed, his layer orders) is touched.
/// Menu: Clawbada ▸ Arena ▸ Install Elite Angler School. Headless:
///   Unity -batchmode -nographics -quit -executeMethod AnglerSchoolInstaller.Install
/// </summary>
public static class AnglerSchoolInstaller
{
    public const string ArenaPrefabPath = "Assets/Art/Arenas/Elite/ArenaArt_Elite.prefab";
    public const string FishPrefabPath = "Assets/Art/Arenas/Elite/Decoration/Angler Fish/AnglerFish.prefab";
    public static readonly string[] States = { "Swim", "Turn" };
    public static readonly string[] OneShots = { "Turn" };

    [MenuItem("Clawbada/Arena/Install Elite Angler School")]
    public static void Install() => InstallInto();

    /// <summary>Returns true when the prefab was changed.</summary>
    public static bool InstallInto()
    {
        var fish = AssetDatabase.LoadAssetAtPath<GameObject>(FishPrefabPath);
        if (fish == null) throw new Exception($"[AnglerSchoolInstaller] {FishPrefabPath} missing — land origin/design/vfx-specials and `git lfs pull` first");
        ValidateFish(fish);

        var root = PrefabUtility.LoadPrefabContents(ArenaPrefabPath);
        bool changed = false;
        try
        {
            var t = root.transform.Find(AnglerSchool.ChildName);
            if (t == null)
            {
                t = new GameObject(AnglerSchool.ChildName).transform;
                t.SetParent(root.transform, false);
                changed = true;
            }
            if (t.localPosition != Vector3.zero || t.localRotation != Quaternion.identity || t.localScale != Vector3.one)
            {
                t.localPosition = Vector3.zero; t.localRotation = Quaternion.identity; t.localScale = Vector3.one;
                changed = true;
            }
            var school = t.GetComponent<AnglerSchool>();
            if (school == null) { school = t.gameObject.AddComponent<AnglerSchool>(); changed = true; }
            if (school.fishPrefab != fish) { school.fishPrefab = fish; changed = true; }
            if (school.config == null) { school.config = new AnglerSchoolConfig(); changed = true; }
            if (changed) PrefabUtility.SaveAsPrefabAsset(root, ArenaPrefabPath);
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(root);
        }
        if (changed) AssetDatabase.SaveAssets();
        Report($"[AnglerSchoolInstaller] OK — {(changed ? "installed" : "already installed, unchanged")}");
        return changed;
    }

    /// <summary>Everything AnglerSchool relies on about the designer's asset.</summary>
    public static void ValidateFish(GameObject fish)
    {
        var sr = fish.GetComponent<SpriteRenderer>();
        if (sr == null) throw new Exception("[AnglerSchoolInstaller] AnglerFish.prefab has no SpriteRenderer");
        if (sr.sortingLayerName != "Background")
            throw new Exception($"[AnglerSchoolInstaller] AnglerFish sorts on {sr.sortingLayerName}/{sr.sortingOrder}, expected the Background layer (it must stay behind the floor and the actors)");
        var sprite = sr.sprite;
        if (sprite == null) throw new Exception("[AnglerSchoolInstaller] AnglerFish.prefab has no sprite");
        if (sprite.texture == null || sprite.texture.width < 64)
            throw new Exception("[AnglerSchoolInstaller] AnglerFish texture is not a real image — `git lfs pull` the sheets");
        if (Mathf.Abs(sprite.pixelsPerUnit - 64f) > 0.01f) throw new Exception($"[AnglerSchoolInstaller] AnglerFish PPU {sprite.pixelsPerUnit}, expected 64");
        var pivot = new Vector2(sprite.pivot.x / sprite.rect.width, sprite.pivot.y / sprite.rect.height);
        if (Mathf.Abs(pivot.x - 0.5f) > 0.001f || Mathf.Abs(pivot.y - 0.5f) > 0.001f)
            throw new Exception($"[AnglerSchoolInstaller] AnglerFish pivot {pivot}, expected (0.5, 0.5) — lanes are body-centre heights");

        var animator = fish.GetComponent<Animator>();
        if (animator == null) throw new Exception("[AnglerSchoolInstaller] AnglerFish.prefab has no Animator");
        if (animator.cullingMode != AnimatorCullingMode.AlwaysAnimate)
            throw new Exception("[AnglerSchoolInstaller] AnglerFish animator must AlwaysAnimate (it starts off-screen)");
        if (animator.updateMode != AnimatorUpdateMode.Normal)
            throw new Exception("[AnglerSchoolInstaller] AnglerFish animator must use Normal update mode (scaled time, like the sea)");
        var controller = animator.runtimeAnimatorController as AnimatorController;
        if (controller == null) throw new Exception("[AnglerSchoolInstaller] AnglerFish animator has no AnimatorController");
        if (controller.layers.Length == 0) throw new Exception("[AnglerSchoolInstaller] AnglerFish controller has no layers");

        var found = new Dictionary<string, AnimationClip>();
        foreach (var child in controller.layers[0].stateMachine.states)
        {
            var state = child.state;
            var clip = state.motion as AnimationClip;
            if (clip == null) throw new Exception($"[AnglerSchoolInstaller] state {state.name} has no clip");
            if (clip.name != state.name) throw new Exception($"[AnglerSchoolInstaller] state {state.name} plays clip {clip.name} — AnglerSchool indexes clips by state name");
            found[state.name] = clip;
        }
        foreach (var name in States)
            if (!found.ContainsKey(name)) throw new Exception($"[AnglerSchoolInstaller] AnglerFish controller is missing state {name}");
        foreach (var name in States)
        {
            bool loops = AnimationUtility.GetAnimationClipSettings(found[name]).loopTime;
            bool oneShot = Array.IndexOf(OneShots, name) >= 0;
            if (loops == oneShot) throw new Exception($"[AnglerSchoolInstaller] clip {name} loopTime={loops}, expected {!oneShot}");
            if (found[name].length <= 0f) throw new Exception($"[AnglerSchoolInstaller] clip {name} has no length");
        }
        var def = controller.layers[0].stateMachine.defaultState;
        if (def == null || def.name != "Swim") throw new Exception($"[AnglerSchoolInstaller] default state is {(def != null ? def.name : "none")}, expected Swim");
    }

    private static void Report(string msg)
    {
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }
}
