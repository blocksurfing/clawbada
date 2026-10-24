using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// A walk cut off mid-way must not leave the rig walking in place (owner 2026-10-24: an enemy stuck looping its Move state on
/// the first turn, its footsteps only stopping when the player moved). In edit mode a coroutine runs up to its first yield, so
/// PlayTurn leaves the bot's lobster mid-walk (Move state on, movement loop flagged); then the two ways a walk gets cut off
/// in a live battle — a SyncUnits after React's watchdog released the HUD, and the next PlayTurn arriving early — must each
/// end it: not Moving, standing on a hex centre, back in Idle.
/// Headless: Unity -batchmode -quit -executeMethod MoveAbortSmokeTest.Run   (never saves the scene)
/// </summary>
public static class MoveAbortSmokeTest
{
    private const string ScenePath = "Assets/Scenes/BattleScene.unity";
    private static readonly int IdleHash = Animator.StringToHash("Idle");

    [MenuItem("Clawbada/Verify Move Abort")]
    public static void Run()
    {
        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        var manager = Object.FindFirstObjectByType<BattleManager>();
        var hexGrid = Object.FindFirstObjectByType<HexGrid>();
        Check(manager != null && hexGrid != null, "scene has BattleManager/HexGrid");
        try
        {
            var init = HudSmokeTest.SampleInit();   // the bot's B0 stands at (5,1)
            hexGrid.BuildGrid(init.arena, init.battleId);
            manager.Initialize(init);
            var b0 = manager.GetLobster("B0");
            Check(b0 != null && b0.col == 5 && b0.row == 1, "bot lobster B0 on (5,1)");

            // 1. Cut off by SyncUnits (the watchdog path).
            manager.PlayTurn(Walk(1, "B0", 4, 1));
            Check(b0.Moving, "B0 is mid-walk after PlayTurn");
            CheckWalking(b0, "PlayTurn");
            manager.SyncUnits(new UnitsSyncData { turn = 1, units = new[] { Unit("B0", 4, 1) } });
            CheckStopped(b0, hexGrid, "SyncUnits");
            Check(b0.col == 4 && b0.row == 1, $"B0 on the server's hex (4,1) after the sync (got {b0.col},{b0.row})");

            // 2. Cut off by the next turn arriving early (two queued turns replaying back to back after the intro).
            manager.PlayTurn(Walk(2, "B0", 3, 1));
            Check(b0.Moving, "B0 is mid-walk after the second PlayTurn");
            CheckWalking(b0, "the second PlayTurn");
            manager.PlayTurn(new TurnPlayData { turn = 3, lobsterId = "A0", path = new HexPosition[0], action = "none", skipped = "", targetId = "" });
            CheckStopped(b0, hexGrid, "the next PlayTurn");

            string msg = "[MoveAbortSmokeTest] OK — a cut-off walk stops its loop, lands on a hex and idles (SyncUnits + early PlayTurn)";
            Debug.Log(msg);
            if (Application.isBatchMode) System.Console.WriteLine(msg);
        }
        finally
        {
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        }
    }

    /// <summary>Step the Animator a few frames, as a live walk would before it is cut off (edit mode runs no player loop).</summary>
    private static void CheckWalking(LobsterController lob, string after)
    {
        var anim = lob.GetComponent<Animator>();
        if (anim == null || anim.runtimeAnimatorController == null) return;
        for (int i = 0; i < 5; i++) anim.Update(0.1f);
        Check(anim.GetCurrentAnimatorStateInfo(0).shortNameHash == Animator.StringToHash("Move"), $"after {after}: B0's rig plays Move");
    }

    private static void CheckStopped(LobsterController lob, HexGrid grid, string by)
    {
        Check(!lob.Moving, $"cut off by {by}: no longer Moving (movement loop stopped)");
        Check((lob.transform.position - grid.GetWorldPosition(lob.col, lob.row)).sqrMagnitude < 1e-6f, $"cut off by {by}: standing on its hex centre, not between hexes");
        var anim = lob.GetComponent<Animator>();
        if (anim != null && anim.runtimeAnimatorController != null)
        {
            for (int i = 0; i < 10; i++) anim.Update(0.1f);   // let the cross-fade finish
            var st = anim.GetCurrentAnimatorStateInfo(0);
            string name = st.shortNameHash == IdleHash ? "Idle" : st.shortNameHash == Animator.StringToHash("Move") ? "Move" : st.shortNameHash.ToString();
            Check(st.shortNameHash == IdleHash, $"cut off by {by}: back in Idle, not looping Move (state {name}, transition {anim.IsInTransition(0)}, enabled {anim.enabled}, speed {anim.speed})");
        }
    }

    private static TurnPlayData Walk(int turn, string id, int col, int row) => new TurnPlayData
    {
        turn = turn, lobsterId = id, path = new[] { new HexPosition { col = col, row = row } },
        action = "none", skipped = "", targetId = "",
    };

    private static UnitSyncData Unit(string id, int col, int row) => new UnitSyncData
    {
        lobsterId = id, hp = 840, maxHp = 840, alive = true, charge = 0, defending = false, col = col, row = row, statuses = new StatusData[0],
    };

    private static void Check(bool ok, string what)
    {
        if (!ok) throw new System.Exception("[MoveAbortSmokeTest] FAILED: " + what);
        Debug.Log("[MoveAbortSmokeTest] ok: " + what);
    }
}
