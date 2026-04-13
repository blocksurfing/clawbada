using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// Manages the 6×5 hex grid arena. Builds tiles, handles highlights, and placement.
/// </summary>
public class HexGrid : MonoBehaviour
{
    [Header("Grid Settings")]
    public float hexSize = 1.0f;

    [Header("Prefabs")]
    public GameObject hexTilePrefab;

    [Header("Editor Preview")]
    [Tooltip("Draw hex outlines in the Scene view before BuildGrid runs. Editor-only.")]
    public bool drawPreview = true;
    public int previewCols = 6;
    public int previewRows = 5;

    // Runtime state
    private Dictionary<Vector2Int, HexTile> tiles = new();
    private ArenaLayout currentLayout;

    /// <summary>Build the hex grid from an arena layout.</summary>
    public void BuildGrid(ArenaLayout layout)
    {
        // Clear existing tiles (Destroy in play mode, DestroyImmediate in edit mode)
        foreach (var tile in tiles.Values)
        {
            if (tile == null) continue;
            if (Application.isPlaying) Destroy(tile.gameObject);
            else DestroyImmediate(tile.gameObject);
        }
        tiles.Clear();
        currentLayout = layout;

        // Create hex tiles
        for (int r = 0; r < layout.rows; r++)
        {
            for (int c = 0; c < layout.cols; c++)
            {
                Vector3 worldPos = HexCoord.HexToWorld(c, r, hexSize);
                bool blocked = IsBlocked(c, r, layout);

                GameObject tileObj;
                if (hexTilePrefab != null)
                {
                    tileObj = Instantiate(hexTilePrefab, worldPos, Quaternion.identity, transform);
                }
                else
                {
                    // Fallback: create a simple placeholder
                    tileObj = new GameObject($"Hex_{c}_{r}");
                    tileObj.transform.position = worldPos;
                    tileObj.transform.SetParent(transform);
                }

                var hexTile = tileObj.GetComponent<HexTile>();
                if (hexTile == null) hexTile = tileObj.AddComponent<HexTile>();

                hexTile.Initialize(c, r, blocked);
                tiles[new Vector2Int(c, r)] = hexTile;
            }
        }

        // Center the grid in the scene
        CenterGrid(layout);

        Debug.Log($"[HexGrid] Built {layout.cols}x{layout.rows} grid, {tiles.Count} tiles, {layout.blockedHexes?.Length ?? 0} blocked");
    }

    private bool IsBlocked(int col, int row, ArenaLayout layout)
    {
        if (layout.blockedHexes == null) return false;
        foreach (var b in layout.blockedHexes)
        {
            if (b.col == col && b.row == row) return true;
        }
        return false;
    }

    private void CenterGrid(ArenaLayout layout)
    {
        float w = Mathf.Sqrt(3f) * hexSize;
        float h = 2f * hexSize;
        float gridWidth = (layout.cols - 1) * w + w * 0.5f;
        float gridHeight = (layout.rows - 1) * (h * 0.75f);
        transform.position = new Vector3(-gridWidth / 2f, gridHeight / 2f, 0);
    }

    public HexTile GetTile(int col, int row)
    {
        tiles.TryGetValue(new Vector2Int(col, row), out var tile);
        return tile;
    }

    /// <summary>Show movement range highlights from JSON.</summary>
    public void ShowMoveRange(string json)
    {
        ClearHighlights();
        // TODO: Parse json, highlight reachable hexes in blue
        Debug.Log($"[HexGrid] ShowMoveRange: {json}");
    }

    /// <summary>Show attack range highlights with distance modifiers from JSON.</summary>
    public void ShowAttackRange(string json)
    {
        ClearHighlights();
        // TODO: Parse json, highlight targets with distance-based colors
        Debug.Log($"[HexGrid] ShowAttackRange: {json}");
    }

    /// <summary>Clear all hex highlights.</summary>
    public void ClearHighlights()
    {
        foreach (var tile in tiles.Values)
        {
            tile.SetHighlight(HexHighlight.None);
        }
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

    [ContextMenu("Debug Build Test Grid")]
    private void DebugBuildTestGrid()
    {
        var layout = new ArenaLayout
        {
            cols = 6,
            rows = 5,
            tier = "evolved",
            blockedHexes = new HexPosition[]
            {
                new HexPosition { col = 2, row = 1 },
                new HexPosition { col = 3, row = 2 },
                new HexPosition { col = 1, row = 3 },
                new HexPosition { col = 4, row = 0 },
                new HexPosition { col = 4, row = 4 },
                new HexPosition { col = 2, row = 4 },
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
        };
        BuildGrid(layout);
    }

    [ContextMenu("Debug Clear Grid")]
    private void DebugClearGrid()
    {
        var children = new System.Collections.Generic.List<GameObject>();
        foreach (Transform child in transform) children.Add(child.gameObject);
        foreach (var go in children)
        {
            if (Application.isPlaying) Destroy(go);
            else DestroyImmediate(go);
        }
        tiles.Clear();
    }
#endif
}
