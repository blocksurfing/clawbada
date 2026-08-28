using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// LKR-style hex grid manager. Hex tiles are runtime overlay GameObjects spawned on
/// demand when a character is selected — there is no persistent grid of tiles in the
/// scene. BuildGrid stores the arena's metadata (cols/rows/blocked/spawns) and
/// ShowSelection spawns HexTile overlays for the current selection state: stone for
/// in-range hexes, blue for the selected character's own hex, red for enemy targets,
/// green for ally targets. The visual arena background is a separate SpriteRenderer.
/// </summary>
public class HexGrid : MonoBehaviour
{
    [Header("Grid Settings")]
    public float hexSize = 1.0f;

    [Header("Prefabs")]
    [Tooltip("The animated HexTile overlay prefab. Spawned on demand by ShowSelection when a character is selected.")]
    public GameObject hexTilePrefab;

    [Header("Timing")]
    [Tooltip("Seconds to wait after ClearHighlights() before destroying spawned tiles — gives the fade-out animation time to play.")]
    public float fadeOutDuration = 0.25f;

    [Header("Obstacles")]
    [Tooltip("Tier-scoped sprites for blocked arena cells.")]
    public ObstacleLibrary obstacleLibrary;
    [Tooltip("Optional parent for spawned obstacle sprites. Defaults to this grid transform.")]
    public Transform obstacleRoot;
    [Tooltip("Local offset from the blocked hex center to the obstacle sprite pivot.")]
    public Vector2 obstacleOffset = Vector2.zero;
    [Tooltip("Base SpriteRenderer sorting order for obstacle sprites; row is added on top.")]
    public int obstacleSortingBase = 20;

    [Header("Editor Preview")]
    [Tooltip("Draw hex outlines in the Scene view for debugging. Editor-only, purely visual.")]
    public bool drawPreview = true;
    public int previewCols = 6;
    public int previewRows = 5;

    // Runtime state
    private ArenaLayout currentLayout;
    private readonly List<HexTile> activeTiles = new();
    private readonly List<GameObject> activeObstacles = new();

    /// <summary>Store the arena layout, recenter the grid, and spawn blocked-cell
    /// obstacle sprites. Highlight overlay tiles are still spawned on demand by ShowSelection.</summary>
    public void BuildGrid(ArenaLayout layout, string battleId = null)
    {
        ClearHighlightsImmediate();
        ClearObstaclesImmediate();
        currentLayout = layout;
        CenterGrid(layout);
        SpawnObstacles(layout, battleId);
        Debug.Log($"[HexGrid] Loaded layout {layout.layoutId} ({layout.cols}x{layout.rows}, " +
                  $"{layout.blockedHexes?.Length ?? 0} blocked, tier: {layout.tier})");
    }

    // ─── Highlight API (called from React via BattleBridge) ───

    /// <summary>Show the full highlight state for the currently selected character.
    /// Atomic: clears prior highlights, then spawns the blue origin tile plus the three
    /// target arrays with dedupe precedence enemy &gt; ally &gt; in-range. A hex that
    /// appears in both rangeHexes and enemyTargets renders as red only — the more
    /// actionable state always wins. React builds the payload per phase:
    ///   • Phase 1 positioning  → rangeHexes populated; enemy/ally arrays empty
    ///   • Phase 2 attack/defend → rangeHexes + enemyTargets populated
    ///   • Phase 2 heal/buff     → rangeHexes + allyTargets populated
    /// JSON shape: HexListData.</summary>
    public void ShowSelection(string json)
    {
        var data = ParseHexList(json);
        if (data == null) return;

        ClearHighlights();
        SpawnOrigin(data);

        // Track cells already claimed by a higher-precedence highlight so we don't
        // stack two overlay tiles on the same hex. Precedence: origin > enemy > ally > range.
        var claimed = new HashSet<(int, int)>();
        if (data.originCol >= 0 && data.originRow >= 0)
            claimed.Add((data.originCol, data.originRow));

        foreach (var h in data.enemyTargets)
        {
            if (claimed.Add((h.col, h.row)))
                SpawnTile(h.col, h.row, HexHighlight.EnemyTarget);
        }
        foreach (var h in data.allyTargets)
        {
            if (claimed.Add((h.col, h.row)))
                SpawnTile(h.col, h.row, HexHighlight.AllyTarget);
        }
        foreach (var h in data.rangeHexes)
        {
            if (claimed.Add((h.col, h.row)))
                SpawnTile(h.col, h.row, HexHighlight.InRange);
        }
    }

