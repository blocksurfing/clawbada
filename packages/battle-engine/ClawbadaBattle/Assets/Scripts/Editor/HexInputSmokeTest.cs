using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// Click-mapping round trip: for every cell of a 6x5 board, the point a player sees
/// (the cell's flattened world position, z = 0 — where lobsters and the pointer ray
/// land) must map back to the same cell through HexGrid.WorldToHex. The board is
/// authored tilted 30° about X, so a naive Tilemap.WorldToCell on a z = 0 point drifts
/// by rows away from the pivot. Menu: Clawbada ▸ Verify Hex Input. Headless:
///   Unity -batchmode -quit -executeMethod HexInputSmokeTest.Run
/// </summary>
public static class HexInputSmokeTest
{
    private const string ScenePath = "Assets/Scenes/BattleScene.unity";

    [MenuItem("Clawbada/Verify Hex Input")]
    public static void Run()
    {
        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        var hexGrid = Object.FindFirstObjectByType<HexGrid>();
        if (hexGrid == null) throw new System.Exception("[HexInputSmokeTest] no HexGrid in the scene");
        int bad = 0, total = 0;
        var report = new List<string>();
        foreach (var tier in new[] { "evolved", "elite", "apex" })
        {
            var layout = new ArenaLayout
            {
                layoutId = "hex-input-smoke", cols = 6, rows = 5, tier = tier,
                blockedHexes = new HexPosition[0],
                teamASpawns = new[] { P(0, 1), P(0, 2), P(0, 3) },
                teamBSpawns = new[] { P(5, 1), P(5, 2), P(5, 3) },
            };
            hexGrid.BuildGrid(layout, "hex-input-smoke-" + tier);
            for (int r = 0; r < layout.rows; r++)
            for (int c = 0; c < layout.cols; c++)
            {
                total++;
                var world = hexGrid.GetWorldPosition(c, r); // z forced to 0: what the screen shows
                // Nudge slightly off-centre too: clicks are never pixel-perfect.
                foreach (var d in new[] { Vector3.zero, new Vector3(0.12f, 0.08f, 0f), new Vector3(-0.1f, -0.1f, 0f) })
                {
                    bool ok = hexGrid.WorldToHex(world + d, out int cc, out int rr);
                    if (!ok || cc != c || rr != r)
                    {
                        bad++;
                        report.Add($"{tier} ({c},{r})+{d} → {(ok ? $"({cc},{rr})" : "out of bounds")}");
                    }
                }
            }
        }
        string msg = $"[HexInputSmokeTest] {(bad == 0 ? "OK" : "FAILED")} — {total} cells x3 probes over 3 tiers, {bad} mismatches";
        if (bad > 0) msg += "\n  " + string.Join("\n  ", report.GetRange(0, Mathf.Min(report.Count, 20)));
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
        EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        if (bad > 0) throw new System.Exception(msg);
    }

    private static HexPosition P(int c, int r) => new HexPosition { col = c, row = r };
}
