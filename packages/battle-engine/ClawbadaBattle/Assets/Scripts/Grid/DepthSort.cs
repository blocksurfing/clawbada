using UnityEngine;

/// <summary>
/// Single source of truth for 2D depth on the board.
///
/// Every hex ROW is its own layer, back row lowest, front row highest (the designer's
/// model: "each row should have its own layer, 1st row bottom to final row top"). Anything
/// standing on a row takes that row's band, so every sprite on row 3 draws over every sprite
/// on row 2 whatever their art overlaps — and an object changes band as it crosses between
/// rows, which is what a walking lobster does mid-hop.
///
/// Inside one row's band the order is obstacle, then the lobster, then the lobster's own
/// effects, then that row's decor. The camera's custom transparency sort axis (+Y) still
/// resolves ties inside a band — two lobsters on the same row — per pixel by feet position.
///
/// Requirements this encodes:
///   • lobster rig roots sit at the hex centre (feet) and carry a SortingGroup, so the
///     whole rig sorts by its feet position;
///   • each obstacle is a SortingGroup root placed at its hex centre (the same depth
///     line a lobster on that cell would have), with the bottom-centre-pivoted sprite on
///     a child that carries any cosmetic offset — so nudging the art never changes depth.
///
/// The axis is also set in ProjectSettings/GraphicsSettings.asset; applying it here
/// keeps the behaviour if that project setting is ever reset.
/// </summary>
public static class DepthSort
{
    /// <summary>Sorting layer shared by every board actor.</summary>
    public const string Layer = "Foreground";

    /// <summary>Sorting order of the BACK row's band. Each row in front adds <see cref="RowStride"/>.</summary>
    public const int ActorOrder = 100;

    /// <summary>Orders reserved for one hex row, enough for the four slots below.</summary>
    public const int RowStride = 4;

    /// <summary>Slots inside a row's band, back to front.</summary>
    public const int RowObstacle = 0, RowActor = 1, RowActorFx = 2, RowDecor = 3;

    /// <summary>Rows a band can be raised before it would reach the arena's front art.</summary>
    private const int MaxRowsFromBack = (ArenaFrontOrderBase - ActorOrder) / RowStride - 1;

    /// <summary>The band for a row, counted from the BACK row (0 = the row at the top of the
    /// screen, which draws under everything).</summary>
    public static int OrderForRow(int rowsFromBack) =>
        ActorOrder + Mathf.Clamp(rowsFromBack, 0, MaxRowsFromBack) * RowStride;

    /// <summary>The row an actor's order belongs to — the inverse of <see cref="OrderForRow"/>.</summary>
    public static int RowOf(int order) => Mathf.Max(0, (order - ActorOrder) / RowStride);

    /// <summary>Added to the sorting order of every arena-art renderer the designer put
    /// on the Foreground sorting layer (FG_1, FG_2, …), so frame art — the plants and
    /// rocks at the bottom edge — always draws in front of board actors. Relative order
    /// between FG layers is preserved.</summary>
    public const int ArenaFrontOrderBase = 200;

    /// <summary>Obstacles are nudged this far up the sort axis (farther from camera) so a
    /// character on the same row — identical feet Y — wins the tie and stays readable.
    /// 0.001 units is 1/16 px at PPU 64: invisible. (Belt and braces now that the row band
    /// puts the lobster a slot above its row's obstacles anyway.)</summary>
    public const float ObstacleDepthBias = 0.001f;

    public static void Apply(Camera cam)
    {
        if (cam == null) return;
        cam.transparencySortMode = TransparencySortMode.CustomAxis;
        cam.transparencySortAxis = Vector3.up;
    }
}
