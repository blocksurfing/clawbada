using UnityEngine;
using UnityEditor;

[CustomEditor(typeof(ArenaAuthoringTool))]
public class ArenaAuthoringToolEditor : Editor
{
    public override void OnInspectorGUI()
    {
        var tool = (ArenaAuthoringTool)target;

        DrawDefaultInspector();

        EditorGUILayout.Space(8);
        EditorGUILayout.LabelField("Authoring Actions", EditorStyles.boldLabel);

        if (GUILayout.Button("Import from Tilemap", GUILayout.Height(28)))
        {
            Undo.RecordObject(tool, "Import Arena Layout from Tilemap");
            tool.ImportFromTilemap();
            EditorUtility.SetDirty(tool);
        }

        EditorGUILayout.Space(4);

        GUI.backgroundColor = new Color(0.55f, 0.85f, 0.65f);
        if (GUILayout.Button("Export to JSON", GUILayout.Height(34)))
        {
            tool.ImportFromTilemap();

            var issues = tool.Validate();
            if (issues.Count > 0)
            {
                string msg = "Layout has issues:\n\n• " + string.Join("\n• ", issues) +
                             "\n\nExport anyway?";
                if (!EditorUtility.DisplayDialog("Validation Warnings", msg, "Export Anyway", "Cancel"))
                {
                    GUI.backgroundColor = Color.white;
                    return;
                }
            }

            ArenaLayoutExporter.ExportToJson(tool);
            EditorUtility.SetDirty(tool);
        }
        GUI.backgroundColor = Color.white;

        EditorGUILayout.Space(8);
        EditorGUILayout.HelpBox(
            "Workflow:\n" +
            "1. Assign the source Tilemap and drag in your blocked / Team A / Team B tile sprites.\n" +
            "2. Paint your layout in the Scene view with the Tile Palette.\n" +
            "3. Click 'Import from Tilemap' to preview the parsed data in the lists above.\n" +
            "4. Click 'Export to JSON' when the layout looks right.\n\n" +
            "Exports are written to Assets/ArenaLayouts/<layoutId>.json.",
            MessageType.Info);
    }
}
