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

Add `BOT_THINK_MS=300 BATTLE_SHOT_CLOCK_MS=20000` to the API for faster automated runs — but
**never hand that stack to a human tester**: a 20 s clock is 3× the pressure of production's 60 s
and reads as a bug.

## Probes

| Probe | What it proves | Knobs |
|---|---|---|
| `specials.ts` | a class's Special casts, is accepted, animates, raises no exception; frame bursts per class | `TRIO=<Class>` `PRESET_ID` `PRESET_LABEL` `DPR` |
| `sfx-probe.ts` | attack / cast / impact sound counts reconcile with turn actions; arena bed start, `<audio>` state, log order | `TRIO` `PRESET` `QUICK=1` |
| `audio-prefs-probe.ts` → `audio-prefs-probe-2.ts` | Music/SFX toggles live, then persisted into a **fresh Chrome** via `out/audio-prefs.json` | run 1, restart Chrome, run 2 |
| `overlap-probe.ts` | Fortify cast cadence vs the 6.8 s dome; watchdog firings; overlapping domes | `SPEED` `TAG` |
| `turncap-probe.ts` | all-Bulwark battle to the 100-turn cap, banner frames | — |
| `snap-probe.ts` | pixel-perfect: canvas css/backing size, Unity camera mode, ortho, px/unit | `DPR` `W` `H` |
| `autoplay.ts` | `?auto=1&speed=N` review tools advance the battle with no clicks | `TRIO` `SPEED` |
| `gridvis.ts` | hex grid hidden at rest, shown only when the player can act | — |
| `forfeit.ts` | options menu → forfeit → `battle_ended` | — |
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
- **`timeout` does not exist on macOS** (`gtimeout`); `bun cdp.ts` scripts run to completion.
- **Local practice-create can fail** with `TEAM_MANAGER_ADDRESS is not set` on the dev API — an
  env gap, not the probe; the next attempt usually lands.
