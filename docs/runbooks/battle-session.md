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
| `PRACTICE_PRESETS` | on outside production | Lets dev environments start a practice battle without owning lobsters. `team_*` rosters (the `/dojo` team builder) stay open even when this is off. |
| `DRAND_CHAIN_URL` | League of Entropy quicknet (3 s rounds) | The public half of a real battle's seed — see "How a staked battle's randomness is fixed". |
| `BATTLE_SEED_SECRET` | none — **required in production**, identical on API and engine | The secret half. ≥ 32 chars. Guard it like a key: whoever holds it can foresee every roll of every live battle. |

## Single-instance assumption

Sessions live in memory in **one** API process. The `battle_sessions` primary key is the claim, so a second replica cannot start the same real battle, but it also cannot serve its WebSocket turns. Run one API instance with the loop enabled; extra read replicas must set `BATTLE_SESSIONS_ENABLED=false`. Multi-instance fan-out is S2 work (Postgres LISTEN/NOTIFY, X10).

## Restart behaviour

Every turn writes a full state snapshot (`state_json`) plus the turn row. On boot the manager reloads all `active` rows, rebuilds the state, re-verifies real battles are still Active on chain (else `abandoned`), and re-arms the pending human turn with `max(remaining, 5 s)`. Clients reconnect and receive `battle_snapshot`.

## Verifying a battle (the watchdog, frozen results, audits)

`GET /api/game/combat/<battleId>/log` returns, once the battle has ended, everything the on-chain `turnLogHash` commits to: rules version, battle id, seed, arena, roster and the ordered log. Nothing in it needs this server's database to check:

1. **The seed.** `keccak256(drand randomness of vrfRound, seedSecret, battleId)` — `seedSecret` is what `settle` disclosed on-chain, and `vrfRound` is fixed by the reveal timestamp. (`battleSeed` in `@clawbada/chain`.)
2. **The log.** `v3.verifyLog(cfg, log)` re-executes every turn and compares every per-turn hash.
3. **The commitment.** `v3.turnLogHash(state, roster)` must equal `BattleArena.getBattle(id).turnLogHash`, and `v3.hashState(state)` the `finalStateHash`. The preimage is canonical JSON (sorted keys), so it does not depend on how any one implementation orders fields.

The e2e harness does exactly this against the live stack (`phases/40-assert.ts`, "evidence bundle"), and the engine's watchdog does the same for every settled battle during its review window (`v3.reproduceSession` from the session row; see below).

**What the log can and cannot prove (D-12).** A Defend chosen by the shot clock is marked `timeout: true` inside the hashed log, and a forfeit carries its `reason`. Replay rejects a `timeout` forfeit that does not directly follow three consecutive timed-out turns by the loser, and rejects a forfeit with no reason — so a server can no longer award a battle with a bare forfeit entry. It still cannot prove that a player *sent* a move the server says timed out, or that a `resign` was really the player's: **turns are not signed in Season 1** (owner decision D-12, 2026-10-01). A per-battle session key (one wallet signature at battle start) is the later-season option.

**Rules versions (D-27).** `battle_sessions.rules_version` (also inside `turnLogHash`) is a hash of everything that decides an outcome: the v3 constants, the stat tables for every class, tier and legend flag, the class-advantage graph, and every damage/crit/proc formula sampled on a fixed grid. A balance patch changes it automatically. Replaying a battle under other rules is refused with `rules version mismatch` — that log is not wrong, it needs the engine it was played on.

Release process when `RULES_VERSION` changes (the pinned test in `v3-replay.test.ts` fails until you do this):
1. Tag the last commit of the OLD rules: `git tag engine-rules-<first 12 hex of the old value>`.
2. Paste the new value into the pinned test and mention the rules change in the release notes.
3. To review a battle played under old rules, check out the tag that matches its `rules_version` and run the verification above there. (The live watchdog replays with the code it runs: a battle still in review across a rules change would replay as `rules version mismatch` and be frozen — deploy a rules change when no battle is in review, or expect to resolve those by hand.)
Bump `ENGINE_VERSION` by hand for a logic change no sampled number would notice (turn order, targeting, status handling).

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

