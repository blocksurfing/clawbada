using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Nzib's Victory / Defeat screens (drop 93e213e) with the player's team, against HudSmokeTest's 3v3 sample in the real
/// BattleScene: a win raises VictoryScreen, a loss DefeatScreen, each with the player's three lobsters cloned onto the
/// off-board stage (their classes, in slot order, on ResultScreen.StageLayer, rendered into a texture under the banner);
/// a draw and a spectator keep the plain banner; a new battle binding takes the screen down and brings the HUD back.
/// Structure only — the loops themselves are checked in the browser (they need play-mode time).
/// Headless (no -nographics — the HUD's dynamic font needs a device):
///   Unity -batchmode -quit -executeMethod ResultScreenSmokeTest.Run
/// Throws on any failure so batch exits non-zero. Never saves the scene.
/// </summary>
public static class ResultScreenSmokeTest
{
    private const string ScenePath = "Assets/Scenes/BattleScene.unity";

    [MenuItem("Clawbada/Verify Result Screens")]
    public static void Run()
    {
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>("Assets/Resources/UI/HudSkin.asset");
        Check(skin != null, "HudSkin present");
        Check(skin.victoryScreenPrefab != null && skin.defeatScreenPrefab != null, "victory + defeat prefabs bound on the skin (ResultScreenBinder)");

        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        var manager = Object.FindFirstObjectByType<BattleManager>();
        var hexGrid = Object.FindFirstObjectByType<HexGrid>();
        Check(manager != null && hexGrid != null, "scene has BattleManager/HexGrid");
        try
        {
            var init = HudSmokeTest.SampleInit();
            hexGrid.BuildGrid(init.arena, init.battleId);
            var hud = BattleHud.Attach(manager);
            Check(hud != null, "BattleHud attached");
            manager.Initialize(init);
            string[] want = init.teamA.Select(d => d.className).ToArray();

            // A win.
            hud.ShowBanner("A", true, "wipeout", "A");
            var win = hud.Result;
            Check(win != null && win.Won && win.name == "VictoryScreen", "a win raises the Victory screen");
            CheckScreen(win, hud, want);
            Check(!hud.Banner.Visible, "the plain banner stays down under the Victory screen");

            // A new battle binding takes it down and brings the HUD back.
            manager.Initialize(HudSmokeTest.SampleInit());
            Check(hud.Result == null && Object.FindObjectsByType<ResultScreen>(FindObjectsSortMode.None).Length == 0, "re-init dismisses the result screen");
            Check(hud.Canvas.enabled, "HUD canvas back after the dismiss");
            Check(GameObject.Find("ResultStage") == null, "the off-board stage is cleaned up");

            // A loss.
            hud.ShowBanner("B", false, "wipeout", "A");
            var loss = hud.Result;
            Check(loss != null && !loss.Won && loss.name == "DefeatScreen", "a loss raises the Defeat screen");
            CheckScreen(loss, hud, want);
            hud.DismissResult();

            // Draw and spectator: the plain banner.
            hud.ShowBanner("draw", false, "turn_cap", "A");
            Check(hud.Result == null && hud.Banner.Visible, "a draw keeps the plain banner");
            hud.Banner.Hide();
            hud.ShowBanner("A", false, "wipeout", "spectator");
            Check(hud.Result == null && hud.Banner.Visible, "a spectator keeps the plain banner");

            string msg = $"[ResultScreenSmokeTest] OK — victory + defeat with [{string.Join(",", want)}], skull sprite {(skin.floatingSkull != null ? "bound" : "not drawn yet")}";
            Debug.Log(msg);
            if (Application.isBatchMode) System.Console.WriteLine(msg);
        }
        finally
        {
            foreach (var r in Object.FindObjectsByType<ResultScreen>(FindObjectsSortMode.None)) r.Dismiss();
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        }
    }

    private static void CheckScreen(ResultScreen screen, BattleHud hud, string[] want)
    {
        var canvas = screen.GetComponent<Canvas>();
        Check(canvas != null && canvas.renderMode == RenderMode.ScreenSpaceOverlay && canvas.sortingOrder > hud.Canvas.sortingOrder, "its canvas draws over the HUD's");
        Check(!hud.Canvas.enabled, "HUD canvas hidden while the result is up");
        Check(screen.GetComponent<Animator>() != null && screen.GetComponent<Animator>().runtimeAnimatorController != null, "Nzib's PopIn animator kept");
        Check(screen.Rigs.Count == 3 && screen.Rigs.All(a => a != null && a.enabled), $"three live rigs on the stage (got {screen.Rigs.Count})");
        string got = string.Join(",", screen.Rigs.Select(a => ClassOf(a.gameObject.name, want)));
        Check(got == string.Join(",", want), $"the player's team in slot order (want {string.Join(",", want)}, got {got})");
        foreach (var a in screen.Rigs)
        {
            var root = a.transform;
            while (root.parent != null && !root.parent.name.StartsWith("Pivot_")) root = root.parent;
            Check(root.GetComponentsInChildren<Transform>(true).All(t => t.gameObject.layer == ResultScreen.StageLayer), $"{a.name} entirely on the stage layer");
            Check(root.GetComponentsInChildren<MonoBehaviour>(true).Length == 0, $"{a.name} stripped of scripts (nothing plays sound)");
            Check(root.GetComponentsInChildren<SpriteRenderer>().Any(sr => sr.enabled && LobsterController.IsBodyPart(sr.gameObject.name)), $"{a.name} shows its body parts");
        }
        var main = Camera.main;
        Check(main == null || (main.cullingMask & (1 << ResultScreen.StageLayer)) == 0 || OffScreen(main, screen), "the main camera never shows the stage");
        Check(screen.StageCamera != null && screen.StageCamera.targetTexture == screen.Texture && screen.StageCamera.cullingMask == 1 << ResultScreen.StageLayer, "stage camera renders only the stage, into the texture");
        Check(screen.Texture != null && screen.Texture.filterMode == FilterMode.Point, "point-filtered team texture");
        var strip = screen.transform.Find("TeamStrip")?.GetComponent<RawImage>();
        Check(strip != null && strip.texture == screen.Texture, "team strip shows the texture");
        var banner = screen.transform.Find(screen.Won ? "VictoryBanner" : "DefeatBanner") as RectTransform;
        float bannerBottom = banner != null ? banner.anchoredPosition.y - banner.sizeDelta.y * 0.5f : 0f;
        Check(banner != null && ResultScreen.FeetY + ResultScreen.BodyPx <= bannerBottom && ResultScreen.FeetY > -180f,
            $"the team stands under the banner, on screen (feet y {ResultScreen.FeetY}, banner bottom {bannerBottom})");
    }

    /// <summary>Rig names are "Result_&lt;id&gt;"; the id maps to the sample's class through its slot.</summary>
    private static string ClassOf(string rigName, string[] want)
    {
        string id = rigName.Replace("Result_", "");
        return int.TryParse(id.Substring(1), out int slot) && slot < want.Length ? want[slot] : rigName;
    }

    private static bool OffScreen(Camera main, ResultScreen screen)
    {
        var p = main.WorldToViewportPoint(screen.StageCamera.transform.position);
        return p.x < -1f || p.x > 2f || p.y < -1f || p.y > 2f;
    }

    private static void Check(bool ok, string what)
    {
        if (!ok) throw new System.Exception("[ResultScreenSmokeTest] FAILED: " + what);
        Debug.Log("[ResultScreenSmokeTest] ok: " + what);
    }
}
