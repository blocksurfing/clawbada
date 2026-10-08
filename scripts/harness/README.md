# Browser playtest harness

Drives the web app in a **headless Chrome** through raw CDP — no Puppeteer, no wallet
extension — to reproduce battle UI bugs and to verify engine changes by *counting* what
happened rather than eyeballing it. Every fix that touches Unity playback, audio, the HUD or the
canvas gets a probe here before it ships.

```
scripts/harness/
  cdp.ts              the driver: goto / eval / clickAt / screenshot / waitFor / logs
  chrome-restart.sh   fresh headless Chrome on :9222 — run before EVERY probe
  *.ts                probes; each is `export default async (b: Browser) => { … }`
  out/                screenshots + handoff files (gitignored)
```

## Running one

```bash
# 1. local stack (dev burner wallet + practice presets are required; prod never has them)
cd apps/api && BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
  DATABASE_URL=postgresql://clawbada:clawbada@127.0.0.1:5432/clawbada \
  MATCHMAKER_ADDRESS=0x000000000000000000000000000000000000dEaD CHAIN_ENV=testnet \
  PRACTICE_PRESETS=true bun run dev
cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:3001 NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001/ws \
  NEXT_PUBLIC_PRACTICE_PRESETS=true NEXT_PUBLIC_DEV_BURNER=true bun next dev -p 3000 -H 127.0.0.1

# 2. warm the battle page (Next compiles it on first hit, ~20–50 s — probes time out on a cold server)
curl -s -o /dev/null http://127.0.0.1:3000/game/battle?preset=trio_tempest

# 3. a probe
cd scripts/harness
bash chrome-restart.sh && TRIO=Tempest bun cdp.ts specials.ts
```

Add `BOT_THINK_MS=300` to the API for faster automated runs, and keep the shot clock at the
production **60 s** (`BATTLE_SHOT_CLOCK_MS=60000`, or leave it unset). A 20 s clock used to be
suggested here, but `specials.ts` at `SPEED=0.5` with frame bursts can outrun it: the server
auto-plays the turn (`battle_turns.submitted_by = 'timeout'`) and the harness's next taps are
rightly ignored — which looked exactly like a lost tap (2026-09-26). If a "tap did nothing"
failure shows up, check that column for the turn first.

## Probes

**Battle-start intro (2026-09-28):** a fresh battle plays ~3.5 s of READY / FIGHT first and a click during it SKIPS it — call `waitForIntro(b)` (`intro-wait.ts`) after the HUD binds, before the first click.

**House rules (built into `cdp.ts`, user 2026-09-27):** every probe runs **muted** (music + SFX prefs forced off before each page load) and **forfeits** a still-live battle when it finishes. Audio probes opt out with `export const keepAudio = true` (or `AUDIO=1`); keep a battle alive with `export const keepBattle = true` (or `KEEP=1`).

