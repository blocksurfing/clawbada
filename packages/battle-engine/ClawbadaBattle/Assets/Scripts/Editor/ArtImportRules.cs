using UnityEditor;
using UnityEngine;

/// <summary>
/// Locks the pixel-art import invariants for everything under Assets/Art/ so a
/// designer drop can't regress them. (The May 2026 obstacle batch shipped at Unity's
/// defaults — Default texture, PPU 100, bilinear, compressed — and could not be placed
/// on the board at all.) Runs on every (re)import; per-sprite choices such as pivot,
/// mesh type and single/multiple mode are left to the designer.
/// </summary>
public class ArtImportRules : AssetPostprocessor
{
    private const string ArtRoot = "Assets/Art/";
    private const float PixelsPerUnit = 64f; // 640x360 arena art fills the 10x5.625-unit camera exactly

    void OnPreprocessTexture()
    {
        if (!assetPath.StartsWith(ArtRoot, System.StringComparison.OrdinalIgnoreCase)) return;
        if (assetImporter is not TextureImporter importer) return;

        importer.textureType = TextureImporterType.Sprite;
        if (importer.spriteImportMode == SpriteImportMode.None)
            importer.spriteImportMode = SpriteImportMode.Single;
        importer.spritePixelsPerUnit = PixelsPerUnit;
        importer.filterMode = FilterMode.Point;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.mipmapEnabled = false;
    }
}
