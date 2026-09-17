using UnityEditor;
using UnityEngine;

/// <summary>
/// Import invariants for fonts under Assets/Resources/UI/Fonts/ — the pixel face used for
/// floating combat numbers. Hinted raster rendering keeps a bitmap-style font on its grid
/// instead of anti-aliasing it into mush; dynamic texture case so any glyph the numbers need
/// exists. Same pattern as ArtImportRules / AudioImportRules.
/// </summary>
public class FontImportRules : AssetPostprocessor
{
    private const string FontRoot = "Assets/Resources/UI/Fonts/";

    void OnPreprocessAsset()
    {
        if (!assetPath.StartsWith(FontRoot, System.StringComparison.OrdinalIgnoreCase)) return;
        if (assetImporter is not TrueTypeFontImporter importer) return;
        importer.fontRenderingMode = FontRenderingMode.HintedRaster;
        importer.fontTextureCase = FontTextureCase.Dynamic;
        importer.fontSize = 16;
    }
}
