using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Deterministic random blocked-cell generator for arena layouts that arrive without
/// one. Same (seed, board) → same cells on every client and in every replay.
///
/// Rules (mirroring the designer's hand-authored layouts in Assets/ArenaLayouts):
///   • interior columns only — the two spawn columns stay open;
///   • never on a spawn cell;
///   • every open cell must remain reachable from the Team A spawns (BFS over
///     HexCoord neighbours), so no lobster can be walled in.
///
/// Intended to move server-side (packages/game-logic) once the sim models the hex
/// board; Unity then receives blockedHexes in InitBattle and never calls this.
/// </summary>
public static class ObstacleLayoutGenerator
{
    public static HexPosition[] Generate(ArenaLayout layout, string seed, int minCount, int maxCount)
    {
        if (layout == null || layout.cols < 3 || layout.rows < 1) return System.Array.Empty<HexPosition>();
        if (maxCount < minCount) maxCount = minCount;

        var rng = new XorShift32(Fnv1a(seed ?? string.Empty));
        int target = Mathf.Max(0, rng.Range(minCount, maxCount + 1));

        var reserved = new HashSet<(int, int)>();
        AddAll(reserved, layout.teamASpawns);
        AddAll(reserved, layout.teamBSpawns);

        var candidates = new List<(int, int)>();
        for (int r = 0; r < layout.rows; r++)
            for (int c = 1; c < layout.cols - 1; c++)
                if (!reserved.Contains((c, r))) candidates.Add((c, r));

        // Fisher–Yates with the seeded generator.
        for (int i = candidates.Count - 1; i > 0; i--)
        {
            int j = rng.Range(0, i + 1);
            (candidates[i], candidates[j]) = (candidates[j], candidates[i]);
        }

        var chosen = new HashSet<(int, int)>();
        foreach (var cell in candidates)
        {
            if (chosen.Count >= target) break;
            chosen.Add(cell);
            if (!AllOpenCellsReachable(layout, chosen)) chosen.Remove(cell);
        }

        var result = new List<HexPosition>(chosen.Count);
        foreach (var (c, r) in chosen) result.Add(new HexPosition { col = c, row = r });
        result.Sort((a, b) => a.row != b.row ? a.row.CompareTo(b.row) : a.col.CompareTo(b.col));
        return result.ToArray();
    }

    /// <summary>BFS from the first Team A spawn (or the first open cell) over open,
    /// in-bounds cells; true when every open cell was visited.</summary>
    private static bool AllOpenCellsReachable(ArenaLayout layout, HashSet<(int, int)> blocked)
    {
        int open = layout.cols * layout.rows - blocked.Count;
        if (open <= 0) return false;

        (int, int)? start = null;
        if (layout.teamASpawns != null)
            foreach (var s in layout.teamASpawns)
                if (s != null && !blocked.Contains((s.col, s.row))) { start = (s.col, s.row); break; }
        if (start == null)
            for (int r = 0; r < layout.rows && start == null; r++)
                for (int c = 0; c < layout.cols; c++)
                    if (!blocked.Contains((c, r))) { start = (c, r); break; }
        if (start == null) return false;

        var seen = new HashSet<(int, int)> { start.Value };
        var queue = new Queue<(int, int)>();
        queue.Enqueue(start.Value);
        while (queue.Count > 0)
        {
            var (c, r) = queue.Dequeue();
            foreach (var n in HexCoord.GetNeighbors(c, r))
            {
                if (n.x < 0 || n.x >= layout.cols || n.y < 0 || n.y >= layout.rows) continue;
                var key = (n.x, n.y);
                if (blocked.Contains(key) || !seen.Add(key)) continue;
                queue.Enqueue(key);
            }
        }
        return seen.Count == open;
    }

    private static void AddAll(HashSet<(int, int)> set, HexPosition[] cells)
    {
        if (cells == null) return;
        foreach (var h in cells) if (h != null) set.Add((h.col, h.row));
    }

    /// <summary>FNV-1a 32-bit over UTF-16 code units. Also used by HexGrid to pick a
    /// sprite per cell, so a given cell always gets the same obstacle in replays.</summary>
    public static uint Fnv1a(string key)
    {
        unchecked
        {
            uint hash = 2166136261u;
            for (int i = 0; i < key.Length; i++)
            {
                hash ^= key[i];
                hash *= 16777619u;
            }
            return hash;
        }
    }

    /// <summary>Tiny platform-independent PRNG (System.Random's sequence is not
    /// guaranteed identical across runtimes; this one is).</summary>
    private struct XorShift32
    {
        private uint state;
        public XorShift32(uint seed) { state = seed == 0 ? 0x9E3779B9u : seed; }
        public uint Next()
        {
            uint x = state;
            x ^= x << 13; x ^= x >> 17; x ^= x << 5;
            state = x;
            return x;
        }
        /// <summary>Uniform int in [minInclusive, maxExclusive).</summary>
        public int Range(int minInclusive, int maxExclusive)
        {
            int span = maxExclusive - minInclusive;
            return span <= 0 ? minInclusive : minInclusive + (int)(Next() % (uint)span);
        }
    }
}
