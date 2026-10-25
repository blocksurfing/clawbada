using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// Nzib's death ghost (drop e79e946) with the body it rises from (Nzib / owner 2026-10-25): a lobster that dies spawns the
/// PersistentDeathGhost over its body; the corpse is darkened but SOLID (alpha 1, CorpseTint) and stays on the board through
/// later turns (no fade-away), shadow included; a new battle clears the ghosts. In edit mode PlayDeath runs to its first
/// yield — far enough to spawn the ghost — and FreezeAsCorpse is called directly for the tint.
/// Headless: Unity -batchmode -quit -executeMethod DeathGhostSmokeTest.Run   (never saves the scene)
/// </summary>
public static class DeathGhostSmokeTest
{
    private const string ScenePath = "Assets/Scenes/BattleScene.unity";

    [MenuItem("Clawbada/Verify Death Ghost")]
    public static void Run()
    {
        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        var manager = Object.FindFirstObjectByType<BattleManager>();
        var hexGrid = Object.FindFirstObjectByType<HexGrid>();
        Check(manager != null && hexGrid != null, "scene has BattleManager/HexGrid");
        Check(manager.vfxLibrary != null && manager.vfxLibrary.death != null && manager.vfxLibrary.death.prefab != null
            && manager.vfxLibrary.death.prefab.GetComponent<PersistentDeathGhost>() != null, "the death slot is Nzib's GhostDeath prefab");
        try
        {
            var init = HudSmokeTest.SampleInit();
            hexGrid.BuildGrid(init.arena, init.battleId);
            manager.Initialize(init);
            var b0 = manager.GetLobster("B0");
            Check(b0 != null && b0.alive, "B0 alive");

            manager.StartCoroutine(b0.PlayDeath(0.9f));
            var ghosts = Object.FindObjectsByType<PersistentDeathGhost>(FindObjectsSortMode.None);
            Check(ghosts.Length == 1, $"one ghost spawned on the death (got {ghosts.Length})");
            float dx = Mathf.Abs(ghosts[0].transform.position.x - b0.transform.position.x);
            Check(dx < 0.5f, $"the ghost rises from B0's body (dx {dx:F2})");
            Check(ghosts[0].GetComponentInChildren<Animator>() != null, "the ghost carries its spawn → idle Animator");

            b0.FreezeAsCorpse();
            var parts = b0.GetComponentsInChildren<SpriteRenderer>().Where(sr => sr.enabled && LobsterController.IsBodyPart(sr.gameObject.name)).ToArray();
            Check(parts.Length > 0, "the corpse still shows its body parts");
            Check(parts.All(sr => Mathf.Approximately(sr.color.a, 1f)), "the corpse is solid, not see-through (alpha 1)");
            Check(parts.All(sr => sr.color == LobsterController.CorpseTint), "the corpse wears the darker CorpseTint");

            // Later turns: the body stays (no fade-away) and so does the ghost.
            Check(!manager.fadeCorpses, "corpse fade-away is off");
            for (int t = 2; t <= 6; t++)
                manager.PlayTurn(new TurnPlayData { turn = t, lobsterId = "A0", path = new HexPosition[0], action = "none", skipped = "", targetId = "" });
            Check(!b0.CorpseGone, "the body is still on the board five turns later");
            Check(Object.FindObjectsByType<PersistentDeathGhost>(FindObjectsSortMode.None).Length == 1, "the ghost is still there too");

            manager.Initialize(HudSmokeTest.SampleInit());
            Check(Object.FindObjectsByType<PersistentDeathGhost>(FindObjectsSortMode.None).Length == 0, "a new battle clears the ghosts");

            string msg = "[DeathGhostSmokeTest] OK — ghost over a solid darkened body that stays; cleared on re-init";
            Debug.Log(msg);
            if (Application.isBatchMode) System.Console.WriteLine(msg);
        }
        finally
        {
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        }
    }

    private static void Check(bool ok, string what)
    {
        if (!ok) throw new System.Exception("[DeathGhostSmokeTest] FAILED: " + what);
        Debug.Log("[DeathGhostSmokeTest] ok: " + what);
    }
}
