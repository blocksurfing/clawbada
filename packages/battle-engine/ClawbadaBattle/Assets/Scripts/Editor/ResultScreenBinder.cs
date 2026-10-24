using System.Linq;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Binds Nzib's result screens into Resources/UI/HudSkin.asset (drop 93e213e, 2026-10-24):
///   Prefabs/UI/VictoryScreen/VictoryScreen.prefab → victoryScreenPrefab;
///   Prefabs/UI/DefeatScreen/DefeatScreen.prefab   → defeatScreenPrefab   (referenced from the skin, so they ship in the build);
///   Art/UI/DefeatScreen/FloatingSkull.png         → floatingSkull, IF it exists — the small skull that drifts up from the
///                                                   defeated team. Not drawn yet: drop the PNG there and re-run this.
/// Kept apart from NzibHudBinder so binding these never regenerates the HUD's generated PNGs. NzibHudBinder calls it too.
/// Menu: Clawbada ▸ HUD ▸ Bind Result Screens. Headless: -executeMethod ResultScreenBinder.Bind
/// </summary>
public static class ResultScreenBinder
{
    public const string VictoryPrefabPath = "Assets/Prefabs/UI/VictoryScreen/VictoryScreen.prefab";
    public const string DefeatPrefabPath = "Assets/Prefabs/UI/DefeatScreen/DefeatScreen.prefab";
    public const string FloatingSkullPath = "Assets/Art/UI/DefeatScreen/FloatingSkull.png";

    [MenuItem("Clawbada/HUD/Bind Result Screens")]
    public static void Bind()
    {
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>(HudArtGenerator.SkinPath);
        if (skin == null) throw new System.Exception($"[ResultScreenBinder] missing {HudArtGenerator.SkinPath} — run Clawbada/Generate HUD Placeholder Art first");
        skin.victoryScreenPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(VictoryPrefabPath);
        skin.defeatScreenPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(DefeatPrefabPath);
        if (skin.victoryScreenPrefab == null || skin.defeatScreenPrefab == null)
            throw new System.Exception($"[ResultScreenBinder] missing {VictoryPrefabPath} or {DefeatPrefabPath}");
        skin.floatingSkull = AssetDatabase.LoadAllAssetsAtPath(FloatingSkullPath).OfType<Sprite>().FirstOrDefault();
        EditorUtility.SetDirty(skin);
        AssetDatabase.SaveAssets();
        string msg = $"[ResultScreenBinder] OK — victory + defeat prefabs, floating skull {(skin.floatingSkull != null ? "✓" : "— (not drawn yet)")}";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }
}