    /// <summary>Clear all currently spawned highlight tiles. Plays fade-out via
    /// HexTile.FadeOutAndDestroy before destroying each tile.</summary>
    public void ClearHighlights()
    {
        if (activeTiles.Count == 0) return;
        foreach (var tile in activeTiles)
        {
            if (tile != null) tile.FadeOutAndDestroy(fadeOutDuration);
        }
        activeTiles.Clear();
    }

    // ─── Private helpers ───

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

    private void SpawnOrigin(HexListData data)
    {
        if (data.originCol < 0 || data.originRow < 0) return;
        SpawnTile(data.originCol, data.originRow, HexHighlight.SelectedLobster);
    }

    private HexTile SpawnTile(int col, int row, HexHighlight highlight)
    {
        if (!InBounds(col, row)) return null;
        if (hexTilePrefab == null)
        {
            Debug.LogWarning($"[HexGrid] hexTilePrefab not assigned — cannot spawn overlay at ({col},{row}).");
            return null;
        }

        GameObject go = Instantiate(hexTilePrefab, transform);
        go.transform.localPosition = HexCoord.HexToWorld(col, row, hexSize);

        var tile = go.GetComponent<HexTile>();
        if (tile == null) tile = go.AddComponent<HexTile>();

        tile.Initialize(col, row, IsBlocked(col, row));
        tile.SetHighlight(highlight);
        activeTiles.Add(tile);
        return tile;
    }

    private bool IsBlocked(int col, int row)
    {
        if (currentLayout?.blockedHexes == null) return false;
        foreach (var b in currentLayout.blockedHexes)
        {
            if (b.col == col && b.row == row) return true;
        }
        return false;
    }

    private void SpawnObstacles(ArenaLayout layout, string battleId)
    {
        if (layout?.blockedHexes == null || layout.blockedHexes.Length == 0) return;
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

        Transform parent = obstacleRoot != null ? obstacleRoot : transform;
        string seedPrefix = $"{layout.layoutId}|{battleId ?? string.Empty}|{layout.tier}";

        foreach (var blocked in layout.blockedHexes)
        {
            if (blocked == null || !InBounds(blocked.col, blocked.row)) continue;

            Sprite sprite = sprites[StableIndex($"{seedPrefix}|{blocked.col},{blocked.row}", sprites.Length)];
            if (sprite == null) continue;

            GameObject go = new GameObject($"Obstacle_{layout.tier}_{blocked.col}_{blocked.row}_{sprite.name}");
            go.transform.SetParent(parent, false);
            Vector3 hexPos = HexCoord.HexToWorld(blocked.col, blocked.row, hexSize);
            go.transform.localPosition = hexPos + new Vector3(obstacleOffset.x, obstacleOffset.y, 0f);

            var renderer = go.AddComponent<SpriteRenderer>();
            renderer.sprite = sprite;
            renderer.sortingOrder = obstacleSortingBase + blocked.row;
            activeObstacles.Add(go);
        }
    }

    private int StableIndex(string key, int count)
    {
        unchecked
        {
            uint hash = 2166136261u;
            for (int i = 0; i < key.Length; i++)
            {
                hash ^= key[i];
                hash *= 16777619u;
            }
            return (int)(hash % (uint)count);
        }
    }

