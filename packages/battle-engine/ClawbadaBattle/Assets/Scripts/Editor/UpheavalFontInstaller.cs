using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// One in-game face (Nzib 2026-11-09): points the HUD skin's fonts at Upheaval and swaps Silkscreen for Upheaval on the
/// Text components of the battle prefabs that carried it (Master Lob's bubble, the timer card, the avatar). Only the
/// font reference changes; sizes are set by the scripts that fill these texts. Idempotent.
/// Menu: Clawbada ▸ UI ▸ Use Upheaval In Game. Headless:
///   Unity -batchmode -nographics -quit -executeMethod UpheavalFontInstaller.Install
/// </summary>
public static class UpheavalFontInstaller
{
    const string Upheaval = "Assets/Fonts/Upheaval.ttf";
    const string Silkscreen = "Assets/Resources/UI/Fonts/Silkscreen-Regular.ttf";
    const string SkinPath = "Assets/Resources/UI/HudSkin.asset";
    static readonly string[] Prefabs = {
        "Assets/Prefabs/UI/SpeechBubble/AnimatedSpeechBubble.prefab",
        "Assets/Prefabs/UI/TimerCard/TimerCardUI.prefab",
        "Assets/Prefabs/UI/Avatar/AvatarUI.prefab",
    };

    [MenuItem("Clawbada/UI/Use Upheaval In Game")]
    public static void Install()
    {
        var up = AssetDatabase.LoadAssetAtPath<Font>(Upheaval) ?? throw new Exception($"[UpheavalFontInstaller] {Upheaval} missing");
        var silk = AssetDatabase.LoadAssetAtPath<Font>(Silkscreen);
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>(SkinPath) ?? throw new Exception($"[UpheavalFontInstaller] {SkinPath} missing");
        int changed = 0;
        if (skin.font != up || skin.pixelFont != up) { skin.font = up; skin.pixelFont = up; EditorUtility.SetDirty(skin); changed++; }
        foreach (var path in Prefabs)
        {
            var root = PrefabUtility.LoadPrefabContents(path);
            int swaps = 0;
            try
            {
                foreach (var t in root.GetComponentsInChildren<Text>(true))
                    if (t.font == null || t.font == silk) { t.font = up; swaps++; }
                if (swaps > 0) { PrefabUtility.SaveAsPrefabAsset(root, path); changed++; }
            }
            finally { PrefabUtility.UnloadPrefabContents(root); }
            Debug.Log($"[UpheavalFontInstaller] {path}: {swaps} text(s) → Upheaval");
        }
        AssetDatabase.SaveAssets();
        Debug.Log($"[UpheavalFontInstaller] OK — {changed} asset(s) changed");
    }
}
