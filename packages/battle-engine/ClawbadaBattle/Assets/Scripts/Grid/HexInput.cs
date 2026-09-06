using UnityEngine;

/// <summary>
/// Pointer input for the live battle: a click on the board becomes either
/// onLobsterSelected (a lobster stands there) or onHexClicked (empty hex), sent to
/// React through BattleBridge. Unity only reports the click — React holds the
/// authoritative state, decides what the click means (move destination / target),
/// asks Unity to paint highlights via ShowSelection, and submits the turn.
///
/// Attach to the HexGrid GameObject. Uses the legacy Input API (project setting
/// activeInputHandler = 0).
/// </summary>
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
        // The HUD is React HTML outside the canvas, so no in-scene UI hit test is needed
        // (the project has no uGUI / EventSystem package).
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
        if (!hexGrid.WorldToHex(world, out int col, out int row)) return;

        var lobster = battleManager != null ? battleManager.GetLobsterAt(col, row) : null;
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
}
