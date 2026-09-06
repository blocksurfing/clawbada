using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Builds the in-canvas HUD against a sample 6-lobster battle in the real BattleScene
/// and asserts every element exists and is fed. Menu: Clawbada ▸ Verify HUD. Headless
/// (no -nographics — the dynamic font atlas needs a device):
///   Unity -batchmode -quit -executeMethod HudSmokeTest.Run
/// Throws on any failure so batch exits non-zero. Never saves the scene.
/// </summary>
public static class HudSmokeTest
{
    private const string ScenePath = "Assets/Scenes/BattleScene.unity";

    [MenuItem("Clawbada/Verify HUD")]
    public static void Run()
    {
        var skin = AssetDatabase.LoadAssetAtPath<HudSkin>("Assets/Resources/UI/HudSkin.asset");
        if (skin == null) throw new System.Exception("HudSkin missing — run Clawbada/Generate HUD Placeholder Art first.");
        Check(skin.hexFrame56 != null && skin.hexMask56 != null && skin.barBg != null && skin.pip != null, "skin sprites seeded");
        Check(skin.FontOrDefault() != null, "font available");

        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        var bridge = Object.FindFirstObjectByType<BattleBridge>();
        var manager = Object.FindFirstObjectByType<BattleManager>();
        var hexGrid = Object.FindFirstObjectByType<HexGrid>();
        Check(bridge != null && manager != null && hexGrid != null, "scene has BattleBridge/BattleManager/HexGrid");

        try
        {
            var init = SampleInit();
            hexGrid.BuildGrid(init.arena, init.battleId);
            var hud = BattleHud.Attach(manager);
            Check(hud != null, "BattleHud attached");
            manager.Initialize(init);

            Check(hud.Overlays.Count == 6, $"6 unit overlays (got {hud.Overlays.Count})");
            manager.StartTurn(new TurnStartData { turn = 3, lobsterId = "A1", side = "A", deadlineMs = 0, isPlayer = true });
            manager.UpdateBar(new BarData
            {
                turn = 3,
                entries = new[]
                {
                    E("A1"), E("B0"), E("A2"), E("B1"), E("A0"), E("B2"), E("A1"), E("B0"), E("A2"),
                },
            });
            manager.SetClock(15000);
            manager.SyncUnits(new UnitsSyncData
            {
                turn = 3,
                units = new[]
                {
                    U("A0", 840, 840, 1, false), U("A1", 300, 450, 3, false, "bleed"), U("A2", 780, 780, 0, true),
                    U("B0", 600, 840, 2, false), U("B1", 0, 450, 0, false), U("B2", 780, 780, 1, false, "stun"),
                },
            });
            hud.SpawnFloatFor(manager.GetLobster("B0"), "-123!", skin.floatCrit, 20);
            hud.ShowBanner("A", true, "wipeout", "A");
            Canvas.ForceUpdateCanvases();
            hud.Refresh();

            Check(hud.Strip.CurrentIds.Count == 8, $"strip shows 8 entries (got {hud.Strip.CurrentIds.Count})");
            Check(hud.Strip.CurrentIds[0] == "A1", "strip starts with the active lobster");
            Check(hud.Strip.CurrentIds[1] == "B0", "strip dedupes the actor instead of repeating it");
            Check(!hud.Strip.CurrentIds.Contains("B1"), "dead lobster skipped in the strip");
            Check(hud.Panel.gameObject.activeSelf && hud.Panel.Lobster != null && hud.Panel.Lobster.lobsterId == "A1", "active panel shows A1");
            var nameText = hud.Panel.transform.Find("Name").GetComponent<Text>();
            Check(nameText.text == "Mantis", $"active panel name is Mantis (got '{nameText.text}')");
            Check(hud.Panel.Clock.Running && hud.Panel.Clock.RemainingSeconds > 8f, "clock running from 15 s");
            Check(hud.Banner.Visible, "banner visible");
            var a1 = manager.GetLobster("A1");
            Check(a1.currentHp == 300 && a1.charge == 3 && a1.statuses.Count == 1 && a1.statuses[0].type == "bleed", "SyncUnits applied hp/charge/statuses");
            Check(manager.GetLobster("B1").alive == false, "SyncUnits marks B1 dead");
            Check(hud.Overlays["A2"].Lobster.defending, "defending flag synced");

            int nullSprites = 0, nullFonts = 0, images = 0, texts = 0;
            foreach (var img in hud.Canvas.GetComponentsInChildren<Image>(true))
            {
                images++;
                if (img.enabled && img.sprite == null && img.name != "Dim") nullSprites++;
            }
            foreach (var t in hud.Canvas.GetComponentsInChildren<Text>(true))
            {
                texts++;
                if (t.font == null) nullFonts++;
            }
            Check(nullFonts == 0, $"no Text without a font ({nullFonts})");
            Check(nullSprites == 0, $"no enabled Image without a sprite ({nullSprites})");
            Check(Object.FindFirstObjectByType<UnityEngine.EventSystems.EventSystem>() != null, "EventSystem present");
            Check(hud.Marker != null && hud.Marker.gameObject.activeSelf, "marker follows the active lobster");

            string msg = $"[HudSmokeTest] OK — {images} images, {texts} texts, strip [{hud.Strip.DescribeIds()}], clock {hud.Panel.Clock.RemainingSeconds:F1}s";
            Debug.Log(msg);
            if (Application.isBatchMode) System.Console.WriteLine(msg);
        }
        finally
        {
            // Drop every runtime object without saving the scene.
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        }
    }