**`battle_frozen` fired** (and usually `rogue_settlement_proposal` from the indexer / API / settle job).
The watchdog could not reproduce a result `settle` recorded, and froze it with the GUARDIAN key before it could pay. The `reason` in the log says why: `no_session` (recorded before this server ever started the battle), `session_still_active` (recorded while the battle was being played), `result_mismatch` / `replay_mismatch: <field>` (different winner, forfeiter, damage or hashes than the replay), `replay_failed: …` (our own stored log does not replay — an engine bug or a tampered database). Nothing is asked of the players; they see "Frozen for review".

1. **Stop the bleeding** if the resolver key is the cause. From the Safe: `revokeRole(RESOLVER_ROLE, <compromised address>)` on BattleArena, then rotate (`admin-roles.md`). Rotate `BATTLE_SEED_SECRET` with it (`settle` must disclose it, so it is exposed too). Every battle that reaches Active while the key is live is exposed. The lobsters are already free — `settle` released both teams — but its repair damage has been applied; make it good off-chain from the treasury if it was wrong.
2. **Resolve it with the true result, within 72 h of `frozenAt`.** The real battle ran to its end on the API; the honest settle job is dead with `proposal_mismatch`, and its payload IS the true result:
   ```sql
   select payload, last_error from operator_jobs where idempotency_key = 'settle_battle:<battleId>';
   ```
   From the Safe: `resolveFrozen(battleId, winner, forfeiter, false)` with `winner` = the payload's wallet (zero address for a draw) and `forfeiter` = the payload's forfeiter (zero address if null). For a `no_session` battle nothing was played: `resolveFrozen(battleId, 0x0, 0x0, true)` refunds both players in full.
3. **If the freeze was a false alarm** (e.g. `replay_failed` after a rules change), re-run the verification above by hand; if the result on-chain is right, resolve it with exactly that result.
4. **The long-stop.** The engine pages `battle_frozen_awaiting_safe` hourly, then `battle_freeze_long_stop_due` in the last 12 h. If the Safe has not acted 72 h after `frozenAt`, the engine (or anyone) calls `expireFrozen`: the held stakes (2·stake) are **burned** and both players are paid stake + 5 % back from the refund reserve (`refundReserve`), logged `frozen_battle_expired`. If the reserve is short of 2·stake, the held stakes are returned directly and nothing burns. Keep the reserve funded (`fundReserve`, anyone; `withdrawReserve`, the Safe).
5. **`battle_freeze_missed`** means a result the watchdog could not reproduce left its review window unfrozen (engine down, guardian key out of gas, chain stalled past the window) and will pay as submitted. `battle_freeze_failed` means the watchdog wanted to freeze and could not (guardian signer missing — `GUARDIAN_PRIVATE_KEY` —, `GUARDIAN_ROLE` not granted, no gas, RPC down, or the freeze transaction reverted): freeze it from the Safe immediately — the Safe can also call `freeze` while the window is open. The hourly `guardian_preflight_failed` says the same thing BEFORE a bad result arrives; treat it as urgent.

This whole sequence is rehearsed by the e2e harness (`scripts/e2e/phases/50-rogue-settlement.ts`).

**A battle is stuck `active` with no one acting.**
The shot clock is server-side, so a human turn always resolves within `BATTLE_SHOT_CLOCK_MS`. If nothing moves, the API process is down or the loop is disabled; restart it (sessions resume). Check logs for `battle_session_error`.

**Players report "turn_mismatch".**
Their client is behind: the turn number they submitted is not `state.turn + 1`. They should re-read `GET /:battleId/state` (or wait for `battle_snapshot` on reconnect). Duplicate submissions of an already-applied turn are acknowledged with `duplicate: true`, never replayed.

**A player questions a settled battle.**
There is no on-chain dispute; this is a support question. Evidence lives in `battle_turns` (command, result, `post_state_hash` per turn) and `battle_sessions` (`final_state_hash`, `turn_log_hash`, `roster`, `vrf_round`). `v3.verifyLog(config, log)` re-executes the log and pinpoints the first inconsistent turn; `v3.turnLogHash` must equal the on-chain value.

