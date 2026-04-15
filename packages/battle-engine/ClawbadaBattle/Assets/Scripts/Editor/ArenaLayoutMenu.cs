using UnityEngine;
using UnityEditor;

/// <summary>
/// Top-level menu items for working with arena layouts. Lets the designer export or
/// inspect the current scene's ArenaAuthoringTool without having to select the
/// component first.
/// </summary>
public static class ArenaLayoutMenu
{
    [MenuItem("Clawbada/Arena Layout/Export Current Scene to JSON")]
    public static void ExportCurrentScene()
    {
        var tool = Object.FindFirstObjectByType<ArenaAuthoringTool>();
        if (tool == null)
        {
            EditorUtility.DisplayDialog(
                "No Authoring Tool Found",
                "The current scene has no ArenaAuthoringTool component.\n\n" +
                "Add the ArenaAuthoringTool component to a GameObject, wire up the " +
                "Tilemap + semantic tiles, and try again.",
                "OK");
            return;
        }

        tool.ImportFromTilemap();
        var issues = tool.Validate();
        if (issues.Count > 0)
        {
            string msg = "Layout has issues:\n\n• " + string.Join("\n• ", issues) +
                         "\n\nExport anyway?";
            if (!EditorUtility.DisplayDialog("Validation Warnings", msg, "Export Anyway", "Cancel"))
                return;
        }

        ArenaLayoutExporter.ExportToJson(tool);
    }

    [MenuItem("Clawbada/Arena Layout/Log Current Layout JSON")]
    public static void LogCurrentLayout()
    {
        var tool = Object.FindFirstObjectByType<ArenaAuthoringTool>();
        if (tool == null)
        {
            Debug.LogWarning("[ArenaLayoutMenu] No ArenaAuthoringTool in the current scene.");
            return;
        }

        tool.ImportFromTilemap();
        var layout = tool.ToArenaLayout();
        Debug.Log($"[ArenaLayoutMenu] {tool.layoutId}:\n{JsonUtility.ToJson(layout, prettyPrint: true)}");
    }
}
