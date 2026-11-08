using System;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Puts DojoNinjaPlants on the Dojo arena prefab's Plants object (Nzib's drop 28dc6ce) and wires his plants, ninja, star
/// and clips. Idempotent: only missing references are filled; nothing of his (plant transforms, sorting, controllers)
/// is touched. Menu: Clawbada ▸ Arena ▸ Install Dojo Ninja Plants. Headless:
///   Unity -batchmode -nographics -quit -executeMethod DojoNinjaInstaller.Install
/// </summary>
public static class DojoNinjaInstaller
{
    public const string ArenaPrefabPath = "Assets/Art/Arenas/Dojo/ArenaArt_Dojo.prefab";
    const string Dir = "Assets/Art/Arenas/Dojo/";

    [MenuItem("Clawbada/Arena/Install Dojo Ninja Plants")]
    public static void Install()
    {
        T Load<T>(string path) where T : UnityEngine.Object
        {
            var a = AssetDatabase.LoadAssetAtPath<T>(path);
            if (a == null) throw new Exception($"[DojoNinjaInstaller] {path} missing — land origin/design/vfx-specials and `git lfs pull` first");
            return a;
        }
        var ninja = Load<GameObject>(Dir + "Ninja/Ninja_ART.prefab");
        var star = Load<GameObject>(Dir + "Star/Star_ART.prefab");
        var throwClip = Load<AnimationClip>(Dir + "Ninja/ThrowingStar.anim");
        var shake = Load<AnimationClip>("Assets/Animations/Dojo/Plants/Shake.anim");
        var peek = Load<AnimationClip>("Assets/Animations/Dojo/Plants/NinjaPeeking.anim");

        var root = PrefabUtility.LoadPrefabContents(ArenaPrefabPath);
        bool changed = false;
        try
        {
            var plants = root.transform.Find("Plants") ?? throw new Exception("[DojoNinjaInstaller] no Plants object in the Dojo arena");
            Animator Plant(string name) =>
                plants.Find(name)?.GetComponent<Animator>() ?? throw new Exception($"[DojoNinjaInstaller] Plants/{name} has no Animator");
            var c = plants.GetComponent<DojoNinjaPlants>();
            if (c == null) { c = plants.gameObject.AddComponent<DojoNinjaPlants>(); changed = true; }
            void Set<T>(ref T field, T value) where T : UnityEngine.Object { if (field != value) { field = value; changed = true; } }
            Set(ref c.leftPlant, Plant("Plant_Left"));
            Set(ref c.rightPlant, Plant("Plant_Right"));
            Set(ref c.ninjaPrefab, ninja);
            Set(ref c.starPrefab, star);
            Set(ref c.throwClip, throwClip);
            Set(ref c.shakeClip, shake);
            Set(ref c.peekClip, peek);
            if (changed) PrefabUtility.SaveAsPrefabAsset(root, ArenaPrefabPath);
        }
        finally { PrefabUtility.UnloadPrefabContents(root); }
        if (changed) AssetDatabase.SaveAssets();
        Debug.Log($"[DojoNinjaInstaller] OK — {(changed ? "installed" : "already installed, unchanged")}");
    }
}
