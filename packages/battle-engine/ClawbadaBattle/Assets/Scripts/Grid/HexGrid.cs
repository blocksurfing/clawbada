using UnityEngine;
using UnityEngine.Tilemaps;
using System.Collections.Generic;

/// <summary>
/// Runtime hex board manager, conformed to the designer's Unity Grid/Tilemap pipeline.
///
/// The designer authors arena layouts in ArenaAuthoring.unity by painting semantic
/// tiles (ArenaAuthoringTool exports them to ArenaLayout JSON). At runtime this class:
///   • positions everything through the designer's Grid (CellToWorld) so characters,
///     tiles, and painted art always agree on where a hex is,
///   • paints the visible board onto the runtime Tilemap with the designer's
///     hex_default tile (blocked cells stay unpainted — no tile = not walkable),
///   • paints selection highlights (hex_move / hex_attack / hex_ally / hex_selected)
///     over the board via the same ShowSelection JSON API React already uses,
///   • provides BFS pathfinding over open cells for movement animation.
///
/// Cell convention: CellSwizzle XYZ — cell.x = col, cell.y = row (odd-row-right,
/// matching HexCoord and ArenaAuthoringTool).
/// </summary>
public class HexGrid : MonoBehaviour
{
    [Header("Designer Grid (required)")]
    [Tooltip("The Unity Grid that defines hex cell size/placement. Positioning is derived from it via CellToWorld — the designer owns the board's world placement.")]
    public Grid unityGrid;
    [Tooltip("Runtime Tilemap (child of the Grid). The board is painted here at battle start.")]
    public Tilemap boardTilemap;

    [Header("Designer Tiles")]
    public TileBase defaultTile;
    public TileBase moveTile;     // in-range (movement / attack range)
    public TileBase attackTile;   // enemy target
    public TileBase allyTile;     // ally target
    public TileBase selectedTile; // selected character's own hex

    // Runtime state
    private ArenaLayout currentLayout;
    private readonly HashSet<(int, int)> blocked = new();
    private readonly List<Vector3Int> highlightedCells = new();

    /// <summary>Store the arena layout and paint the board. Playable cells get the
    /// default tile; blocked cells stay unpainted (arena art draws obstacles there).</summary>
    public void BuildGrid(ArenaLayout layout)
    {
        currentLayout = layout;
        blocked.Clear();
        if (layout.blockedHexes != null)
        {
            foreach (var b in layout.blockedHexes) blocked.Add((b.col, b.row));
        }

        if (boardTilemap != null)
        {
            boardTilemap.ClearAllTiles();
            highlightedCells.Clear();
            if (defaultTile != null)
            {
                for (int r = 0; r < layout.rows; r++)
                {
                    for (int c = 0; c < layout.cols; c++)
                    {
                        if (!blocked.Contains((c, r)))
                        {
                            boardTilemap.SetTile(new Vector3Int(c, r, 0), defaultTile);
                        }
                    }
                }
            }
        }

        Debug.Log($"[HexGrid] Loaded layout {layout.layoutId} ({layout.cols}x{layout.rows}, " +
                  $"{layout.blockedHexes?.Length ?? 0} blocked, tier: {layout.tier})");
    }

    /// <summary>World-space center of a hex cell. Uses the Tilemap's cell centers
    /// (not the Grid's) so characters land exactly on the drawn tiles — the designer
    /// offsets the Tilemap child to fine-tune board placement.</summary>
    public Vector3 GetWorldPosition(int col, int row)
    {
        var cell = new Vector3Int(col, row, 0);
        if (boardTilemap != null)
        {
            Vector3 p = boardTilemap.GetCellCenterWorld(cell);
            p.z = 0f;
            return p;
        }
        if (unityGrid != null)
        {
            Vector3 p = unityGrid.GetCellCenterWorld(cell);
            p.z = 0f;
            return p;
        }
        // Fallback (nothing assigned): legacy pointy-top math around this transform.
        return transform.position + HexCoord.HexToWorld(col, row, 1f);
    }

    public bool IsBlocked(int col, int row) => blocked.Contains((col, row));

    public bool InBounds(int col, int row)
    {
        if (currentLayout == null) return true;
        return col >= 0 && col < currentLayout.cols && row >= 0 && row < currentLayout.rows;
    }

    /// <summary>BFS shortest path over open cells (blocked cells excluded, other
    /// lobsters do NOT block per design). Returns hex waypoints from AFTER start
    /// through goal inclusive; empty if unreachable or degenerate. Used to animate
    /// movement as hex-to-hex hops that visibly conform to the board.</summary>
    public List<Vector2Int> FindPath(int fromCol, int fromRow, int toCol, int toRow)
    {
        var result = new List<Vector2Int>();
        if (fromCol == toCol && fromRow == toRow) return result;

        var start = new Vector2Int(fromCol, fromRow);
        var goal = new Vector2Int(toCol, toRow);
        var cameFrom = new Dictionary<Vector2Int, Vector2Int> { [start] = start };
        var queue = new Queue<Vector2Int>();
        queue.Enqueue(start);

        while (queue.Count > 0)
        {
            var cur = queue.Dequeue();
            if (cur == goal) break;
            foreach (var n in HexCoord.GetNeighbors(cur.x, cur.y))
            {
                if (cameFrom.ContainsKey(n)) continue;
                if (!InBounds(n.x, n.y)) continue;
                if (blocked.Contains((n.x, n.y)) && n != goal) continue;
                cameFrom[n] = cur;
                queue.Enqueue(n);
            }
        }

        if (!cameFrom.ContainsKey(goal)) return result;
        for (var cur = goal; cur != start; cur = cameFrom[cur]) result.Add(cur);
        result.Reverse();
        return result;
    }

