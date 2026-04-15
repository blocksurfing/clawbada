using UnityEngine;
using UnityEngine.Tilemaps;
using System.Collections.Generic;

/// <summary>
/// Design-time component for authoring arena layouts. The designer paints a layout
/// onto a Tilemap using their own hex tile sprites, then this tool walks the painted
/// cells and converts them into gameplay data (blocked hexes + team spawn points)
/// using a semantic tile mapping configured in the inspector.
///
/// The Tilemap lives only in authoring scenes and prefabs — it never ships to
/// BattleScene. At runtime the server sends an ArenaLayout JSON (the export output
/// of this tool) and the code spawns LKR-style hex overlays on demand via HexGrid.
///
/// Playable hexes are implicit: any cell within cols × rows that isn't in
/// blockedHexes is considered playable. Only three semantic tile slots are exposed
/// (blocked / Team A spawn / Team B spawn) — everything else the designer paints
/// (empty cells or visual-only filler sprites) is treated as open. Unmapped painted
/// cells are tracked during import and surfaced as a Validate() warning so the
/// designer notices if they drop a new obstacle sprite without wiring it up.
/// </summary>
[ExecuteAlways]
public class ArenaAuthoringTool : MonoBehaviour
{
    [Header("Layout Metadata")]
    public string layoutId = "arena_evolved_01";
    [Tooltip("Matches the battle tier: \"evolved\" | \"elite\" | \"apex\".")]
    public string tier = "evolved";
    public int cols = 6;
    public int rows = 5;

    [Header("Tilemap Source")]
    [Tooltip("The Tilemap whose painted cells define this arena layout.")]
    public Tilemap sourceTilemap;

    [Header("Semantic Tile Mapping")]
    [Tooltip("Paint this tile on a hex to mark it as a blocked / non-traversable cell.")]
    public TileBase blockedTile;
    [Tooltip("Paint this tile to mark a Team A spawn point. Expected: exactly 3 per layout.")]
    public TileBase teamASpawnTile;
    [Tooltip("Paint this tile to mark a Team B spawn point. Expected: exactly 3 per layout.")]
    public TileBase teamBSpawnTile;

    [Header("Imported Data (read-only preview)")]
    [SerializeField] private List<HexPosition> blockedHexes = new();
    [SerializeField] private List<HexPosition> teamASpawns = new();
    [SerializeField] private List<HexPosition> teamBSpawns = new();
    [Tooltip("Cells painted with a sprite that doesn't match any of the three semantic tiles. Treated as playable on export; surfaced as a Validate() warning.")]
    [SerializeField] private List<HexPosition> unknownTiles = new();

    public IReadOnlyList<HexPosition> BlockedHexes => blockedHexes;
    public IReadOnlyList<HexPosition> TeamASpawns  => teamASpawns;
    public IReadOnlyList<HexPosition> TeamBSpawns  => teamBSpawns;
    public IReadOnlyList<HexPosition> UnknownTiles => unknownTiles;

    /// <summary>Walk the source Tilemap and rebuild the gameplay data lists.</summary>
    public void ImportFromTilemap()
    {
        blockedHexes.Clear();
        teamASpawns.Clear();
        teamBSpawns.Clear();
        unknownTiles.Clear();

        if (sourceTilemap == null)
        {
            Debug.LogWarning($"[ArenaAuthoringTool] {name}: sourceTilemap not assigned.");
            return;
        }

        BoundsInt bounds = sourceTilemap.cellBounds;
        foreach (var cellPos in bounds.allPositionsWithin)
        {
            TileBase tile = sourceTilemap.GetTile(cellPos);
            if (tile == null) continue;

            // Unity hex Tilemap with CellSwizzle.XYZ: cellPos.x = col, cellPos.y = row.
            // If the designer uses a different swizzle and coords look transposed after
            // export, flip this mapping.
            int col = cellPos.x;
            int row = cellPos.y;
            if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

            var pos = new HexPosition { col = col, row = row };
            if (ReferenceEquals(tile, blockedTile))
                blockedHexes.Add(pos);
            else if (ReferenceEquals(tile, teamASpawnTile))
                teamASpawns.Add(pos);
            else if (ReferenceEquals(tile, teamBSpawnTile))
                teamBSpawns.Add(pos);
            else
                unknownTiles.Add(pos);
        }

        string unknownSuffix = unknownTiles.Count > 0
            ? $", {unknownTiles.Count} unmapped cell(s) (treated as playable)."
            : ".";
        Debug.Log($"[ArenaAuthoringTool] {layoutId}: imported " +
                  $"{blockedHexes.Count} blocked, " +
                  $"{teamASpawns.Count} Team A spawn(s), " +
                  $"{teamBSpawns.Count} Team B spawn(s)" + unknownSuffix);
    }

    public ArenaLayout ToArenaLayout()
    {
        return new ArenaLayout
        {
            layoutId = layoutId,
            cols = cols,
            rows = rows,
            tier = tier,
            blockedHexes = blockedHexes.ToArray(),
            teamASpawns  = teamASpawns.ToArray(),
            teamBSpawns  = teamBSpawns.ToArray(),
        };
    }

    /// <summary>Returns a list of human-readable issues, or empty list if the layout is valid.</summary>
    public List<string> Validate()
    {
        var issues = new List<string>();

        if (blockedTile == null)    issues.Add("No 'blockedTile' assigned in the semantic mapping.");
        if (teamASpawnTile == null) issues.Add("No 'teamASpawnTile' assigned in the semantic mapping.");
        if (teamBSpawnTile == null) issues.Add("No 'teamBSpawnTile' assigned in the semantic mapping.");

        if (teamASpawns.Count != 3)
            issues.Add($"Team A has {teamASpawns.Count} spawn(s), expected 3.");
        if (teamBSpawns.Count != 3)
            issues.Add($"Team B has {teamBSpawns.Count} spawn(s), expected 3.");

        foreach (var s in teamASpawns)
            if (IsBlockedAt(s.col, s.row))
                issues.Add($"Team A spawn ({s.col},{s.row}) sits on a blocked hex.");
        foreach (var s in teamBSpawns)
            if (IsBlockedAt(s.col, s.row))
                issues.Add($"Team B spawn ({s.col},{s.row}) sits on a blocked hex.");

        if (unknownTiles.Count > 0)
        {
            issues.Add($"{unknownTiles.Count} painted cell(s) use a sprite that isn't " +
                       "blockedTile / teamASpawnTile / teamBSpawnTile — they'll be " +
                       "treated as playable on export. If that's a new obstacle sprite, " +
                       "wire it up in the semantic mapping.");
        }

        return issues;
    }

    private bool IsBlockedAt(int col, int row)
    {
        foreach (var h in blockedHexes)
            if (h.col == col && h.row == row) return true;
        return false;
    }
}
