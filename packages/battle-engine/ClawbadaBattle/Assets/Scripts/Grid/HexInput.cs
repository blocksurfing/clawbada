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
        if (hexGrid == null || bridge == null || Camera.main == null) return;

        Vector3 world = Camera.main.ScreenToWorldPoint(Input.mousePosition);
        world.z = 0f;
        if (!hexGrid.WorldToHex(world, out int col, out int row)) return;

        var lobster = battleManager != null ? battleManager.GetLobsterAt(col, row) : null;
        if (lobster != null && lobster.alive) bridge.NotifyLobsterSelected(lobster.lobsterId);
        else bridge.NotifyHexClicked(col, row);
    }
}