    // ─── Highlight API (called from React via BattleBridge) ───

    /// <summary>Show the full highlight state for the currently selected character by
    /// repainting cells with the designer's highlight tiles. Atomic: clears prior
    /// highlights first. Precedence: origin &gt; enemy &gt; ally &gt; in-range.
    /// JSON shape: HexListData (same contract as before).</summary>
    public void ShowSelection(string json)
    {
        var data = ParseHexList(json);
        if (data == null) return;

        ClearHighlights();
        if (boardTilemap == null) return;

        var claimed = new HashSet<(int, int)>();
        if (data.originCol >= 0 && data.originRow >= 0 && claimed.Add((data.originCol, data.originRow)))
            PaintHighlight(data.originCol, data.originRow, selectedTile);

        foreach (var h in data.enemyTargets)
            if (claimed.Add((h.col, h.row))) PaintHighlight(h.col, h.row, attackTile);
        foreach (var h in data.allyTargets)
            if (claimed.Add((h.col, h.row))) PaintHighlight(h.col, h.row, allyTile);
        foreach (var h in data.rangeHexes)
            if (claimed.Add((h.col, h.row))) PaintHighlight(h.col, h.row, moveTile);
    }

    /// <summary>Restore all highlighted cells back to the plain board tile.</summary>
    public void ClearHighlights()
    {
        if (boardTilemap == null) { highlightedCells.Clear(); return; }
        foreach (var cell in highlightedCells)
        {
            bool isBlocked = blocked.Contains((cell.x, cell.y));
            boardTilemap.SetTile(cell, isBlocked ? null : defaultTile);
        }
        highlightedCells.Clear();
    }

    private void PaintHighlight(int col, int row, TileBase tile)
    {
        if (!InBounds(col, row) || tile == null) return;
        var cell = new Vector3Int(col, row, 0);
        boardTilemap.SetTile(cell, tile);
        highlightedCells.Add(cell);
    }

    private HexListData ParseHexList(string json)
    {
        if (string.IsNullOrEmpty(json))
        {
            Debug.LogWarning("[HexGrid] Empty JSON passed to highlight API.");
            return null;
        }
        try
        {
            var data = JsonUtility.FromJson<HexListData>(json);
            if (data == null) return null;
            if (data.rangeHexes == null)   data.rangeHexes   = System.Array.Empty<HexPosition>();
            if (data.enemyTargets == null) data.enemyTargets = System.Array.Empty<HexPosition>();
            if (data.allyTargets == null)  data.allyTargets  = System.Array.Empty<HexPosition>();
            return data;
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[HexGrid] Failed to parse highlight JSON: {e.Message}\n{json}");
            return null;
        }
    }

#if UNITY_EDITOR
    [ContextMenu("Debug Load Test Layout")]
    private void DebugLoadTestLayout()
    {
        BuildGrid(new ArenaLayout
        {
            layoutId = "arena_debug_test",
            cols = 6,
            rows = 5,
            tier = "evolved",
            blockedHexes = new HexPosition[]
            {
                new HexPosition { col = 2, row = 1 },
                new HexPosition { col = 3, row = 1 },
                new HexPosition { col = 2, row = 3 },
                new HexPosition { col = 3, row = 3 },
            },
            teamASpawns = new HexPosition[]
            {
                new HexPosition { col = 0, row = 0 },
                new HexPosition { col = 0, row = 2 },
                new HexPosition { col = 0, row = 4 },
            },
            teamBSpawns = new HexPosition[]
            {
                new HexPosition { col = 5, row = 0 },
                new HexPosition { col = 5, row = 2 },
                new HexPosition { col = 5, row = 4 },
            },
        });
    }

    [ContextMenu("Debug Show Attack Phase From (0,2)")]
    private void DebugShowAttackPhase()
    {
        if (currentLayout == null) DebugLoadTestLayout();
        string json = "{\"originCol\":0,\"originRow\":2," +
                      "\"rangeHexes\":[" +
                        "{\"col\":1,\"row\":1},{\"col\":1,\"row\":2},{\"col\":1,\"row\":3}," +
                        "{\"col\":0,\"row\":1},{\"col\":0,\"row\":3}]," +
                      "\"enemyTargets\":[{\"col\":1,\"row\":2}]," +
                      "\"allyTargets\":[]}";
        ShowSelection(json);
    }

    [ContextMenu("Debug Clear Highlights")]
    private void DebugClearHighlights()
    {
        ClearHighlights();
    }
#endif
}

[System.Serializable]
public class HexListData
{
    /// <summary>Selected character's own hex (painted with selectedTile).
    /// Use -1,-1 to skip the origin tile.</summary>
    public int originCol = -1;
    public int originRow = -1;

    /// <summary>In-range hexes. Phase 1: movement range. Phase 2: attack max range.</summary>
    public HexPosition[] rangeHexes;

    /// <summary>Enemy-occupied hexes within attack / defend / special range.
    /// Only populated in phase 2 when an enemy-targeted move is being selected.</summary>
    public HexPosition[] enemyTargets;

    /// <summary>Friendly hexes targetable by heal / buff specials (Sentinel Rally).
    /// Only populated in phase 2 for moves like Sentinel Rally.</summary>
    public HexPosition[] allyTargets;
}