    private static void Check(bool ok, string what)
    {
        if (!ok) throw new System.Exception("[HudSmokeTest] FAILED: " + what);
        Debug.Log("[HudSmokeTest] ok: " + what);
    }

    private static BarEntryData E(string id) => new BarEntryData { lobsterId = id, tick = "0" };

    private static UnitSyncData U(string id, int hp, int max, int charge, bool defending, params string[] statuses)
    {
        var list = new List<StatusData>();
        foreach (var s in statuses) list.Add(new StatusData { type = s, turns = 2 });
        var lob = Find(id);
        return new UnitSyncData
        {
            lobsterId = id, hp = hp, maxHp = max, alive = hp > 0, charge = charge, defending = defending,
            col = lob.position.col, row = lob.position.row, statuses = list.ToArray(),
        };
    }

    private static readonly List<BattleLobsterData> sample = new();

    private static BattleLobsterData Find(string id) => sample.Find(l => l.id == id);

    private static BattleInitData SampleInit()
    {
        sample.Clear();
        int[] classes = { 0, 1, 5, 0, 1, 5 };
        int[] tiers = { 2, 2, 2, 3, 3, 3 };
        for (int k = 0; k < 6; k++)
        {
            bool isA = k < 3;
            int slot = k % 3;
            var data = new BattleLobsterData
            {
                id = (isA ? "A" : "B") + slot,
                classId = classes[k],
                className = LobsterClasses.Name(classes[k]),
                tier = tiers[k],
                side = isA ? "A" : "B",
                slot = slot,
                maxHp = classes[k] == 1 ? 450 : classes[k] == 5 ? 780 : 840,
                currentHp = classes[k] == 1 ? 450 : classes[k] == 5 ? 780 : 840,
                position = new HexPosition { col = isA ? 0 : 5, row = 1 + slot },
                charge = 0,
                damage = 0,
                moveRange = 2,
                alive = true,
            };
            if (k == 1) data.partClassIds = new[] { 3, 1, 1, 9, 4, 1 }; // composited portrait path
            sample.Add(data);
        }
        return new BattleInitData
        {
            battleId = "hud-smoke",
            arena = new ArenaLayout
            {
                layoutId = "smoke", cols = 6, rows = 5, tier = "elite",
                blockedHexes = new[] { new HexPosition { col = 2, row = 2 }, new HexPosition { col = 3, row = 1 } },
                teamASpawns = new[] { P(0, 1), P(0, 2), P(0, 3) },
                teamBSpawns = new[] { P(5, 1), P(5, 2), P(5, 3) },
            },
            teamA = new[] { sample[0], sample[1], sample[2] },
            teamB = new[] { sample[3], sample[4], sample[5] },
            playerSide = "A",
            playerBadge = "player",
            opponentBadge = "bot",
            stakeBracket = "practice",
            stakeAmount = 0,
        };
    }

    private static HexPosition P(int c, int r) => new HexPosition { col = c, row = r };
}
