using UnityEngine;

/// <summary>
/// Hex coordinate utilities for pointy-top offset grid.
/// Offset coordinates (col, row) with odd-row-right offset.
/// Uses cube coordinates internally for distance and neighbor calculations.
/// </summary>
public static class HexCoord
{
    /// <summary>Convert offset (col, row) to cube coordinates.</summary>
    public static Vector3Int OffsetToCube(int col, int row)
    {
        int x = col - (row - (row & 1)) / 2;
        int z = row;
        int y = -x - z;
        return new Vector3Int(x, y, z);
    }

    /// <summary>Convert cube coordinates back to offset (col, row).</summary>
    public static Vector2Int CubeToOffset(Vector3Int cube)
    {
        int col = cube.x + (cube.z - (cube.z & 1)) / 2;
        int row = cube.z;
        return new Vector2Int(col, row);
    }

    /// <summary>Hex distance between two offset positions.</summary>
    public static int Distance(int col1, int row1, int col2, int row2)
    {
        var a = OffsetToCube(col1, row1);
        var b = OffsetToCube(col2, row2);
        return (Mathf.Abs(a.x - b.x) + Mathf.Abs(a.y - b.y) + Mathf.Abs(a.z - b.z)) / 2;
    }

    /// <summary>Hex distance between two HexPosition objects.</summary>
    public static int Distance(HexPosition a, HexPosition b)
    {
        return Distance(a.col, a.row, b.col, b.row);
    }

    /// <summary>Get world position for a hex tile (pointy-top, odd-row-right offset).</summary>
    public static Vector3 HexToWorld(int col, int row, float hexSize)
    {
        float w = Mathf.Sqrt(3f) * hexSize;
        float h = 2f * hexSize;
        float x = col * w + (row % 2 == 1 ? w * 0.5f : 0f);
        float y = row * (h * 0.75f);
        return new Vector3(x, -y, 0); // negative Y because Unity 2D Y-up
    }

    /// <summary>Get all hex positions within a given range from center.</summary>
    public static System.Collections.Generic.List<Vector2Int> GetHexesInRange(int centerCol, int centerRow, int range)
    {
        var results = new System.Collections.Generic.List<Vector2Int>();
        var centerCube = OffsetToCube(centerCol, centerRow);

        for (int dx = -range; dx <= range; dx++)
        {
            for (int dy = Mathf.Max(-range, -dx - range); dy <= Mathf.Min(range, -dx + range); dy++)
            {
                int dz = -dx - dy;
                var cube = new Vector3Int(centerCube.x + dx, centerCube.y + dy, centerCube.z + dz);
                var offset = CubeToOffset(cube);
                if (offset != new Vector2Int(centerCol, centerRow)) // exclude center
                {
                    results.Add(offset);
                }
            }
        }
        return results;
    }

    /// <summary>Get the 6 neighbor positions of a hex.</summary>
    public static Vector2Int[] GetNeighbors(int col, int row)
    {
        // Pointy-top, odd-row-right offset neighbor directions
        bool oddRow = (row & 1) == 1;
        if (oddRow)
        {
            return new Vector2Int[]
            {
                new(col + 1, row),     // right
                new(col, row - 1),     // upper-left
                new(col + 1, row - 1), // upper-right
                new(col, row + 1),     // lower-left
                new(col + 1, row + 1), // lower-right
                new(col - 1, row),     // left
            };
        }
        else
        {
            return new Vector2Int[]
            {
                new(col + 1, row),     // right
                new(col - 1, row - 1), // upper-left
                new(col, row - 1),     // upper-right
                new(col - 1, row + 1), // lower-left
                new(col, row + 1),     // lower-right
                new(col - 1, row),     // left
            };
        }
    }
}
