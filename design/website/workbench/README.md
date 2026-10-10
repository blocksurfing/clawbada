# Clawbada design workbench

Local multipage **design prototype**, not the production app. No backend, real wallet,
account persistence or game integration. Wallet/profile/music controls are local demos.

## Run

From `design/website/workbench`, with Node 22.12+ and npm:

```sh
npm ci
npm run dev
```

Open http://localhost:4275/#/dashboard in a current Chromium browser (Brave is supported).
Keep the terminal running. Use sidebar navigation; page URLs support reload, direct links,
Back and Forward. Port 4275 is strict: stop the conflicting server or use the existing workbench
server rather than assuming Vite will choose another port.

The development server binds on all interfaces for WSL-to-Windows access; do not expose it publicly.
Mounted-drive polling is enabled. CSS updates live; HTML/JS changes reload the page,
resetting temporary demo state. Don't open `index.html` with `file://`.

## Current UI

- **Shell** (`#/dashboard`) is the full-viewport basecamp, with layered room artwork,
  ambient animation and three local sample-character slots. It has no page header or scrolling.
- **Queue / Active / History** independently toggle the selected overlay open/closed with a slide;
  switching buttons switches panels. The basecamp and lineup remain visible behind them.
  There is no Arena button. These panels explicitly show that no live service is connected.
- **Battle** is enabled after choosing a character and opens a setup modal without leaving Shell.
  The arena selector is a mock setting; Find Match remains disabled. There is no practice mode
  or Battle sidebar item. The legacy `#/battle` URL opens the modal (on Shell for a fresh load).
- **Mining** has four static tier/reward cards. **Dojo** and the remaining sidebar destinations
  are empty design canvases with page headers.
- The shared navigation/profile shell stays mounted across page changes. Compact navigation
  keeps all 11 destinations as icons; the full pole is the collapse/expand hit target.

## Edit

- `pages/dashboard.html` and `styles/pages/dashboard.css`: Shell markup and scoped styling.
- `pages/mining.html` and `styles/pages/mining.css`: static Mining design.
- `pages/battle.html`, `styles/pages/battle.css`, `styles/battle-modal.css`: Battle modal content/styles.
- `components/battle-lobby.js`: local lineup picker; `components/battle-modal.js`: setup modal.
- `components/shell-tabs.js`: Queue/Active/History overlays; `components/shell-art.js`: room/stage animation.
- `components/sidebar.html`, `components/user-section.html`, `components/shell.js`: shared HUD and interactions.
- `styles/shared.css`: shared HUD, fonts and 3× pixel settings.
- `styles/placeholders.css`: non-Shell page layout and placeholder scaffolding, not final UI.
- `routes.js`: route labels/fallback; `main.js`: page mounting and legacy Battle URL handling.

See `PIXEL_COMPONENTS.md` before registering artwork or using sprites, panels, buttons and grids.
Most artwork/fonts are referenced directly from `../site`, `../brand` and the repository's Unity
art folders. Keep the repository layout intact: the workbench folder alone is not a standalone
source bundle. `assets/apex-class-sheet.png` is an unchanged copy of the supplied Apex sheet,
so character rendering no longer depends on a `base/Apex` folder outside the repository.
Local bubble sheets also live in `assets/`. Vite bundles referenced assets into `dist/`.

## Verify / build

```sh
npm test
npm run build
npm run preview
```

`npm test` runs the Node route, pixel geometry and source-watcher tests; it does **not** run browser tests.
Preview: http://localhost:4276/#/dashboard (loopback only). `dist/` is local output, not deployed.

### Browser checks

With Python 3.11+, [uv](https://docs.astral.sh/uv/) and the dev server running on port 4275,
install Playwright's Chromium once, then run the standalone scripts from this directory:

```sh
uv run --with playwright python -m playwright install chromium
# On Linux, if Chromium reports missing system libraries:
# uv run --with playwright python -m playwright install --with-deps chromium

# Single check:
uv run --with playwright python tests/battle-modal.py

# All browser checks (Bash/WSL; stops at the first failure):
for test in tests/*.py; do
  uv run --with playwright python "$test" || exit 1
done
```

These are headless DOM/interaction checks, not screenshot approval. They cover Shell/art bounds,
selection, Battle/record overlays, sidebar animation/keyboard navigation, page transitions,
header alignment, Mining and reduced motion. Most scripts target `localhost:4275` or
`127.0.0.1:4275`; only `sidebar-compact.py` supports `WORKBENCH_URL`.

The original `../mockups/mockups.html` remains a historical standalone reference, not a description
of every current workbench behavior. Shared pixel sprites use 3× scaling; the full room art uses
proportional cover scaling. The sidebar deliberately has no scrolling and can clip in short
viewports. The fixed-width profile HUD still needs a separate narrow-screen design pass.
Do not silently redesign these constraints.

Known browser-check failure: `tests/shell-room.py` currently detects the Battle button covering
stage centers on small screens (stages 2–3 at 390×844 and 375×667; stage 3 at 844×390).
The hit-target assertion is intentionally retained; fixing that overlap requires a separately
approved layout change, not a weaker test.
