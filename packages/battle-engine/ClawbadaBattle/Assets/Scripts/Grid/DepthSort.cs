using UnityEngine;

/// <summary>
/// Single source of truth for 2D depth on the board.
///
/// Characters and obstacles share one sorting layer and one sorting order; the
/// camera's custom transparency sort axis (+Y) then orders them back-to-front by
/// position, so an actor whose feet are above a rock's base line is drawn behind it
/// and one whose feet are below is drawn in front — per pixel, and continuously while
/// a lobster walks between rows. No per-row sortingOrder bookkeeping is needed.
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

    /// <summary>Sorting order shared by every board actor. Arena border silhouettes
    /// sit at Foreground/0-1; actors must stay above them.</summary>
    public const int ActorOrder = 100;

    /// <summary>Obstacles are nudged this far up the sort axis (farther from camera) so a
    /// character on the same row — identical feet Y — wins the tie and stays readable.
    /// 0.001 units is 1/16 px at PPU 64: invisible.</summary>
    public const float ObstacleDepthBias = 0.001f;

    public static void Apply(Camera cam)
    {
        if (cam == null) return;
        cam.transparencySortMode = TransparencySortMode.CustomAxis;
        cam.transparencySortAxis = Vector3.up;
    }
}
