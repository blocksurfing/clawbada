using UnityEditor;
using UnityEngine;

/// <summary>
/// Import invariants for the project's fonts: the pixel face used for floating combat numbers
/// (Assets/Resources/UI/Fonts/, loaded by name at runtime) and the faces a scene references by
/// guid (Assets/Fonts/ — not under Resources, so nothing ships until a shipped scene uses it; see
/// Assets/Fonts/README.md). Hinted raster rendering keeps a bitmap-style font on its grid instead
/// of anti-aliasing it into mush; dynamic texture case so any glyph the numbers need exists.
/// Same pattern as ArtImportRules / AudioImportRules.
/// </summary>
public class FontImportRules : AssetPostprocessor
{
    private static readonly string[] FontRoots = { "Assets/Resources/UI/Fonts/", "Assets/Fonts/" };

    void OnPreprocessAsset()
    {
        bool underFontRoot = false;
        foreach (var root in FontRoots)
        {
            if (assetPath.StartsWith(root, System.StringComparison.OrdinalIgnoreCase)) { underFontRoot = true; break; }
        }
        if (!underFontRoot) return;
        if (assetImporter is not TrueTypeFontImporter importer) return;
        importer.fontRenderingMode = FontRenderingMode.HintedRaster;
        importer.fontTextureCase = FontTextureCase.Dynamic;
        importer.fontSize = 16;
    }
}
