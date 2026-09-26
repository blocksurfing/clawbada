using UnityEngine;
using UnityEngine.EventSystems;

/// <summary>
/// Pointer input for the live battle: a click on the board becomes either
/// onLobsterSelected (a lobster stands there) or onHexClicked (empty hex), sent to
/// React through BattleBridge. Unity only reports the click — React holds the
/// authoritative state, decides what the click means (move destination / target),
/// asks Unity to paint highlights via ShowSelection, and submits the turn.
///
/// Attach to the HexGrid GameObject. Uses the legacy Input API (project setting
/// activeInputHandler = 0). Runs after the EventSystem so clicks on the in-canvas HUD
/// (uGUI) are recognised and never fall through to the board.
/// </summary>
[DefaultExecutionOrder(100)]
public class HexInput : MonoBehaviour
{
    private HexGrid hexGrid;
    private BattleManager battleManager;
    private BattleBridge bridge;

    void Awake()
    {
        hexGrid = GetComponent<HexGrid>();
        if (hexGrid == null) hexGrid = FindFirstObjectByType<HexGrid>();
        battleManager = FindFirstObjectByType<BattleManager>();
        bridge = FindFirstObjectByType<BattleBridge>();
    }

    void Update()
    {
        if (!Input.GetMouseButtonDown(0)) return;
        // The battle HUD is a uGUI canvas over the board: a click on it must not also count
        // as a board click.
        if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject()) return;
        if (hexGrid == null || bridge == null) return;
        var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
        if (cam == null) return;

        // Intersect the pointer ray with the board plane (z = 0). Works for orthographic
        // AND perspective cameras — ScreenToWorldPoint with z = 0 returns the camera's own
        // position under a perspective camera, which mapped every click to the same cell.
        Ray ray = cam.ScreenPointToRay(Input.mousePosition);
        if (Mathf.Approximately(ray.direction.z, 0f)) return;
        float t = -ray.origin.z / ray.direction.z;
        Vector3 world = ray.origin + ray.direction * t;
        world.z = 0f;

        // A lobster's drawn body wins over the hex under the pointer: bodies stand up from the hex centre,
        // so the hex a tap falls in is often the row BEHIND the lobster that was tapped.
        var body = battleManager != null ? battleManager.LobsterAtPoint(world) : null;
        bool onHex = hexGrid.WorldToHex(world, out int col, out int row);
        var lobster = onHex && battleManager != null ? battleManager.GetLobsterAt(col, row) : null;
        // An EMPTY hex tapped near its centre stays a move, even where a neighbour's body box reaches.
        bool emptyHexCentre = onHex && (lobster == null || !lobster.alive) && NearCentre(world, col, row);
        if (body != null && !emptyHexCentre)
        {
            Debug.Log($"[HexInput] click → lobster {body.lobsterId} (body) at ({body.col},{body.row})");
            bridge.NotifyLobsterSelected(body.lobsterId);
            return;
        }

        if (!onHex) return;
        if (lobster != null && lobster.alive)
        {
            Debug.Log($"[HexInput] click → lobster {lobster.lobsterId} at ({col},{row})");
            bridge.NotifyLobsterSelected(lobster.lobsterId);
        }
        else
        {
            Debug.Log($"[HexInput] click → hex ({col},{row})");
            bridge.NotifyHexClicked(col, row);
        }
    }

    /// <summary>Within ~35% of a cell of the hex centre (spacing read from the grid, so board scale is honoured).</summary>
    private bool NearCentre(Vector3 world, int col, int row)
    {
        Vector3 c = hexGrid.GetWorldPosition(col, row);
        Vector3 right = hexGrid.GetWorldPosition(col + 1, row);
        Vector3 down = hexGrid.GetWorldPosition(col, row + 1);
        float cell = Mathf.Min(Mathf.Abs(right.x - c.x), Mathf.Max(0.05f, Mathf.Abs(down.y - c.y)));
        return Vector2.Distance(world, c) < cell * 0.35f;
    }
}
