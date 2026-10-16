# Clawbada Shell — developer handoff

> Historical Shell baseline below: `3295433`. The subsequent Marketplace/typography checkpoint
> adds local demo filters, sorting, eight-item pagination, tier sheets/eggs and artwork-backed
> Buy/Bid buttons (no transactions). Read the current README and PIXEL_COMPONENTS.md for those
> components and optional automatic artist-sheet syncing.
>
> Pre-push verification for that checkpoint: 11 Node tests passed; production build passed;
> npm audit reported zero vulnerabilities; 17 of 18 browser scripts passed. The remaining
> `shell-room.py` failure is the same 390×844 Battle/stage hit-target overlap reproduced in
> isolated baseline `3295433`. The new slot-label overflow was fixed without changing stage or
> Battle placement. Independent review found no new blocking issues. These are local results,
> not a claim that remote CI or production integration is complete.

## 1. Baseline and scope

- Repository: https://github.com/blocksurfing/clawbada
- Branch: `design/website`
- Reviewed/pushed implementation baseline: `32954331f995aa13fc69796dd3c94484e10d287b` (`3295433`). This document is a subsequent documentation addition, not part of that commit.
- Source: `design/website/workbench/`.
- This is a **Vite/vanilla-JS design prototype**, not a production frontend or a completed game integration.
- Scope delivered: shared pixel navigation/HUD, fullscreen Shell room, sample lineup selection, ambient animation, Battle setup modal, Queue/Active/History overlays, static Mining cards.
- No live matchmaking, wallet connection, inventory, game transactions or server-backed account persistence has been implemented here. Other parts of the repository may have services; this handoff does not assess their readiness.

## 2. Start from a fresh clone

Use the complete repository, not a copy of the workbench folder: asset URLs also point into `design/website/site`, `design/website/brand` and repository Unity art directories.

```sh
git clone --branch design/website https://github.com/blocksurfing/clawbada.git
cd clawbada
git lfs install
git lfs pull
cd design/website/workbench
npm ci
npm run dev
```

Prerequisites: repository access, Git LFS, Node 22.12+ and npm. Open `http://localhost:4275/#/dashboard` in current Chromium/Brave. Port 4275 is strict. The dev server binds to all interfaces for WSL access; do not expose it publicly. Do not use `file://`.

```sh
npm test
npm run build
npm run preview
```

Preview: `http://localhost:4276/#/dashboard`. `dist/` and `node_modules/` are ignored, not source deliverables. No deployment was performed as part of this handoff.

## 3. Approved interaction contract — preserve during integration

### Shell / lineup

- `#/dashboard` is the fullscreen basecamp: no page header, outer gutter or page scrolling.
- Three stages use local sample class selections. Click a stage to choose, replace or clear a character.
- Selecting at least **one** character enables Battle. Three characters are not required by this prototype; final eligibility must come from actual game rules.
- Character selection survives record-overlay toggles and opening/closing Battle because those actions do not remount Shell.
- Do **not** assume persistence across refresh or navigating away and remounting the page. Current choices are component-local demo state, not inventory records or NFT IDs.

### Queue / Active / History

- These are three right-side toggle buttons; **there is no Arena button**.
- Initial state: all overlays closed.
- Click a button: its panel slides in from the right. Click the same button again: it slides out and closes.
- Click a different button: switch panels; only one is logically active (outgoing/incoming animation may overlap during transition).
- Panels overlay the existing room. Do not hide, displace or reset stages, characters, lighting or Battle underneath.
- Closing panels become inert immediately; after the exit animation they are hidden. Closed panels must not intercept clicks or keyboard focus.
- Escape closes the active panel and restores focus to its opener. Arrow Up/Down and Home/End move focus between buttons; native button activation toggles them.
- Slide uses 220 ms motion; reduced-motion preference removes its duration. Preserve cancellation/cleanup during rapid toggles and navigation.
- Current panels report unavailable/not-connected state, not live queues or match records.

### Battle

- The artwork button opens a modal without leaving Shell or resetting its lineup.
- Hover: move up 2 CSS px. Press: move down 2 CSS px with the pressed artwork; no scale effect or added hover outline.
- Modal focuses on arena choice. Arena options are preview settings, not validated availability/eligibility.
- **Find Match is disabled** with a not-connected explanation. Do not add fake matching, opponents, countdowns or results to make the demo look live.
- No Practice/Queue/Active/History tabs inside this modal. Queue/Active/History belong to Shell overlays.
- Practice is intended for Dojo, not duplicated here. **Dojo is currently an empty design canvas in this workbench**, not an implemented playable practice mode.
- No Battle sidebar item. Legacy `#/battle` opens the setup modal; a fresh visit resolves the underlying page to Shell.

