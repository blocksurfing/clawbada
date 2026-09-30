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
            Check(hud.Options != null && hud.Options.gameObject.activeSelf && !hud.Options.IsOpen, "options gear shown (closed) for a participant");
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

            // Nzib's layout (2026-09-28): six team panels replace the turn strip; each shows its place in the order.
            Check(hud.Teams.Panels.Count == 6, $"six team panels (got {hud.Teams.Panels.Count})");
            string order = string.Join(",", hud.Teams.CurrentOrder);
            Check(order == "A1,B0,A2,A0,B2", $"turn order: actor first, each living lobster once, dead B1 left out (got {order})");
            Check(hud.Teams.PanelFor("A1").Order == 1 && hud.Teams.PanelFor("B0").Order == 2 && hud.Teams.PanelFor("B2").Order == 5, "order numbers on the panels");
            Check(hud.Teams.PanelFor("B1").Order == 0, "the dead lobster's panel has no number");
            Check(hud.Teams.PanelFor("A1").Mark == ActivePanel.Highlight.Turn, "the acting lobster's panel pulses (turn outline)");
            Check(hud.Teams.PanelFor("A0").Rect.anchorMin == Vector2.zero && hud.Teams.PanelFor("B0").Rect.anchorMin == Vector2.one, "player's team bottom-left, opponents top-right");
            Check(hud.Panel.gameObject.activeSelf && hud.Panel.Lobster != null && hud.Panel.Lobster.lobsterId == "A1", "active panel shows A1");
            Check(hud.Panel.ShownClass == 1, $"active avatar shows the Mantis disc (got class {hud.Panel.ShownClass})");
            Check(hud.Panel.transform.Find("Name") == null, "no HP / name text on the avatar (numbers are for agents, via the API)");
            // Nzib's AvatarUI (28c11f5): A1 is at 300/450 (67 %) with 3 charge → the Wounded bar two-thirds full,
            // the charge bar full (thresholds 75/50/25, user 2026-09-28).
            var hpFill = hud.Panel.transform.Find("AvatarUI/HPFill")?.GetComponent<Image>();
            var mpFill = hud.Panel.transform.Find("AvatarUI/MPFill")?.GetComponent<Image>();
            Check(hpFill != null && hpFill.sprite != null && hpFill.sprite.name == "HP_Wounded", $"HP bar shows the Wounded state at 67 % (got {(hpFill != null && hpFill.sprite != null ? hpFill.sprite.name : "none")})");
            Check(hpFill != null && Mathf.Abs(hpFill.fillAmount - 300f / 450f) < 0.01f, $"HP bar filled to 300/450 (got {(hpFill != null ? hpFill.fillAmount : -1f):F2})");
            Check(mpFill != null && Mathf.Approximately(mpFill.fillAmount, 1f), "charge bar full at 3 charge");
            Check(hud.Panel.transform.Find("AvatarUI/ClassBackground/Portrait") != null, "portrait sits inside the class background's window");
            Check(hud.Clock.Running && hud.Clock.RemainingSeconds > 8f, "clock running from 15 s");
            Check(hud.Banner.Visible, "banner visible");
            var a1 = manager.GetLobster("A1");
            Check(a1.currentHp == 300 && a1.charge == 3 && a1.statuses.Count == 1 && a1.statuses[0].type == "bleed", "SyncUnits applied hp/charge/statuses");
            Check(manager.GetLobster("B1").alive == false, "SyncUnits marks B1 dead");
            Check(hud.Overlays["A2"].Lobster.defending, "defending flag synced");
            // Nzib's status badges (drop 36c7068): A1 bleeds → Bleeding; A2 defends → Defense; B1 is dead → none.
            var skinS = hud.Skin;
            string Badges(string id) => string.Join(",", hud.Teams.PanelFor(id).ActiveBadges.Select(b => b != null ? b.name : "null"));
            Check(hud.Teams.PanelFor("A1").ActiveBadges.Count == 1 && hud.Teams.PanelFor("A1").ActiveBadges[0] == skinS.statusBleeding, $"A1's panel shows the Bleeding badge (got {Badges("A1")})");
            Check(hud.Teams.PanelFor("A2").ActiveBadges.Contains(skinS.statusDefense), $"A2's panel shows the Defense badge (got {Badges("A2")})");
            Check(hud.Teams.PanelFor("B1").ActiveBadges.Count == 0, $"the dead B1 shows no badges (got {Badges("B1")})");
            Check(skinS.StatusBadge("fortify") == skinS.StatusBadge("reflect") && skinS.StatusBadge("stun") == skinS.statusBlockedTurn && skinS.StatusBadge("slow") == skinS.statusDebuff, "status → badge mapping");

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
            Check(hud.Options != null && !hud.Options.gameObject.activeSelf, "options gear hidden once the battle has ended");

            // Nzib 2026-09-11: the possession has to read as entering the target, so an impact
            // bound to TargetBody must land on the body, not at the rig root (= the hex centre,
            // where every rig authors ImpactFX and where a "hit" effect used to play).
            var victim = manager.GetLobster("B0");
            if (victim != null)
            {
                Vector3 feet = victim.transform.position;
                Vector3 body = victim.BodyCenter;
                var slot = new BattleVfxLibrary.VfxSlot { anchor = BattleVfxLibrary.AnchorPoint.TargetBody };
                Vector3 anchored = BattleVfxLibrary.AnchorPosition(slot, manager.GetLobster("A1"), victim, feet);
                Check(body.y > feet.y + 0.1f, $"body anchor sits above the feet (+{body.y - feet.y:F2})");
                Check(body.y - feet.y < 0.5f, "body anchor stays inside the rig's canvas (< 0.5)");
                Check(Mathf.Approximately(body.x, feet.x), "body anchor stays centred on the rig (flip-proof)");
                Check(anchored == body, "TargetBody anchor resolves to the target's body centre");
            }

            string msg = $"[HudSmokeTest] OK — {images} images, {texts} texts, order [{string.Join(",", hud.Teams.CurrentOrder)}], clock {hud.Clock.RemainingSeconds:F1}s";
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
