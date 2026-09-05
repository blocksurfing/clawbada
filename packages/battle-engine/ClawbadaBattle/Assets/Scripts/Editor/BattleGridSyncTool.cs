using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Tilemaps;

/// <summary>
/// Copies the designer's authoritative grid metrics (Grid cellSize + Grid/Tilemap
/// transforms) from ArenaAuthoring.unity into the currently open BattleScene, so the
/// runtime board always matches the designer's authored board exactly. Run after the
/// designer pushes changes to the authoring scene ("copy the exact layout").
/// </summary>
public static class BattleGridSyncTool
{
    private const string AuthoringScenePath = "Assets/Scenes/ArenaAuthoring.unity";

    [MenuItem("Clawbada/Sync Battle Grid From ArenaAuthoring")]
    public static void Sync()
    {
        var battleScene = EditorSceneManager.GetActiveScene();
        if (battleScene.path == AuthoringScenePath)
        {
            Debug.LogError("[BattleGridSync] Open BattleScene first — this tool copies INTO the active scene.");
            return;
        }

        var battleHexGrid = Object.FindAnyObjectByType<HexGrid>();
        if (battleHexGrid == null || battleHexGrid.unityGrid == null || battleHexGrid.boardTilemap == null)
        {
            Debug.LogError("[BattleGridSync] Active scene has no wired HexGrid (unityGrid/boardTilemap).");
            return;
        }

        var authoring = EditorSceneManager.OpenScene(AuthoringScenePath, OpenSceneMode.Additive);
        try
        {
            Grid srcGrid = null;
            Tilemap srcTilemap = null;
            foreach (var root in authoring.GetRootGameObjects())
            {
                if (srcGrid == null) srcGrid = root.GetComponentInChildren<Grid>(true);
            }
            if (srcGrid != null) srcTilemap = srcGrid.GetComponentInChildren<Tilemap>(true);

            if (srcGrid == null || srcTilemap == null)
            {
                Debug.LogError("[BattleGridSync] ArenaAuthoring has no Grid/Tilemap to copy from.");
                return;
            }

            var dstGrid = battleHexGrid.unityGrid;
            var dstTilemap = battleHexGrid.boardTilemap;

            dstGrid.cellLayout = srcGrid.cellLayout;
            dstGrid.cellSwizzle = srcGrid.cellSwizzle;
            dstGrid.cellSize = srcGrid.cellSize;
            dstGrid.cellGap = srcGrid.cellGap;
            // World placement: replicate the authoring hierarchy's local offsets under a
            // zeroed parent (both scenes share the same camera setup).
            battleHexGrid.transform.position = Vector3.zero;
            var srcGridLocal = srcGrid.transform.localPosition;
            dstGrid.transform.localPosition = new Vector3(srcGridLocal.x, srcGridLocal.y, 0f);
            var srcTmLocal = srcTilemap.transform.localPosition;
            dstTilemap.transform.localPosition = new Vector3(srcTmLocal.x, srcTmLocal.y, 0f);
            dstTilemap.tileAnchor = srcTilemap.tileAnchor;

            EditorUtility.SetDirty(dstGrid);
            EditorUtility.SetDirty(dstGrid.transform);
            EditorUtility.SetDirty(dstTilemap.transform);
            EditorUtility.SetDirty(dstTilemap);
            EditorSceneManager.MarkSceneDirty(battleScene);

            Debug.Log($"[BattleGridSync] Copied from ArenaAuthoring: cellSize={srcGrid.cellSize}, " +
                      $"gridLocal={srcGridLocal}, tilemapLocal={srcTmLocal}, anchor={srcTilemap.tileAnchor}. " +
                      "Save the scene to persist.");
        }
        finally
        {
            EditorSceneManager.CloseScene(authoring, true);
        }
    }
}