First check the seed the log was played with, from public data only (nothing from our database):
1. `getBattle(id)` → `revealedAt`, `seedCommit`, `seedSecret` (disclosed by `settle`). Confirm `keccak256(abi.encodePacked(battleId, seedSecret)) == seedCommit` — the contract enforced this, so a mismatch means you are reading the wrong battle.
2. Round `R` = the first drand round emitted at or after `revealedAt + 6 s` (`seedRoundFor` in `packages/chain/src/battle-seed.ts`; genesis and period from `<DRAND_CHAIN_URL>/info`). It must equal `battle_sessions.vrf_round`.
3. `seed = keccak256(abi.encodePacked(randomness(R), seedSecret, battleId))` (`battleSeed`). Replay the log with that seed. If our stored seed differs, the server played with randomness it was not entitled to: treat it as an incident and make the player whole from the treasury.

## How a staked battle's randomness is fixed (D-01)

`seed = keccak(drand round R, per-battle secret, battleId)`.

- The **secret** is derived from `BATTLE_SEED_SECRET` and the battle id. The engine commits its hash on-chain inside `revealTeams` and must disclose the secret to `settle`, which checks it.
- The **round** is fixed by rule from the `revealTeams` block timestamp, and has not been emitted yet when that transaction is sent.

So a player cannot compute the seed while the battle is live (the original finding: the seed was the raw public beacon, and a proof won 67.5 % of mirror games by reading the rolls in advance), the operator cannot choose it (its secret is locked in before the round exists), and afterwards anyone can recompute it. Practice battles are not staked and use a server-side random seed.

Residual risk, accepted: an operator who dislikes a seed can decline to settle, which refunds both players at `ACTIVE_WINDOW`. It cannot be turned into a win, and expired battles are visible on-chain — alert on them.

Operational notes: a session start now waits for round `R` (a few seconds on quicknet). A failed start retries onto the same round and the same seed. If the API logs `battle_seed_commit_mismatch`, the API and the engine are running different `BATTLE_SEED_SECRET`s: fix the environment; affected battles refund at `ACTIVE_WINDOW`.

## A battle sits in review (phase 5) or frozen (phase 8)

`BattleArena.settle` records the result, applies damage and releases both teams; the payout waits
for the bracket's review window (`payoutDeadline`: 5 min Low / 30 min Mid / 1 h High). The
engine's **watchdog** (`apps/engine/src/combat/finalize-watcher.ts`, `FINALIZE_POLL_MS`, default
10 s) replays the battle (`judgeSettlement`: `judgeProposal` + `v3.reproduceSession`) and either
freezes it with the GUARDIAN key (`battle_frozen`) or, once the **chain clock** (latest block
timestamp) is past the deadline, calls the permissionless `finalizeBattle`; the indexer mirrors
`BattleFrozen` (phase 8) and `BattleSettled` (phase 6, winner, payouts; a draw's fee is the
total of both halves). If a battle stays in phase 5 after the window: the watchdog pages
`finalize_overdue` after six ticks; check the engine log for `watchdog step failed`, and that the
operator key has gas. Anyone can also call `finalizeBattle(id)` by hand. Phase 8: see
`battle_frozen` above.

What the watchdog does besides (review 2026-10-03, section C — the safety net must not fail open
quietly):

- **Two sources of work.** Each tick it merges the indexer's mirror (`battles.phase` in 1/3/4/5/8)
  with the chain's own `BattleProposed` / `BattleFrozen` logs over the last 2,000 blocks (~70 min),
  so a stalled indexer cannot hide a result from review. The heartbeat
  `watchdog_heartbeat {tick, rows, dbRows, fromLogsOnly}` is logged every tick.
- **Order.** Results in review are judged earliest `payoutDeadline` first; the whole freeze pass
  runs before any payout; receipts are tracked in the background (a slow transaction never delays
  the next freeze; the battle is skipped until its receipt lands).
