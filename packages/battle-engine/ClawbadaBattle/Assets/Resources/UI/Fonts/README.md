# Pixel font

`Silkscreen-Regular.ttf` — Jason Kottke's Silkscreen, SIL Open Font License 1.1 (`Silkscreen-OFL.txt`).
The same face the web app uses for pixel headings, so in-canvas numbers rhyme with the site.

Loaded at runtime by `HudSkin.PixelFontOrDefault()` (`Resources.Load<Font>("UI/Fonts/Silkscreen-Regular")`)
for floating combat numbers only; the rest of the HUD keeps `HudSkin.font`. Import settings are
enforced by `Scripts/Editor/FontImportRules.cs` (hinted raster, dynamic) so the pixels stay crisp.
Silkscreen is drawn on an 8 px grid — use sizes 16 / 24 / 32, never 18 or 22.
