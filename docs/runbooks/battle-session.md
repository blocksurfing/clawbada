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
| `DRAND_CHAIN_URL` | League of Entropy quicknet (3 s rounds) | The public half of a real battle's seed — see "How a staked battle's randomness is fixed". |
| `BATTLE_SEED_SECRET` | none — **required in production**, identical on API and engine | The secret half. ≥ 32 chars. Guard it like a key: whoever holds it can foresee every roll of every live battle. |

## Single-instance assumption

Sessions live in memory in **one** API process. The `battle_sessions` primary key is the claim, so a second replica cannot start the same real battle, but it also cannot serve its WebSocket turns. Run one API instance with the loop enabled; extra read replicas must set `BATTLE_SESSIONS_ENABLED=false`. Multi-instance fan-out is S2 work (Postgres LISTEN/NOTIFY, X10).

## Restart behaviour

Every turn writes a full state snapshot (`state_json`) plus the turn row. On boot the manager reloads all `active` rows, rebuilds the state, re-verifies real battles are still Active on chain (else `abandoned`), and re-arms the pending human turn with `max(remaining, 5 s)`. Clients reconnect and receive `battle_snapshot`.

## Things that go wrong

**A real battle finished but never settled.**
Why it matters: `settle` must land within `ACTIVE_WINDOW` (3 h after reveal). After that anyone — including the loser — can call `handleTimeout(battleId)` for a full mutual refund, and the winner loses a battle they won.

Two automatic defences (D-28). The API writes the `settling` status and the `settle_battle` job in one transaction, so a finished battle is never left without its job. And the engine's `SettleReconciler` (every `SETTLE_RECONCILE_POLL_MS`, default 30 s) looks at every real session that has been `settling` for more than a minute while its battle is still Active on-chain:

| It finds | It does | Log |
|---|---|---|
| no `settle_battle:<battleId>` job | rebuilds the payload from the session row and enqueues it | `settle_job_recreated` (warn) |
| job dead after exhausted retries (`max_attempts_exceeded:` — the 5 s / 30 s / 5 min / 1 h ladder is only ~65 min of a 3 h window) or a lost tx hash (`tx_hash_persist_failed:`) | back to pending with a fresh ladder | `settle_job_revived` (warn) |
| job dead for a permanent reason (a contract revert) | **nothing — needs a human** | `settle_job_dead_permanent` (error) |
| still unsettled after `SETTLE_RECONCILE_ALARM_MS` (default 20 min) | keeps trying | `settle_overdue` (error, with `secondsLeft`) |
| less than a minute of the window left | stops | `settle_window_missed` (error) |

**Alert on the three error-level messages.** `settle_overdue` fires with more than two and a half hours still on the clock; that is the time to look at the RPC, the resolver key's gas balance and `last_error`.

To re-verify both defences against a real Postgres (throwaway database, chain faked): `bun run scripts/e2e/verify-settle-reconcile.ts`.

By hand: check `operator_jobs` for `settle_battle:<battleId>`. `status 3` (dead) with `revert:PhaseTimedOut` means the window was missed: both players are refunded in full via `handleTimeout(battleId)`. `revert:InvalidSettlementHash` is a bug (zero hash) — file it. Anything else: read `last_error`.

**`rogue_settlement_proposal` fired.**
A result is on-chain that this server did not compute: the RESOLVER key (and with it `BATTLE_SEED_SECRET`, which `settle` must disclose) is compromised, or the engine has a bug. The verdict in the log says which case: `session_still_active` (proposed while the battle was being played), `result_mismatch` (different winner, hashes or damage than ours), `no_session` (proposed before this server ever started the battle).

1. **The clock is `payoutDeadline`** (in the log line). Until then either player can dispute; after it anyone can finalize and the payout cannot be undone. The players have been told (`settlement_alert`, the web warning). If neither has disputed and you can reach them, tell them to.
2. **Stop the bleeding.** From the Safe: `revokeRole(RESOLVER_ROLE, <compromised address>)` on BattleArena, then rotate (`admin-roles.md`). Rotate `BATTLE_SEED_SECRET` with it. Every battle that reaches Active while the key is live is exposed.
3. **Once disputed, resolve it with the true result.** The real battle ran to its end on the API; the honest settle job is dead with `proposal_mismatch`, and its payload IS the true result:
   ```sql
   select payload, last_error from operator_jobs where idempotency_key = 'settle_battle:<battleId>';
   ```
   From the Safe: `adminResolveDispute(battleId, winner, finalStateHash, turnLogHash, damageA, damageB)` with those values (`winner` = the wallet, or the zero address for a draw). The disputer's bond is refunded because the outcome changed. For a `no_session` battle nothing was played: resolve as a draw (both stakes returned) with any non-zero hashes and zero damage.