| Probe | What it proves | Knobs |
|---|---|---|
| `specials.ts` | a class's Special casts, is accepted, animates, raises no exception; frame bursts per class | `TRIO=<Class>` `PRESET_ID` `PRESET_LABEL` `DPR` |
| `ui-feel.ts` | Nzib's HUD: round avatar + button row, then Defend hovered (glow, +2 px) and pressed (darker, −2 px) → `out/ui-feel-<Class>-{idle,hover,press}.png` | `TRIO` |
| `hints-probe.ts` | the hint line under the shot clock; options menu Hints row turns it off and back on (setting persists in PlayerPrefs, left ON) → `out/hints-{on,menu,off}.png` | — |
| `intro-probe.ts` | battle-start intro: frame burst (`out/intro-fNN.jpg`: black → READY → FIGHT → lobsters drop → HUD slides in) and order checks — intro done → `ready` sent → first turn; nothing animated before it | `TRIO` |
| `sfx-probe.ts` | attack / cast / impact sound counts reconcile with turn actions; arena bed start, `<audio>` state, log order | `TRIO` `PRESET` `QUICK=1` |
| `audio-prefs-probe.ts` → `audio-prefs-probe-2.ts` | Music/SFX toggles live, then persisted into a **fresh Chrome** via `out/audio-prefs.json` | run 1, restart Chrome, run 2 |
| `overlap-probe.ts` | Fortify cast cadence vs the 6.8 s dome; watchdog firings; overlapping domes | `SPEED` `TAG` |
| `turncap-probe.ts` | all-Bulwark battle to the 100-turn cap, banner frames | — |
| `snap-probe.ts` | pixel-perfect: canvas css/backing size, Unity camera mode, ortho, px/unit (2026-09-16: its picker step stopped reaching the battle page — fs-probe covers the snap check meanwhile) | `DPR` `W` `H` |
| `fs-probe.ts` | fullscreen enter → exit: the stage returns to the column size (a stale fullscreen canvas is the "third of the arena" report) | `DPR` `VW` `VH` |
| `autoplay.ts` | `?auto=1&speed=N` review tools advance the battle with no clicks | `TRIO` `SPEED` |
| `fish-probe.ts` | Elite angler fish (`AnglerSchool`): seed line, first crossing, lane/side/turn rules, frame bursts | `PRESET` `BASE` `FRAMES` `GAP_MS` |
| `bird-probe.ts` | Evolved gulls (`BirdFlock`): flock arrives, lands on the rocks, leaves one by one; rule checks + frames | `PRESET` `BASE` |
| `cloud-probe.ts` | Evolved drift clouds (`CloudDrift`, 2026-10-07): seed line, 2–3 clouds in view at once, variants/lanes/speed rules, frames 4 s apart so the drift shows → `out/cloud-<tag>-sky-N.png` | `PRESET` `BASE` `FRAMES` `GAP_MS` |
| `jelly-probe.ts` | Elite jellyfish (`JellySchool`, 2026-10-07/08): seed line (floor mask on), first group ≤ 3, starting below the floor plate's edge and rising into view from behind it, members spaced in a line, one heading, first exit → `out/jelly-<tag>-{emerge,rise,after}-N.png` | `PRESET` `BASE` `FRAMES` `GAP_MS` |
| `diag-bind.ts` | Diagnostic when a probe says "HUD never bound": starts a practice battle and dumps whether `/battle/p_…` was reached, the canvas, the Unity script tags and every non-HUD console line (2026-10-07: it showed the login route 500-ing, not Unity) | `PRESET` `BASE` `WAIT_MS` |
| `chrome-probe.ts` | Nzib's website chrome (2026-10-08) on `/game` at desktop width: startup roll + plank open, 12 items, Mining → route + ribbon, pole/logo close + reopen, avatar retract/spin locked mid-motion, burner connect → short address, profile actions (hover expands on the 3 px grid), Profile → name saved via `PATCH /api/agent/profile`, music toggle, Disconnect → `out/chrome-*.png` | `BASE` `API` `NAME` `TAG` |
| `storm-probe.ts` | The Maelstrom reaction (2026-10-07/08): three Tempests on the Evolved arena in autoplay; every storm gets `[StormReaction] storm start`/`end` (sea ×3 + chop) and, with a flock on the rocks, `[BirdFlock] panic: N gulls flee on Foreground/270` (above the storm's runtime wrap) in front of the storm clouds, then the next flock back within ~25 s of the storm clearing → `out/storm-{sea,panic}-N.png` | `PRESET` `BASE` `MAX_STORMS` `WATCH_MS` `SPEED` |
| `gridvis.ts` | hex grid hidden at rest, shown only when the player can act | — |
| `forfeit.ts` | options menu → forfeit → `battle_ended` | — |
| `stunprobe.ts` | Kraken Bind as a stun hold: tentacles Spawn on the hit → Idle loop while the victim is stunned (through its skipped turn) → Out when the stun ends; victim's rig frozen meanwhile; follows one victim by id; frames in `out/stun-*.png` | `PRESET` `SPEED` |
| `movedefend.ts` | the reported freeze: click a move hex, let the preview walk, press Defend in the Unity bar — the turn goes out and resolves; `OFFLINE_TURN=n` closes the socket for real before the press on own turn *n* and checks the press is queued, "Sending…" shows in the canvas, and it is sent on reconnect | `PRESET` `TURNS` `OFFLINE_TURN` |
| `autoclose.ts` | after the result banner the view closes itself: countdown under the result, Unity quit, music faded, back on `/game/battle`; `STAY=1` checks the `?stay=1` opt-out | `PRESET` `SPEED` `STAY` |
| `movecheck.ts` | measured seconds per hex hop | — |
| `timing.ts` / `reconnect-probe.ts` | full battle to the banner; reconnect keeps the active-turn ring honest | — |
| `arena-shot.ts` / `dpr-probe.ts` / `resize-probe.ts` / `fs-probe.ts` / `layout-probe.ts` | screenshots and geometry dumps for layout work | — |
| `smoke-cdp.ts` | the driver itself works | — |

## Lessons that cost hours — read before writing a probe

- **`--window-size=1600,1000` is mandatory** in `chrome-restart.sh`. Headless defaults to 756 px
  wide, below the `md` breakpoint: the dev burner button sits in a `display:none` container, every
  click misses, and the run dies at "preset picker shows …".
- **Restart Chrome before every run.** Headless Chrome leaks WebGL contexts; the second Unity
  instance in the same Chrome fails with `GLctx`.
- **Copy the init-retry block** from `specials.ts`: wait for `[BattleHud] bind` (and
  `options gear=` if you need the menu), treat `GLctx` as a crash, reload the same battle page up
  to 3×. Without it Unity-side checks fail randomly while React-side ones pass, and you chase ghosts.
- **`scrollIntoView` the canvas before clicking** — clicks off-screen silently miss.
- **Never load `/` before the battle page** to seed `localStorage`; the extra page burns the WebGL
  context. Seed on the picker page (`audio-prefs-probe-2.ts`).
- **A same-tab reload after a battle never re-binds Unity.** Test persistence in a fresh Chrome via
  a handoff file in `out/`.
- **Warm the battle page after every Unity build**: dropping a new bundle into `apps/web/public`
  invalidates Next's dev cache, and a probe against the recompiling server reports zero turns.
- **Server bots don't wait for the client.** In mono-Bulwark battles the client falls minutes
  behind (6 s hold per cast vs ~1 s/turn). Use `speed=1` when a probe has long windows — at
  `speed=3` an auto battle ends in ~45 s and "no SFX plays" is then meaningless; assert turns
  advanced inside the window.
- **Any client timer that waits on Unity must be divided by the playback speed.** The 12 s
  animation watchdog wasn't, and slow review playback stacked Fortify domes.
- **The hex-pitch ruler lies by 10%.** Unity's hexagon layout spaces columns ~1.10 world units, not
  1.0. For zoom, read `[BattleHud] camera mode … ortho= px/unit=` from the camera itself.
- **Probe output only shows what the probe prints.** Unity logs are in `b.logs`; grep them
  explicitly, or a real signal (`[BattleSfx]`, `[ArenaMusic]`) is invisible.
- **The battle page leaves on its own ~6 s after the result banner** (back to `/game/battle`,
  Unity quit). A probe that reads the page after the result must do so inside that window, or
  open the battle with `&stay=1` — the picker carries it through like `auto` and `speed`.
- **DevTools "offline" does not close an open WebSocket.** To test a drop, keep handles on the
  page's sockets (`Page.addScriptToEvaluateOnNewDocument` wrapping `window.WebSocket`, see
  `movedefend.ts`) and `close()` them.
- **`timeout` does not exist on macOS** (`gtimeout`); `bun cdp.ts` scripts run to completion.
- **Local practice-create can fail** with `TEAM_MANAGER_ADDRESS is not set` on the dev API — an
  env gap, not the probe; the next attempt usually lands.
