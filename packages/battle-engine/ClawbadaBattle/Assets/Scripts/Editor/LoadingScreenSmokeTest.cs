using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// The loading screen (LoadingScreenController + Assets/Scenes/LoadingScreen.unity) in edit mode: the training
/// scene has what the controller binds to, its layers are what the battle expects, the controller takes a tip and
/// releases. Menu: Clawbada ▸ Verify Loading Screen. Headless (no -nographics — legacy Text wants a device):
///   Unity -batchmode -quit -executeMethod LoadingScreenSmokeTest.Run
/// Throws on any failure so batch exits non-zero. Never saves a scene.
/// </summary>
public static class LoadingScreenSmokeTest
{
    private const string BattleScenePath = "Assets/Scenes/BattleScene.unity";
    private const string LoadingScenePath = "Assets/Scenes/LoadingScreen.unity";

    [MenuItem("Clawbada/Verify Loading Screen")]
    public static void Run()
    {
        // Build settings: both scenes, battle first.
        var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
        Check(scenes.Length >= 2 && scenes[0] == BattleScenePath && scenes.Contains(LoadingScenePath), $"build scenes = battle first + loading ({string.Join(", ", scenes)})");
        Check(LayerMask.NameToLayer(LoadingScreenController.LayerName) >= 0, $"GameObject layer '{LoadingScreenController.LayerName}' exists");

        // The training scene on its own.
        var loading = EditorSceneManager.OpenScene(LoadingScenePath, OpenSceneMode.Single);
        try
        {
            var texts = Object.FindObjectsByType<Text>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            var tip = texts.FirstOrDefault(t => t.gameObject.name == "GameplayTip");
            var label = texts.FirstOrDefault(t => t.gameObject.name == "LoadingLabel");
            Check(tip != null && tip.font != null, "GameplayTip text with a font");
            Check(label != null && label.font != null, "LoadingLabel text with a font");
            var cams = Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            Check(cams.Length == 1, $"one camera (got {cams.Length})");
            var canvas = Object.FindObjectsByType<Canvas>(FindObjectsInactive.Include, FindObjectsSortMode.None).FirstOrDefault(c => c.gameObject.name == "LoadingUI");
            Check(canvas != null && canvas.renderMode == RenderMode.ScreenSpaceCamera && canvas.worldCamera == cams[0], "LoadingUI canvas renders through the scene camera");
            // The Dojo backdrop's two front props were pinned back to Default in this scene (PR #220) so they keep
            // drawing under the frame and the tip; the six back layers sit on Background.
            var renderers = Object.FindObjectsByType<SpriteRenderer>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            foreach (var name in new[] { "Pole_Front", "FG_WoodenDummy" })
            {
                var r = renderers.FirstOrDefault(x => x.gameObject.name == name && x.transform.parent != null && x.transform.parent.name == "ArenaArt_Dojo");
                Check(r != null && r.sortingLayerName == "Default", $"{name} on Default in the training scene");
            }
            foreach (var name in new[] { "BG_Sky", "BG_Ground", "BG_Dojo", "Plants", "Spears", "Pole_Back" })
            {
                var r = renderers.FirstOrDefault(x => x.gameObject.name == name && x.transform.parent != null && x.transform.parent.name == "ArenaArt_Dojo");
                Check(r != null && r.sortingLayerName == "Background", $"{name} on Background");
            }
            // The rigs' parts carry the battle's Foreground layer (DepthSort); only the backdrop's own layers are the
            // concern here — none of them may sit on Foreground, or they would draw over the trio in the battle.
            var backdrop = renderers.Where(x => x.transform.parent != null && x.transform.parent.name == "ArenaArt_Dojo").ToArray();
            Check(backdrop.Length == 8 && !backdrop.Any(r => r.sortingLayerName == "Foreground"), $"the Dojo backdrop's {backdrop.Length} layers: none on Foreground in the training scene");
        }
        finally
        {
            EditorSceneManager.OpenScene(BattleScenePath, OpenSceneMode.Single);
        }

        // The battle scene has the Dojo arena wired (the training scene reuses its prefab) and the controller behaves.
        var manager = Object.FindFirstObjectByType<BattleManager>();
        Check(manager != null, "BattleManager in BattleScene");
        Check(manager.arenaArtDojo != null, "arenaArtDojo set");
        var ctl = manager.gameObject.AddComponent<LoadingScreenController>();   // Awake is a no-op in edit mode
        try
        {
            Check(!ctl.IsHolding && LoadingScreenController.Holding == null, "edit mode: not holding");
            var additive = EditorSceneManager.OpenScene(LoadingScenePath, OpenSceneMode.Additive);
            try
            {
                ctl.Bind(additive);
                ctl.ShowLoading("{\"tip\":\"Smoke tip\"}");
                var tip = Object.FindObjectsByType<Text>(FindObjectsInactive.Include, FindObjectsSortMode.None).First(t => t.gameObject.name == "GameplayTip");
                Check(tip.text == "Smoke tip", $"ShowLoading sets the tip (got '{tip.text}')");
                ctl.ArenaBuilt();
                ctl.ReleaseNow();
                Check(!ctl.IsHolding && LoadingScreenController.Holding == null, "ReleaseNow clears the hold");
            }
            finally
            {
                EditorSceneManager.CloseScene(additive, true);
            }
        }
        finally
        {
            Object.DestroyImmediate(ctl);
            EditorSceneManager.OpenScene(BattleScenePath, OpenSceneMode.Single);
        }
        Log("[LoadingScreenSmokeTest] OK");
    }

    private static void Check(bool ok, string what)
    {
        if (!ok) throw new System.Exception($"[LoadingScreenSmokeTest] FAILED: {what}");
        Log($"[LoadingScreenSmokeTest] ok: {what}");
    }

    private static void Log(string msg)
    {
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }
}