4. The finalize watcher will not finalize a rogue proposal, and a disputed battle cannot be finalized by anyone.

This whole sequence is rehearsed by the e2e harness (`scripts/e2e/phases/50-rogue-settlement.ts`).

**A battle is stuck `active` with no one acting.**
The shot clock is server-side, so a human turn always resolves within `BATTLE_SHOT_CLOCK_MS`. If nothing moves, the API process is down or the loop is disabled; restart it (sessions resume). Check logs for `battle_session_error`.

**Players report "turn_mismatch".**
Their client is behind: the turn number they submitted is not `state.turn + 1`. They should re-read `GET /:battleId/state` (or wait for `battle_snapshot` on reconnect). Duplicate submissions of an already-applied turn are acknowledged with `duplicate: true`, never replayed.

**Someone disputes a settled battle.**
Evidence lives in `battle_turns` (command, result, `post_state_hash` per turn) and `battle_sessions` (`final_state_hash`, `turn_log_hash`, `roster`, `vrf_round`). `v3.verifyLog(config, log)` re-executes the log and pinpoints the first inconsistent turn; `v3.turnLogHash` must equal the on-chain value.

First check the seed the log was played with, from public data only (nothing from our database):
1. `getBattle(id)` → `revealedAt`, `seedCommit`, `seedSecret` (disclosed by `settle`). Confirm `keccak256(abi.encodePacked(battleId, seedSecret)) == seedCommit` — the contract enforced this, so a mismatch means you are reading the wrong battle.
2. Round `R` = the first drand round emitted at or after `revealedAt + 6 s` (`seedRoundFor` in `packages/chain/src/battle-seed.ts`; genesis and period from `<DRAND_CHAIN_URL>/info`). It must equal `battle_sessions.vrf_round`.
3. `seed = keccak256(abi.encodePacked(randomness(R), seedSecret, battleId))` (`battleSeed`). Replay the log with that seed. If our stored seed differs, the server played with randomness it was not entitled to: uphold the dispute.

## How a staked battle's randomness is fixed (D-01)

`seed = keccak(drand round R, per-battle secret, battleId)`.

- The **secret** is derived from `BATTLE_SEED_SECRET` and the battle id. The engine commits its hash on-chain inside `revealTeams` and must disclose the secret to `settle`, which checks it.
- The **round** is fixed by rule from the `revealTeams` block timestamp, and has not been emitted yet when that transaction is sent.

So a player cannot compute the seed while the battle is live (the original finding: the seed was the raw public beacon, and a proof won 67.5 % of mirror games by reading the rolls in advance), the operator cannot choose it (its secret is locked in before the round exists), and afterwards anyone can recompute it. Practice battles are not staked and use a server-side random seed.

Residual risk, accepted: an operator who dislikes a seed can decline to settle, which refunds both players at `ACTIVE_WINDOW`. It cannot be turned into a win, and expired battles are visible on-chain — alert on them.

Operational notes: a session start now waits for round `R` (a few seconds on quicknet). A failed start retries onto the same round and the same seed. If the API logs `battle_seed_commit_mismatch`, the API and the engine are running different `BATTLE_SEED_SECRET`s: fix the environment; affected battles refund at `ACTIVE_WINDOW`.

## A battle sits in AwaitingFinalize (phase 5)

`BattleArena.settle` only proposes the result; the payout waits behind the bracket's dispute
window (`payoutDeadline`: 5 min Low / 30 min Mid / 1 h High). The engine's **FinalizeWatcher**
(`apps/engine/src/combat/finalize-watcher.ts`, `FINALIZE_POLL_MS`, default 10 s) calls the
permissionless `finalizeBattle` once the **chain clock** (latest block timestamp) is past the
deadline, then the indexer mirrors `BattleSettled` (phase 6, winner, payouts). If a battle
stays in phase 5 after the window: check the engine log for `finalizeBattle failed`, confirm
`getBattle(id).disputed` is false (disputed battles need `adminResolveDispute`), and that the
operator key has gas. Anyone can also call `finalizeBattle(id)` by hand.

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