    private bool InBounds(int col, int row)
    {
        if (currentLayout == null) return true;
        return col >= 0 && col < currentLayout.cols && row >= 0 && row < currentLayout.rows;
    }

    private void CenterGrid(ArenaLayout layout)
    {
        float w = Mathf.Sqrt(3f) * hexSize;
        float h = 2f * hexSize;
        float gridWidth = (layout.cols - 1) * w + w * 0.5f;
        float gridHeight = (layout.rows - 1) * (h * 0.75f);
        transform.position = new Vector3(-gridWidth / 2f, -gridHeight / 2f, 0);
    }

    private void ClearHighlightsImmediate()
    {
        foreach (var tile in activeTiles)
        {
            if (tile == null) continue;
            if (Application.isPlaying) Destroy(tile.gameObject);
            else DestroyImmediate(tile.gameObject);
        }
        activeTiles.Clear();
    }

    private void ClearObstaclesImmediate()
    {
        foreach (var obstacle in activeObstacles)
        {
            if (obstacle == null) continue;
            if (Application.isPlaying) Destroy(obstacle);
            else DestroyImmediate(obstacle);
        }
        activeObstacles.Clear();
    }

#if UNITY_EDITOR
    void OnDrawGizmos()
    {
        if (!drawPreview) return;

        for (int r = 0; r < previewRows; r++)
        {
            for (int c = 0; c < previewCols; c++)
            {
                Vector3 worldPos = transform.position + HexCoord.HexToWorld(c, r, hexSize);
                Gizmos.color = new Color(0.4f, 0.7f, 1f, 0.9f);
                DrawHexOutlineGizmo(worldPos, hexSize);
            }
        }
    }

    private void DrawHexOutlineGizmo(Vector3 center, float size)
    {
        Vector3[] corners = new Vector3[6];
        for (int i = 0; i < 6; i++)
        {
            float angle = Mathf.Deg2Rad * (60f * i - 30f); // pointy-top hex
            corners[i] = center + new Vector3(size * Mathf.Cos(angle), size * Mathf.Sin(angle), 0);
        }
        for (int i = 0; i < 6; i++)
        {
            Gizmos.DrawLine(corners[i], corners[(i + 1) % 6]);
        }
    }

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

    [ContextMenu("Debug Show Move Phase From (0,2)")]
    private void DebugShowMovePhase()
    {
        if (currentLayout == null) DebugLoadTestLayout();
        string json = "{\"originCol\":0,\"originRow\":2," +
                      "\"rangeHexes\":[" +
                        "{\"col\":1,\"row\":1},{\"col\":1,\"row\":2},{\"col\":1,\"row\":3}," +
                        "{\"col\":0,\"row\":1},{\"col\":0,\"row\":3}]," +
                      "\"enemyTargets\":[]," +
                      "\"allyTargets\":[]}";
        ShowSelection(json);
    }

    [ContextMenu("Debug Show Attack Phase From (0,2)")]
    private void DebugShowAttackPhase()
    {
        if (currentLayout == null) DebugLoadTestLayout();
        // Stone in-range + one enemy on (1,2) — exercises the enemy > range dedupe.
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
        ClearHighlightsImmediate();
    }
#endif
}

[System.Serializable]
public class HexListData
{
    /// <summary>Selected character's own hex (spawned as SelectedLobster / blue).
    /// Use -1,-1 to skip the origin tile.</summary>
    public int originCol = -1;
    public int originRow = -1;

    /// <summary>In-range hexes (stone). Phase 1: movement range. Phase 2: attack max range.</summary>
    public HexPosition[] rangeHexes;

    /// <summary>Enemy-occupied hexes within attack / defend / special range (red).
    /// Only populated in phase 2 when an enemy-targeted move is being selected.</summary>
    public HexPosition[] enemyTargets;

    /// <summary>Friendly hexes targetable by heal / buff specials (green).
    /// Only populated in phase 2 for moves like Sentinel Rally.</summary>
    public HexPosition[] allyTargets;
}
