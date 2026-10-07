using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Puts the drift clouds into the Evolved arena prefab: a "Clouds" child with a CloudDrift component that
/// references Nzib's six Drift_Cloud prefabs. Idempotent — a second run changes nothing (the prefab is saved
/// only when something was missing) and it never overwrites a config the designer tuned. The cloud assets
/// are validated first, so a half-landed drop (LFS pointers not pulled, a renamed prefab) fails here instead
/// of in a battle. Nothing else in the prefab (Static_Clouds, the Birds child, his layer orders) is touched.
/// Menu: Clawbada ▸ Arena ▸ Install Evolved Drift Clouds. Headless:
///   Unity -batchmode -nographics -quit -executeMethod CloudDriftInstaller.Install
/// </summary>
public static class CloudDriftInstaller
{
    public const string ArenaPrefabPath = "Assets/Art/Arenas/Evolved/ArenaArt_Evolved.prefab";
    public const string CloudFolder = "Assets/Art/Arenas/Evolved/Decoration/Clouds";
    public static readonly string[] CloudPrefabPaths =
    {
        CloudFolder + "/Drift_Cloud_01.prefab", CloudFolder + "/Drift_Cloud_02.prefab", CloudFolder + "/Drift_Cloud_03.prefab",
        CloudFolder + "/Drift_Cloud_04.prefab", CloudFolder + "/Drift_Cloud_05.prefab", CloudFolder + "/Drift_Cloud_06.prefab",
    };

    [MenuItem("Clawbada/Arena/Install Evolved Drift Clouds")]
    public static void Install() => InstallInto();

    /// <summary>Returns true when the prefab was changed.</summary>
    public static bool InstallInto()
    {
        var clouds = LoadClouds();

        var root = PrefabUtility.LoadPrefabContents(ArenaPrefabPath);
        bool changed = false;
        try
        {
            var t = root.transform.Find(CloudDrift.ChildName);
            if (t == null)
            {
                t = new GameObject(CloudDrift.ChildName).transform;
                t.SetParent(root.transform, false);
                changed = true;
            }
            if (t.localPosition != Vector3.zero || t.localRotation != Quaternion.identity || t.localScale != Vector3.one)
            {
                t.localPosition = Vector3.zero; t.localRotation = Quaternion.identity; t.localScale = Vector3.one;
                changed = true;
            }
            var drift = t.GetComponent<CloudDrift>();
            if (drift == null) { drift = t.gameObject.AddComponent<CloudDrift>(); changed = true; }
            if (drift.cloudPrefabs == null) { drift.cloudPrefabs = new List<GameObject>(); changed = true; }
            if (drift.cloudPrefabs.Count != clouds.Length) { drift.cloudPrefabs = new List<GameObject>(clouds); changed = true; }
            else
            {
                for (int i = 0; i < clouds.Length; i++)
                    if (drift.cloudPrefabs[i] != clouds[i]) { drift.cloudPrefabs[i] = clouds[i]; changed = true; }
            }
            if (drift.config == null) { drift.config = new CloudDriftConfig(); changed = true; }
            if (changed) PrefabUtility.SaveAsPrefabAsset(root, ArenaPrefabPath);
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(root);
        }
        if (changed) AssetDatabase.SaveAssets();
        Report($"[CloudDriftInstaller] OK — {(changed ? "installed" : "already installed, unchanged")}");
        return changed;
    }

    public static GameObject[] LoadClouds()
    {
        var clouds = new GameObject[CloudPrefabPaths.Length];
        for (int i = 0; i < CloudPrefabPaths.Length; i++)
        {
            clouds[i] = AssetDatabase.LoadAssetAtPath<GameObject>(CloudPrefabPaths[i]);
            if (clouds[i] == null) throw new Exception($"[CloudDriftInstaller] {CloudPrefabPaths[i]} missing — land origin/design/vfx-specials and `git lfs pull` first");
            ValidateCloud(clouds[i], i);
        }
        return clouds;
    }

    /// <summary>Everything CloudDrift relies on about the designer's asset.</summary>
    public static void ValidateCloud(GameObject cloud, int variant)
    {
        string who = $"[CloudDriftInstaller] {cloud.name}";
        var sr = cloud.GetComponent<SpriteRenderer>();
        if (sr == null) throw new Exception($"{who} has no SpriteRenderer");
        if (sr.sortingLayerName != "Background")
            throw new Exception($"{who} sorts on {sr.sortingLayerName}/{sr.sortingOrder}, expected the Background layer (it must stay behind the actors and the HUD)");
        var sprite = sr.sprite;
        if (sprite == null) throw new Exception($"{who} has no sprite");
        if (sprite.texture == null || sprite.texture.width < 64)
            throw new Exception($"{who} texture is not a real image — `git lfs pull` the sheets");
        if (Mathf.Abs(sprite.pixelsPerUnit - 64f) > 0.01f) throw new Exception($"{who} PPU {sprite.pixelsPerUnit}, expected 64");
        var pivot = new Vector2(sprite.pivot.x / sprite.rect.width, sprite.pivot.y / sprite.rect.height);
        if (Mathf.Abs(pivot.x - 0.5f) > 0.001f || Mathf.Abs(pivot.y - 0.5f) > 0.001f)
            throw new Exception($"{who} pivot {pivot}, expected (0.5, 0.5) — lanes are centre heights");
        float half = sprite.bounds.extents.y;
        float allowed = CloudDriftPlanner.HalfHeight(variant);
        if (half > allowed + 0.001f)
            throw new Exception($"{who} is {half * 2f:F3} u tall; the planner's lane clamp for variant {variant + 1} assumes at most {allowed * 2f:F3} u — update CloudDriftPlanner.VariantHalfHeight");
        if (cloud.GetComponent<Animator>() != null) throw new Exception($"{who} has an Animator — CloudDrift expects a plain sprite");
    }

    private static void Report(string msg)
    {
        Debug.Log(msg);
        if (Application.isBatchMode) Console.WriteLine(msg);
    }
}