### Navigation / local demos

- Sidebar starts compact after refresh and keeps its expand/collapse animation and full-pole hit target.
- Shared HUD/sidebar remain mounted while page content changes.
- Wallet/profile/music controls are local design demos; do not present them as connected production features.
- Mining contains four static cards. Other unimplemented destinations are design canvases, not completed screens.

## 4. Visual and asset constraints

- Preserve artist composition and existing source files. Do not overwrite `.aseprite` originals when exporting.
- Shell source room is 640×360. Use proportional cover, centered horizontally and bottom-aligned; **not integer-cover zoom**. The flat background is CSS `#2b8db9`, not another exported background layer.
- Room order: background color → shark → Background Rock 2 → Background Rock → Coral → Back Sand → Shell → Sand → Foreground Rock. Seaweed and bubbles remain behind the foreground rock.
- Keep crisp/pixelated rendering without sacrificing approved composition. Shared pixel UI uses the global 3× scale; room cover is intentionally a separate scaling rule.
- Upheaval uses regular weight (`400`) with no synthetic bold. Preserve existing text colors and font treatments rather than introducing a new design system.
- Stage source region: `[242, 206, 144, 72]`; registry metadata and CSS must stay consistent. Preserve transparent-area click-through and source-art hitbox geometry.
- Selection lighting sits behind stage/character art and uses Overlay blending. Source PNG already contains its intended alpha; do not fade the PNG again.
- Shark: horizontal one-way passes, randomized starting side/height within the approved upper band, behind room artwork. Current sprite loop 1.2 s and travel 24–36 s; do not turn it into vertical wandering.
- Bubbles: sequential, vertically spaced right-side stream, gentle curved upward travel, no synchronized fan/burst and no pile-up at the endpoint. Small/Medium use separate original animation sheets, not CSS resizing of one variant. Clicking an exposed bubble plays its Out frames and removes it.
- `assets/apex-class-sheet.png` is now repository-local; do not restore the old reference to an external `base/Apex` directory.
- Read `PIXEL_COMPONENTS.md` for source registration, nine-slice/pixel rendering and artist workflow. Saving `.aseprite` alone does not update exported PNGs.
- Bubble export helper used during authoring was outside the repo. The committed PNG sheets are available, but there is no committed reproducible bubble-export script yet.

## 5. Code map and lifecycle

| Area | Entry points | Notes |
| --- | --- | --- |
| Routing and composition | `main.js`, `routes.js` | Mounts page content, disposes page helpers, handles legacy Battle URL and shared shell |
| Shared navigation/HUD | `components/shell.js`, `sidebar.html`, `user-section.html`, `styles/shared.css` | Existing larger module; not broadly refactored in this checkpoint |
| Shell markup/layout | `pages/dashboard.html`, `styles/pages/dashboard.css` | Room, stages, controls, record panels |
| Local lineup | `components/battle-lobby.js` | Sample class array; local choices; picker; Battle enabled state |
| Art and selection transitions | `components/shell-art.js` | Cover sizing, stage scale, lighting, ambient mounts |
| Ambient animations | `components/shell-shark.js`, `components/shell-bubbles.js` | Animation loops, reduced-motion handling and disposal |
| Record overlay toggles | `components/shell-tabs.js` | `aria-expanded`, inert/hidden state, slide animations, keyboard handling |
| Battle modal | `components/battle-modal.js`, `pages/battle.html`, `styles/battle-modal.css`, `styles/pages/battle.css` | Modal lifecycle and unavailable matchmaking state |
| Assets / pixel rendering | `pixel-assets.js`, `components/pixel/`, `tools/pixel-source-watch.js` | Source metadata, canvas rendering, validation/watch |
| Tooling | `package.json`, `vite.config.js`, `tests/` | Vite, Node tests and standalone Python browser checks |

Lifecycle details worth retaining:

- Page helpers return disposers. `main.js` disposes tabs, lobby, art and pixel UI before replacing page DOM.
- Lineup selection dispatches a cancelable, bubbling `shell-selection` event with `{ name, commit }`. The art layer coordinates animation before committing the selection. Bypassing this path may desynchronize lighting and sprites.
- Stage lighting is reparented into `.shell-room`; it is not solely a child of the lineup container.
- Cancel animations, listeners, observers and scheduled work on disposal. Do not remount pixel canvases twice or accumulate listeners after route/HMR changes.

