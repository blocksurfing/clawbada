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
///   • spawns one obstacle sprite per blocked cell (ObstacleLibrary, seeded pick per
///     cell) and rolls a deterministic random blocked set when a layout arrives
///     without one (ObstacleLayoutGenerator, seeded by battle id),
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

    [Header("Obstacles")]
    [Tooltip("Tier-scoped obstacle sprites for blocked cells (Art/Obstacles/ObstacleLibrary).")]
    public ObstacleLibrary obstacleLibrary;
    [Tooltip("Parent for spawned obstacles. Defaults to this transform — NOT the designer's Grid, whose z-scale of 0 " +
             "makes world→local placement under it degenerate. The tier scale is applied explicitly instead.")]
    public Transform obstacleRoot;
    [Tooltip("Visual nudge of the sprite from the hex centre, in world units. Purely cosmetic: the depth line " +
             "stays at the hex centre (the SortingGroup root), matching where lobsters' feet sort from.")]
    public Vector2 obstacleOffset = new Vector2(0f, -0.15f);
    [Tooltip("When a layout arrives with no blockedHexes, roll a deterministic random set from the battle id.")]
    public bool randomizeWhenUnspecified = true;
    [Tooltip("Blocked-cell count range for randomized layouts (inclusive).")]
    public int randomBlockedMin = 4;
    public int randomBlockedMax = 5;

    [Header("Per-Tier Board Placement")]
    [Tooltip("Stopgap registration between the authored board (beach-referenced) and each " +
             "tier's arena art, which is auto-centered on the camera. Offset/scale move the " +
             "whole Grid from its authored transform; tint improves tile contrast on dark " +
             "grounds. Replace with authoring-scene registration once the designer pushes " +
             "ArenaAuthoring with the backdrop layers.")]
    public TierPlacement[] tierPlacements =
    {
        new TierPlacement { tier = "evolved", offset = new Vector2(0f, -0.6f) }, // beach: board sat on the shoreline at 0
        new TierPlacement { tier = "elite" },
        new TierPlacement { tier = "apex" },
    };

    [System.Serializable]
    public class TierPlacement
    {
        public string tier;
        [Tooltip("World offset from the Grid's authored position.")]
        public Vector2 offset = Vector2.zero;
        [Tooltip("Uniform scale on the Grid — tiles and spacing scale together.")]
        public float scale = 1f;
        [Tooltip("Tint painted onto board tiles (white = designer's tile untouched).")]
        public Color tileTint = Color.white;
    }

    // Runtime state
    private ArenaLayout currentLayout;
    private readonly HashSet<(int, int)> blocked = new();
    private readonly List<Vector3Int> highlightedCells = new();
    private readonly List<GameObject> activeObstacles = new();
    private Color activeTileTint = Color.white;
    private Vector3 authoredGridPosition;
    private Vector3 authoredGridScale;
    private bool authoredCaptured;

    void Awake()
    {
        DepthSort.Apply(Camera.main != null ? Camera.main : FindAnyObjectByType<Camera>());
    }

    /// <summary>Store the arena layout, paint the board, and place obstacles. Playable
    /// cells get the default tile; blocked cells stay unpainted and get an obstacle
    /// sprite. A layout with no blockedHexes gets a deterministic random set rolled
    /// from <paramref name="battleId"/> (written back into the layout so every consumer
    /// sees the same cells).</summary>
    public void BuildGrid(ArenaLayout layout, string battleId = null)
    {
        currentLayout = layout;
        blocked.Clear();
        if ((layout.blockedHexes == null || layout.blockedHexes.Length == 0) && randomizeWhenUnspecified)
        {
            layout.blockedHexes = ObstacleLayoutGenerator.Generate(
                layout, ObstacleSeed(layout, battleId), randomBlockedMin, randomBlockedMax);
        }
        if (layout.blockedHexes != null)
        {
            foreach (var b in layout.blockedHexes) if (b != null) blocked.Add((b.col, b.row));
        }

        ApplyTierPlacement(layout.tier);

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
                            PaintDefaultTile(new Vector3Int(c, r, 0));
                        }
                    }
                }
            }
        }

        SpawnObstacles(layout, battleId);

        Debug.Log($"[HexGrid] Loaded layout {layout.layoutId} ({layout.cols}x{layout.rows}, " +
                  $"{layout.blockedHexes?.Length ?? 0} blocked, tier: {layout.tier})");
    }

    // ─── Obstacles ───

    private static string ObstacleSeed(ArenaLayout layout, string battleId)
        => $"{layout.layoutId}|{battleId ?? string.Empty}|{layout.tier}";

    /// <summary>One obstacle per blocked cell, sprite chosen by a stable hash of
    /// (seed, cell) so replays match. Each obstacle is a SortingGroup root at the hex
    /// centre (its depth line, same as a lobster's feet) with the sprite on a child
    /// that carries the cosmetic offset — so nudging the art never changes who draws
    /// in front. Depth itself is DepthSort: same layer/order as lobsters, +Y axis.</summary>
    private void SpawnObstacles(ArenaLayout layout, string battleId)
    {
        ClearObstacles();
        if (layout.blockedHexes == null || layout.blockedHexes.Length == 0) return;
        if (obstacleLibrary == null)
        {
            Debug.LogWarning("[HexGrid] obstacleLibrary not assigned — blocked cells will have no obstacle sprites.");
            return;
        }
        Sprite[] sprites = obstacleLibrary.GetSpritesForTier(layout.tier);
        if (sprites == null || sprites.Length == 0)
        {
            Debug.LogWarning($"[HexGrid] No obstacle sprites configured for tier '{layout.tier}'.");
            return;
        }

        Transform parent = ObstacleParent();
        // Board furniture scales with the tiles (tier placement scales the Grid), but the
        // Grid's transform is not a safe parent (see obstacleRoot tooltip): apply its
        // scale explicitly and keep world z at exactly 0.
        float tileScale = unityGrid != null ? unityGrid.transform.lossyScale.x : 1f;
        float parentScale = Mathf.Max(parent.lossyScale.x, 1e-4f);
        string seed = ObstacleSeed(layout, battleId);
        foreach (var b in layout.blockedHexes)
        {
            if (b == null || !InBounds(b.col, b.row)) continue;
            uint hash = ObstacleLayoutGenerator.Fnv1a($"{seed}|{b.col},{b.row}");
            Sprite sprite = sprites[(int)(hash % (uint)sprites.Length)];
            if (sprite == null) continue;

            var root = new GameObject($"Obstacle_{b.col}_{b.row}_{sprite.name}");
            root.transform.SetParent(parent, false);
            root.transform.localScale = Vector3.one * (tileScale / parentScale);
            Vector3 anchor = GetWorldPosition(b.col, b.row);
            // World-upright like the lobsters: this HexGrid object is tilted 30° on X to
            // foreshorten the board, and a sprite inheriting that tilt renders squashed
            // and off the pixel grid (stray rows above sprites with point sampling).
            root.transform.SetPositionAndRotation(
                new Vector3(anchor.x, anchor.y + DepthSort.ObstacleDepthBias, 0f), Quaternion.identity);

            var group = root.AddComponent<UnityEngine.Rendering.SortingGroup>();
            group.sortingLayerName = DepthSort.Layer;
            group.sortingOrder = DepthSort.ActorOrder;

            var art = new GameObject("Sprite");
            art.transform.SetParent(root.transform, false);
            art.transform.localPosition = new Vector3(obstacleOffset.x, obstacleOffset.y, 0f);
            var sr = art.AddComponent<SpriteRenderer>();
            sr.sprite = sprite; // bottom-centre pivot lands on the (offset) hex centre
            activeObstacles.Add(root);
        }
    }

    private Transform ObstacleParent() => obstacleRoot != null ? obstacleRoot : transform;

    /// <summary>Destroy tracked obstacles, plus any untracked "Obstacle_*" children left
    /// under the parent (edit-mode builds survive domain reloads; the list does not).</summary>
    private void ClearObstacles()
    {
        foreach (var go in activeObstacles) DestroySafe(go);
        activeObstacles.Clear();

        Transform parent = ObstacleParent();
        for (int i = parent.childCount - 1; i >= 0; i--)
        {
            var child = parent.GetChild(i);
            if (child.name.StartsWith("Obstacle_")) DestroySafe(child.gameObject);
        }
    }

    private static void DestroySafe(GameObject go)
    {
        if (go == null) return;
        if (Application.isPlaying) Destroy(go);
        else DestroyImmediate(go);
    }

    /// <summary>Move/scale the Grid from its authored transform for this tier's arena
    /// art, and pick the tile tint. Neutral (no entry / defaults) leaves the authored
    /// placement untouched. Re-entrant: always re-applies from the captured base, so
    /// repeated battle inits with different tiers don't accumulate.</summary>
    private void ApplyTierPlacement(string tier)
    {
        if (unityGrid == null) return;

        if (!authoredCaptured)
        {
            authoredGridPosition = unityGrid.transform.localPosition;
            authoredGridScale = unityGrid.transform.localScale;
            authoredCaptured = true;
        }

        TierPlacement placement = null;
        if (tierPlacements != null && !string.IsNullOrEmpty(tier))
        {
            foreach (var p in tierPlacements)
            {
                if (p != null && string.Equals(p.tier, tier, System.StringComparison.OrdinalIgnoreCase))
                {
                    placement = p;
                    break;
                }
            }
        }

        Vector2 offset = placement?.offset ?? Vector2.zero;
        float scale = placement != null && placement.scale > 0f ? placement.scale : 1f;
        activeTileTint = placement?.tileTint ?? Color.white;

        unityGrid.transform.localPosition = authoredGridPosition + new Vector3(offset.x, offset.y, 0f);
        unityGrid.transform.localScale = authoredGridScale * scale;
    }

    /// <summary>Paint the plain board tile with the tier tint applied per cell
    /// (designer tiles ship with LockColor, so the flag is cleared first).</summary>
    private void PaintDefaultTile(Vector3Int cell)
    {
        boardTilemap.SetTile(cell, defaultTile);
        boardTilemap.SetTileFlags(cell, TileFlags.None);
        boardTilemap.SetColor(cell, activeTileTint);
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

    /// <summary>Inverse of GetWorldPosition: the hex under a world point, via the same
    /// Tilemap/Grid the board is drawn on (correct under the grid's authored rotation).
    /// False when the point is off the board.</summary>
    public bool WorldToHex(Vector3 world, out int col, out int row)
    {
        Vector3Int cell;
        if (boardTilemap != null) cell = boardTilemap.WorldToCell(world);
        else if (unityGrid != null) cell = unityGrid.WorldToCell(world);
        else
        {
            col = row = -1;
            return false;
        }
        col = cell.x;
        row = cell.y;
        return InBounds(col, row);
    }

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
            if (blocked.Contains((cell.x, cell.y)))
            {
                boardTilemap.SetTile(cell, null);
            }
            else
            {
                PaintDefaultTile(cell);
            }
        }
        highlightedCells.Clear();
    }

    private void PaintHighlight(int col, int row, TileBase tile)
    {
        if (!InBounds(col, row) || tile == null) return;
        var cell = new Vector3Int(col, row, 0);
        boardTilemap.SetTile(cell, tile);
        // Highlights render as authored — clear any tier tint left on the cell.
        boardTilemap.SetTileFlags(cell, TileFlags.None);
        boardTilemap.SetColor(cell, Color.white);
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
