# Fonts (not bundled until a shipped scene uses them)

Nzib's loading-screen scene (`Assets/Scenes/LoadingScreen.unity`, drop 282eab6, 2026-10-19) uses two legacy
`UI.Text` faces. They live HERE, not under `Assets/Resources/`, on purpose: **everything under a `Resources/`
folder is packed into every WebGL build whether or not anything references it**, and neither face is used by a
shipped scene yet (`BuildScript` builds `BattleScene` only). Referenced assets travel by guid, so the scene keeps
working from this folder and nothing reaches the player until it should.

| File | Face | Licence |
|---|---|---|
| `Upheaval.ttf` | Upheaval TT (BRK), Brian Kent | Freeware, commercial use allowed; the author asks that `Upheaval-licence.txt` stays with the font. Same file as `apps/web/src/fonts/upheaval/`. |
| `BigShot.ttf` | BIG SHOT Regular, "portmanpreau" (FontStruct, 2021) | **Not confirmed.** FontStruct fonts carry a Creative Commons licence chosen by their author — find the font's page on fontstruct.com, record the licence here, and only then let a shipped scene use it. Same file as `apps/web/src/fonts/big-shot/`, which carries the same note. |

The HUD's own pixel face (`Silkscreen-Regular.ttf`, OFL) stays in `Assets/Resources/UI/Fonts/` because
`HudSkin` loads it by name at runtime. `FontImportRules` applies the same import settings to both folders.
