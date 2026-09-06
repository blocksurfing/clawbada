# Battle sessions (V3 live turn loop) — operations runbook

**What it is, plainly.** A battle is played turn by turn on the API server. The server decides every outcome, streams each turn to the two players (and any spectators) over WebSocket, enforces the 60-second shot clock, and, for real staked battles, hands the finished result to the engine to settle on-chain. Practice battles against a bot use the same loop with no chain involvement.

Code: `apps/api/src/lib/battle-session/` (manager, session, store, protocol, clock). Engine side: `apps/engine/src/operator/jobs/settle-battle.ts`. Pure rules: `packages/game-logic/src/v3/`.

## Lifecycle

| Kind | Starts when | Ends by | Then |
|---|---|---|---|
| `real` | the indexer mirrors `battles.phase = 4` (both teams revealed) and the API poller (every `BATTLE_SESSION_POLL_MS`, default 2 s) claims the row by inserting `battle_sessions` | wipeout, 100-turn cap, or 3 consecutive shot-clock expiries by one player (forfeit) | API enqueues `operator_jobs` `settle_battle`; engine submits `BattleArena.settle(...)`; indexer mirrors `BattleProposed` → `settling`, `BattleSettled` → `settled` |
| `practice` | `POST /api/game/combat/practice` | same | row → `finished`; nothing else |

Status column on `battle_sessions`: `active` → `finished` (practice) or `settling` → `settled` (real). `abandoned` = the battle was no longer Active on chain when the API resumed after a restart.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `BATTLE_SESSIONS_ENABLED` | `true` | Set `false` to run an API without the loop (e.g. a read-only replica). |
| `BATTLE_SHOT_CLOCK_MS` | `60000` | Per-turn clock. Expiry auto-Defends; 3 in a row = forfeit. |
| `BOT_THINK_MS` | `800` | Practice-bot delay so turns are readable. |
| `BATTLE_SESSION_POLL_MS` | `2000` | Poll period for newly Active real battles. |
| `PRACTICE_ENABLED` | `true` | Practice endpoint on/off. |
| `PRACTICE_PRESETS` | on outside production | Lets dev environments start a practice battle without owning lobsters. |
| `DRAND_CHAIN_URL` | `https://api.drand.sh` | One beacon per real battle = the VRF seed. |

## Single-instance assumption

Sessions live in memory in **one** API process. The `battle_sessions` primary key is the claim, so a second replica cannot start the same real battle, but it also cannot serve its WebSocket turns. Run one API instance with the loop enabled; extra read replicas must set `BATTLE_SESSIONS_ENABLED=false`. Multi-instance fan-out is S2 work (Postgres LISTEN/NOTIFY, X10).

## Restart behaviour

Every turn writes a full state snapshot (`state_json`) plus the turn row. On boot the manager reloads all `active` rows, rebuilds the state, re-verifies real battles are still Active on chain (else `abandoned`), and re-arms the pending human turn with `max(remaining, 5 s)`. Clients reconnect and receive `battle_snapshot`.

## Things that go wrong

**A real battle finished but never settled.**
Check `operator_jobs` for `settle_battle:<battleId>`. `status 3` (dead) with `revert:PhaseTimedOut` means the resolver missed `ACTIVE_WINDOW` (3 h after reveal): anyone can call `handleTimeout(battleId)` and both players are refunded in full. `revert:InvalidSettlementHash` is a bug (zero hash) — file it. Anything else: read `last_error`.

**A battle is stuck `active` with no one acting.**
The shot clock is server-side, so a human turn always resolves within `BATTLE_SHOT_CLOCK_MS`. If nothing moves, the API process is down or the loop is disabled; restart it (sessions resume). Check logs for `battle_session_error`.

**Players report "turn_mismatch".**
Their client is behind: the turn number they submitted is not `state.turn + 1`. They should re-read `GET /:battleId/state` (or wait for `battle_snapshot` on reconnect). Duplicate submissions of an already-applied turn are acknowledged with `duplicate: true`, never replayed.

**Someone disputes a settled battle.**
Evidence lives in `battle_turns` (command, result, `post_state_hash` per turn) and `battle_sessions` (`final_state_hash`, `turn_log_hash`, `roster`, `vrf_round`). `v3.verifyLog(config, log)` re-executes the log and pinpoints the first inconsistent turn; `v3.turnLogHash` must equal the on-chain value.

## Useful SQL

```sql
-- live and finishing sessions
select id, kind, status, turn, deadline, player_a, player_b from battle_sessions where status in ('active','finished','settling') order by updated_at desc;
-- settle jobs
select id, status, attempts, last_error, tx_hash from operator_jobs where job_type = 'settle_battle' order by created_at desc limit 20;
-- one battle's turn log
select turn, lobster_id, submitted_by, command, post_state_hash from battle_turns where session_id = '<id>' order by turn;
```

## Client state sync (2026-09-06)

`turn_resolved` carries `state: ClientBattleState` — the full client-safe post-turn state
(no `vrfSeed`). Clients must replace their local state with it once the turn has been
animated; patching HP/positions alone drifts the bar order, statuses and stun flags, and
every later command then fails `validateTurn` with `not_your_turn`. The web HUD also runs
an 8 s watchdog per animated turn so a Unity coroutine that never reports completion
cannot freeze input, and always renders the SVG tactical map as an input surface next to
the Unity stage.

## In-canvas input (2026-09-06)

With the Unity HUD up, React sends `SetSelection` (armed action, legality, hint) and `PreviewMove` (tentative cell) and receives `onActionSelected` / `onUndoMove` plus the existing hex/lobster clicks. `use-turn-selection` runs in `autoSubmit` mode: a legal target tap, Defend or Wait submits immediately; Special arms (or submits at once when targetless). The React panel and SVG board render only when the WebGL build is unavailable.
