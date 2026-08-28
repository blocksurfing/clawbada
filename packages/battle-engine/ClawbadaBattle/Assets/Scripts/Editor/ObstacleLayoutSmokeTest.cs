using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Exercises ObstacleLayoutGenerator across many seeds and every authored layout's
/// board/spawn shape. Menu: Clawbada ▸ Verify Obstacle Generator. Headless:
///   Unity -batchmode -quit -executeMethod ObstacleLayoutSmokeTest.Run
/// Fails (throws) on any violated guard so CI/batch exits non-zero.
/// </summary>
public static class ObstacleLayoutSmokeTest
{
    [MenuItem("Clawbada/Verify Obstacle Generator")]
    public static void Run()
    {
        var layouts = new List<ArenaLayout>();
        foreach (string guid in AssetDatabase.FindAssets("t:TextAsset", new[] { "Assets/ArenaLayouts" }))
        {
            var json = AssetDatabase.LoadAssetAtPath<TextAsset>(AssetDatabase.GUIDToAssetPath(guid));
            if (json != null) layouts.Add(JsonUtility.FromJson<ArenaLayout>(json.text));
        }
        if (layouts.Count == 0) throw new System.Exception("No layouts found under Assets/ArenaLayouts.");

        const int seedsPerLayout = 200;
        int boards = 0, cells = 0, distinct = 0;
        foreach (var authored in layouts)
        {
            var seen = new HashSet<string>();
            for (int i = 0; i < seedsPerLayout; i++)
            {
                var layout = new ArenaLayout
                {
                    layoutId = authored.layoutId, cols = authored.cols, rows = authored.rows, tier = authored.tier,
                    teamASpawns = authored.teamASpawns, teamBSpawns = authored.teamBSpawns,
                };
                string seed = $"{layout.layoutId}|battle-{i}|{layout.tier}";
                var a = ObstacleLayoutGenerator.Generate(layout, seed, 4, 5);
                var b = ObstacleLayoutGenerator.Generate(layout, seed, 4, 5);
                string ka = Key(a), kb = Key(b);
                if (ka != kb) throw new System.Exception($"Non-deterministic for seed {seed}: {ka} vs {kb}");
                if (a.Length < 4 || a.Length > 5) throw new System.Exception($"Count {a.Length} out of range for seed {seed}");

                var blocked = new HashSet<(int, int)>();
                foreach (var h in a)
                {
                    if (h.col <= 0 || h.col >= layout.cols - 1) throw new System.Exception($"Spawn column blocked at ({h.col},{h.row}) seed {seed}");
                    if (!blocked.Add((h.col, h.row))) throw new System.Exception($"Duplicate cell ({h.col},{h.row}) seed {seed}");
                }
                foreach (var s in layout.teamASpawns) if (blocked.Contains((s.col, s.row))) throw new System.Exception($"Team A spawn blocked seed {seed}");
                foreach (var s in layout.teamBSpawns) if (blocked.Contains((s.col, s.row))) throw new System.Exception($"Team B spawn blocked seed {seed}");
                if (!AllReachable(layout, blocked)) throw new System.Exception($"Board disconnected for seed {seed}: {ka}");

                if (seen.Add(ka)) distinct++;
                boards++; cells += a.Length;
            }
        }
        string msg = $"[ObstacleLayoutSmokeTest] OK — {boards} boards over {layouts.Count} layouts, " +
                     $"{distinct} distinct, avg {(float)cells / boards:0.00} blocked cells, all guards hold.";
        Debug.Log(msg);
        if (Application.isBatchMode) System.Console.WriteLine(msg);
    }

    private static string Key(HexPosition[] cells)
    {
        var parts = new List<string>();
        foreach (var h in cells) parts.Add($"{h.col},{h.row}");
        return string.Join(";", parts);
    }

    private static bool AllReachable(ArenaLayout layout, HashSet<(int, int)> blocked)
    {
        int open = layout.cols * layout.rows - blocked.Count;
        var start = (layout.teamASpawns[0].col, layout.teamASpawns[0].row);
        var seen = new HashSet<(int, int)> { start };
        var q = new Queue<(int, int)>(); q.Enqueue(start);
        while (q.Count > 0)
        {
            var (c, r) = q.Dequeue();
            foreach (var n in HexCoord.GetNeighbors(c, r))
            {
                if (n.x < 0 || n.x >= layout.cols || n.y < 0 || n.y >= layout.rows) continue;
                if (blocked.Contains((n.x, n.y)) || !seen.Add((n.x, n.y))) continue;
                q.Enqueue((n.x, n.y));
            }
        }
        return seen.Count == open;
    }
}