## 6. Verification at the implementation checkpoint

These are executed results for baseline `3295433`, not a claim of future CI or production readiness:

- `npm test`: **3 passed, 0 failed** (routes, pixel geometry, source watcher).
- `npm run build`: **passed**, 51 modules transformed.
- `npm audit`: **0 reported vulnerabilities** at the time of the check.
- Browser suite: **10 of 11 scripts passed**. It is **not fully green**.
- `git diff --check`: clean. Added-source secret scan found no matches; this is not a security certification.
- Parent independently verified modal/overlay flow at 1920×1080, 1366×768, 390×844 and 844×390, plus legacy Battle URL. Broader hit-target testing exposed the remaining overlap below.
- Git push and LFS upload succeeded; remote HEAD matched the baseline hash. These tests are DOM/interaction checks, not a new visual sign-off.

### Run browser checks

Keep dev server running on 4275. Use Python 3.11+, uv and Playwright Chromium:

```sh
uv run --with playwright python -m playwright install chromium
# If Linux browser libraries are missing:
# uv run --with playwright python -m playwright install --with-deps chromium

uv run --with playwright python tests/battle-modal.py
uv run --with playwright python tests/shell-room.py

# Bash/WSL: full suite, stopping on failure
for test in tests/*.py; do
  uv run --with playwright python "$test" || exit 1
done
```

`npm test` does **not** run these browser scripts. Most scripts hardcode localhost/127.0.0.1:4275. See README for details.

## 7. Open issues and follow-up priorities

### P1 — narrow-screen Battle/stage overlap (confirmed, not fixed)

- Reproduce: open Shell at 390×844 or 375×667 with empty lineup; Battle artwork/button covers stage 2–3 centers. At 844×390, stage 3 is affected.
- Detection: `tests/shell-room.py`, center-point hit-target assertion (line 31 at baseline). `elementFromPoint` returns `.shell-battle` instead of the stage.
- Impact: some stage click targets are obstructed, including when Battle is disabled.
- The cleanup intentionally preserved layout and kept the failing assertion. **Do not weaken/remove this assertion to report a green build.**
- Next step: agree a narrow-screen layout with Nzib, implement it separately, verify all three stage targets plus Battle and overlay controls across the affected sizes and desktop.

### Other known boundaries

- Short viewports can clip the sidebar because its no-scroll behavior is intentional in the current design. Fixed-width profile HUD still needs a narrow-screen design pass.
- No live game integration or complete error/loading/reconnect states.
- No committed bubble-export automation.
- Cleanup was bounded: portability, metadata, whitespace, docs and stale tests. It did not split the large shared-shell module or claim production architecture is finished.

## 8. Suggested integration sequence — proposal, not implemented

1. Resolve and approve the narrow-screen overlap before calling the UI fully verified.
2. Identify actual production entry points and service contracts with the game/backend dev. Decide whether to port these components or adapt them in place; do not assume this prototype is the deployment target.
3. Replace sample class selections with real inventory IDs and authoritative eligibility, keeping selection/animation UI separate from transport and game rules.
4. Define real queue/match states, cancellation, reconnect and failure handling. Feed Queue/Active/History from service data; distinguish unavailable, loading, empty and error states.
5. Wire arena eligibility and matchmaking only after an actual service is available. Enable Find Match based on real readiness; countdown timing must reflect authoritative state, not a fake client-only timer.
6. Keep Practice scoped to Dojo and plan that implementation separately.
7. Re-run Node, build and full browser checks after each integration step. Obtain artist approval for visual/layout changes.

### Acceptance checklist for the next dev

- [ ] Fresh clone + LFS + `npm ci` runs without external local-file dependencies.
- [ ] Approved fullscreen composition, fonts, sprites and layering preserved.
- [ ] All three stages accessible at agreed desktop/mobile sizes; Battle does not block required targets.
- [ ] Queue/Active/History toggle and slide correctly; underlying Shell remains present and lineup intact.
- [ ] Keyboard/Escape/focus, rapid toggling, reduced motion and route cleanup still work.
- [ ] Battle modal preserves selection; no duplicated Practice or record tabs.
- [ ] Live functionality is accurately labeled; no fake matches, wallet connection or invented records.
- [ ] Full test suite passes, or remaining failures are explicitly documented and accepted—not suppressed.

Design/visual approval: **Nzib**. Backend contracts, production eligibility and deployment decisions remain to be agreed with the responsible dev.
