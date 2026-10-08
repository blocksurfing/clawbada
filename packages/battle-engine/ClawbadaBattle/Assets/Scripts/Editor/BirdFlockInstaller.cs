using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

/// <summary>
/// Puts the seagull flock into the Evolved arena prefab: a "Birds" child with a BirdFlock component that
/// references Nzib's Bird.prefab and carries the default perch table. Idempotent — a second run changes
/// nothing (the prefab is saved only when something was missing), and it never overwrites perches the
/// designer tuned (use the "reset perches" variant for that). The bird asset is validated first, so a
/// half-landed drop (LFS pointers not pulled, a renamed state) fails here instead of in a battle.
/// Menu: Clawbada ▸ Arena ▸ Install Evolved Bird Flock. Headless:
///   Unity -batchmode -nographics -quit -executeMethod BirdFlockInstaller.Install
/// </summary>
public static class BirdFlockInstaller
{
    public const string ArenaPrefabPath = "Assets/Art/Arenas/Evolved/ArenaArt_Evolved.prefab";
    public const string BirdPrefabPath = "Assets/Art/Arenas/Evolved/Decoration/Bird/Bird.prefab";
    public static readonly string[] States = { "Idle_1", "Idle_2", "Idle_3", "Jump", "Fly", "Landing", "Walk" };
    public static readonly string[] OneShots = { "Jump", "Landing" };

    [MenuItem("Clawbada/Arena/Install Evolved Bird Flock")]
    public static void Install() => Install(false);

    [MenuItem("Clawbada/Arena/Install Evolved Bird Flock (reset perches)")]
    public static void InstallResetPerches() => Install(true);

    /// <summary>Returns true when the prefab was changed.</summary>
    public static bool Install(bool resetPerches)
    {
        var bird = AssetDatabase.LoadAssetAtPath<GameObject>(BirdPrefabPath);
        if (bird == null) throw new Exception($"[BirdFlockInstaller] {BirdPrefabPath} missing — land origin/design/vfx-specials and `git lfs pull` first");
        ValidateBird(bird);

        var root = PrefabUtility.LoadPrefabContents(ArenaPrefabPath);
        bool changed = false;
        try
        {
            var t = root.transform.Find(BirdFlock.ChildName);
            if (t == null)
            {
                t = new GameObject(BirdFlock.ChildName).transform;
                t.SetParent(root.transform, false);
                changed = true;
            }
            if (t.localPosition != Vector3.zero || t.localRotation != Quaternion.identity || t.localScale != Vector3.one)
            {
                t.localPosition = Vector3.zero; t.localRotation = Quaternion.identity; t.localScale = Vector3.one;
                changed = true;
            }
            var flock = t.GetComponent<BirdFlock>();
            if (flock == null) { flock = t.gameObject.AddComponent<BirdFlock>(); changed = true; }
            if (flock.birdPrefab != bird) { flock.birdPrefab = bird; changed = true; }
            if (resetPerches || flock.perches == null || flock.perches.Count == 0)
            {
                flock.perches = BirdFlock.DefaultPerches();
                changed = true;
            }
            // The panic depth is the engine's, not the designer's: the storm effect is wrapped at DepthSort.ScreenFxOrder at
            // runtime, so the flight out must sort above that wrap (2026-10-08: a prefab still carrying the older "above
            // the clouds' child order" value, Foreground/20, sent the gulls off behind the storm).
            if (flock.panicSortingLayer != DepthSort.Layer || flock.panicSortingOrder != DepthSort.AboveScreenFxOrder)
            {
                flock.panicSortingLayer = DepthSort.Layer;
                flock.panicSortingOrder = DepthSort.AboveScreenFxOrder;
                changed = true;
            }
            if (changed) PrefabUtility.SaveAsPrefabAsset(root, ArenaPrefabPath);
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(root);
        }
        if (changed) AssetDatabase.SaveAssets();
        Report($"[BirdFlockInstaller] OK — {(changed ? "installed" : "already installed, unchanged")}");
        return changed;
    }

    /// <summary>Everything BirdFlock relies on about the designer's asset.</summary>
    public static void ValidateBird(GameObject bird)
    {
        var sr = bird.GetComponent<SpriteRenderer>();
        if (sr == null) throw new Exception("[BirdFlockInstaller] Bird.prefab has no SpriteRenderer");
        if (sr.sortingLayerName != "Default" || sr.sortingOrder != 4)
            throw new Exception($"[BirdFlockInstaller] Bird sorts on {sr.sortingLayerName}/{sr.sortingOrder}, expected Default/4 (over the rocks, under the frame art)");
        var sprite = sr.sprite;
        if (sprite == null) throw new Exception("[BirdFlockInstaller] Bird.prefab has no sprite");
        if (sprite.texture == null || sprite.texture.width < 32)
            throw new Exception("[BirdFlockInstaller] Bird texture is not a real image — `git lfs pull` the sheets");
        if (Mathf.Abs(sprite.pixelsPerUnit - 64f) > 0.01f) throw new Exception($"[BirdFlockInstaller] Bird PPU {sprite.pixelsPerUnit}, expected 64");
        var pivot = new Vector2(sprite.pivot.x / sprite.rect.width, sprite.pivot.y / sprite.rect.height);
        if (Mathf.Abs(pivot.x - 0.5f) > 0.001f || Mathf.Abs(pivot.y - 0.21875f) > 0.001f)
            throw new Exception($"[BirdFlockInstaller] Bird pivot {pivot}, expected (0.5, 0.21875) — the feet; perches are feet positions");

        var animator = bird.GetComponent<Animator>();
        if (animator == null) throw new Exception("[BirdFlockInstaller] Bird.prefab has no Animator");
        if (animator.cullingMode != AnimatorCullingMode.AlwaysAnimate)
            throw new Exception("[BirdFlockInstaller] Bird animator must AlwaysAnimate (it starts off-screen)");
        if (animator.updateMode != AnimatorUpdateMode.Normal)
            throw new Exception("[BirdFlockInstaller] Bird animator must use Normal update mode (scaled time, like the sea)");
        var controller = animator.runtimeAnimatorController as AnimatorController;
        if (controller == null) throw new Exception("[BirdFlockInstaller] Bird animator has no AnimatorController");
        if (controller.layers.Length == 0) throw new Exception("[BirdFlockInstaller] Bird controller has no layers");

        var found = new Dictionary<string, AnimationClip>();
        foreach (var child in controller.layers[0].stateMachine.states)
        {
            var state = child.state;
            var clip = state.motion as AnimationClip;
            if (clip == null) throw new Exception($"[BirdFlockInstaller] state {state.name} has no clip");
            if (clip.name != state.name) throw new Exception($"[BirdFlockInstaller] state {state.name} plays clip {clip.name} — BirdFlock indexes clips by state name");
            found[state.name] = clip;
        }
        foreach (var name in States)
            if (!found.ContainsKey(name)) throw new Exception($"[BirdFlockInstaller] Bird controller is missing state {name}");
        foreach (var name in States)
        {
            bool loops = AnimationUtility.GetAnimationClipSettings(found[name]).loopTime;
            bool oneShot = Array.IndexOf(OneShots, name) >= 0;
            if (loops == oneShot) throw new Exception($"[BirdFlockInstaller] clip {name} loopTime={loops}, expected {!oneShot}");
            if (found[name].length <= 0f) throw new Exception($"[BirdFlockInstaller] clip {name} has no length");
        }
    }

    private static void Report(string msg)
    {
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }
}