- **A judge that throws is a verdict**: `judge_threw: …` is not clean and is frozen like any other
  mismatch. A session row that cannot be READ (the database, not the replay) is retried while the
  window has more than 60 s left, then fails closed the same way.
- **Guardian preflight** at boot and hourly: the key behind `guardianClient` must hold
  `GUARDIAN_ROLE` on BattleArena and at least 0.002 ETH. Otherwise `guardian_preflight_failed`
  (fatal), repeated every hour until fixed. A freeze that cannot be sent — missing key, role revert
  (`AccessControlUnauthorizedAccount`), no gas, RPC down, or a freeze transaction that reverted —
  is `battle_freeze_failed` (fatal) on every attempt.
- **Lapsed battles.** A battle in Deposit (1), TeamReveal (3) or Active (4) whose `phaseDeadline`
  has passed gets the permissionless `handleTimeout` (operator key): `battle_timed_out_by_watchdog`
  (info for a declined deposit, warn for a lapsed reveal or an unsettled Active battle — the latter
  is the `settle_window_missed` case above). `PhaseNotTimedOut` / `InvalidBattlePhase` /
  `BattleDoesNotExist` reverts are benign.
- **Frozen past the long-stop.** `expireFrozen` is attempted every tick; `expire_failed` pages after
  six failed attempts, and `battle_freeze_long_stop_due` keeps paging hourly until the battle is gone.

Signers: `finalizeBattle` / `expireFrozen` / `handleTimeout` use the operator key (permissionless);
`freeze` uses `GUARDIAN_PRIVATE_KEY` (GUARDIAN_ROLE; off mainnet it falls back to
`OPERATOR_PRIVATE_KEY`).

### Alerting

Page (fatal / error level, message prefix):

| Message | Meaning | First move |
|---|---|---|
| `battle_freeze_failed` | the watchdog found a result it cannot reproduce and could NOT freeze it (no key, no role, no gas, RPC, reverted tx) | freeze it from the Safe now (`freeze(battleId)`, window still open), then fix the key |
| `guardian_preflight_failed` | the guardian key would not be able to freeze (role not granted / below 0.002 ETH / unreadable) | grant `GUARDIAN_ROLE` or fund the key — before a bad result reaches review |
| `battle_freeze_missed` | a result the watchdog cannot reproduce left its review window unfrozen; it pays as submitted | incident: see `battle_frozen` above for the evidence trail; make players whole from the treasury |
| `battle_frozen` | a result was frozen for the Safe | resolve within 72 h (above) |
| `battle_frozen_awaiting_safe` / `battle_freeze_long_stop_due` | hourly reminders while frozen; the second in the last 12 h and past the long-stop | resolve it |
| `finalize_overdue` / `expire_failed` | the permissionless `finalizeBattle` / `expireFrozen` has not landed six ticks past its deadline | RPC, operator gas, `watchdog step failed` in the log; call it by hand |
| `watchdog_heartbeat` **silent for > 60 s** | the watchdog is not ticking (engine down, RPC hung) | restart the engine; nothing is lost while the review windows are still open |
| `indexer_watch_error` (indexer) | the live event poll failed; one is a blip, a stream is an outage | check the RPC |
| `indexer_lagging` (indexer) | the chain holds events older than 30 blocks the indexer never processed | restart the indexer (the backfill resumes from its last block) |

## A reveal stalls (phase 3)

The team commit rides in the deposit; the reveal window is 60 s from the second deposit. The
engine's RevealWatcher checks each stored salt against the on-chain commit. A salt that does not
open its commit is reported at once (`accuseRevealFailure`, log `reveal_failure_reported`); a side
with no salt is reported when 8 s of the window are left. The report extends the window by 2
minutes for both sides. The reported player can open their own commit (`POST /:id/open-commit` →
`openOwnCommit`); the watcher then reveals with the opened values — unless they are not the team
the player queued with (D-17, `opened_commit_not_queued_team`), in which case the battle lapses
into a mutual cancel. A reported player who never opens loses their 5 % at `handleTimeout`.

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
