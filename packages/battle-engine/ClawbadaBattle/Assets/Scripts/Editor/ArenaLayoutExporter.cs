using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// Writes an ArenaAuthoringTool's current layout to a JSON file under Assets/ArenaLayouts/.
/// The JSON format matches the ArenaLayout struct consumed by HexGrid.BuildGrid at runtime.
/// </summary>
public static class ArenaLayoutExporter
{
    private const string ExportDir = "Assets/ArenaLayouts";

    public static void ExportToJson(ArenaAuthoringTool tool)
    {
        if (tool == null) return;

        if (!Directory.Exists(ExportDir))
            Directory.CreateDirectory(ExportDir);

        var layout = tool.ToArenaLayout();
        string json = JsonUtility.ToJson(layout, prettyPrint: true);
        string fileName = $"{tool.layoutId}.json";
        string path = Path.Combine(ExportDir, fileName);

        File.WriteAllText(path, json);
        AssetDatabase.Refresh();

        Debug.Log($"[ArenaLayoutExporter] Exported '{tool.layoutId}' → {path}");
        EditorGUIUtility.PingObject(AssetDatabase.LoadAssetAtPath<Object>(path));
    }
}
