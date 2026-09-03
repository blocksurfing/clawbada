# Boost Epoch Runbook (battle-rank mining boost, S1)

Operational guide for the weekly job that turns battle participation into the on-chain
mining boost table (`MiningPool.setTeamBoosts` / `activateBoostEpoch`). Design is locked in
`.claude/CLAUDE.md` ("Battle-Rank Mining Boost"); this document covers what runs, what
can go wrong, and how to put it right.

## TL;DR

| What | Value |
|------|-------|
| Cadence | Engine tick every **60 s** (`apps/engine/src/boost/service.ts`); windows are **weekly** on a fixed grid |
| Window E | `[anchor + 7d*E, anchor + 7d*(E+1))`; E = 0 is launch week |
| Chain epoch | **window + 1**. Boosts earned in window E are posted as chain epoch E+1 and are live during window E+1. Contract starts at `currentBoostEpoch() == 0` (nothing live); the first activation is chain epoch 1 at the end of window 0 |
| Signer | `BOOST_ADMIN_PRIVATE_KEY` (hot service wallet, `BOOST_ADMIN_ROLE`); falls back to `OPERATOR_PRIVATE_KEY` |
| On-chain fail-safe | Every boost reads as 0 once `boostEpochActivatedAt` is older than **10 days** (`BOOST_EPOCH_TTL`) |
| Alarm | `boost_epoch_overdue` (error level, every tick) once the newest activation is older than **8 days** |
| Floor override | Edit `boost_epochs.floor_played` for a **future** window; the job never rewrites it |
| Manual recovery | Reset `boost_epochs.status` / `operator_jobs.status` as described below; the job resumes on the next tick |

## What runs when

The engine process runs two cooperating pieces:

1. **`BoostEpochService`** (`apps/engine/src/boost/`) — a 60 s tick calling `runEpochJob`:
   - `ensureAnnounced`: a `boost_epochs` row exists for every window from 0 through the
     next one (`chain_epoch = epoch_id + 1`, window bounds from the clock,
     `floor_played` from `BOOST_FLOOR_SCHEDULE`: 7/week for windows 0-3, 14/week from window 4).
     Existing rows are never rewritten except `announced -> active` for the current window.
   - For every row whose `ends_at <= now` and is not `activated`, **in window order**,
     stopping at the first that is not activated afterwards:
     - `computeEpoch` (`announced|active|closing -> computed`): one transaction; played =
       `COUNT(battle_participation)` for the window; qualified = played >= `floor_played`
       and Power 3..9 and team not disbanded; every other rated team gets one idle-decay
       step (15 % of the gap to 1200); `rankQualified` builds one global ladder; rows go to
       `team_boosts` for chain epoch E+1 with `batch_index = floor(i / 200)`; counts and
       win-trading `flags` land on the row. Logs `boost_epoch_computed`.
     - `stageEpoch` (`computed -> staged`): reads `currentBoostEpoch()` first (see
       "chain_out_of_sync"), then inserts one `operator_jobs` row per batch
       (`set_team_boosts`, key `boost:set:<chainEpoch>:<batch>`), storing the ids in
       `set_job_ids`. Zero qualified teams still stage (no set jobs).
     - `activateEpoch` (`staged -> activated`): once every set job is `succeeded`, inserts
       the `activate_boost_epoch` job (key `boost:activate:<chainEpoch>`); once that job
       succeeded, marks the row `activated` with `activate_tx_hash`.
   - `checkOverdue`: the alarm described below.
2. **Operator worker** (`apps/engine/src/operator/`) — the outbox processor that actually
   signs and submits `set_team_boosts` and `activate_boost_epoch` (handlers in
   `operator/jobs/`). Every job persists its tx hash before waiting for the receipt and
   reconciles that hash on retry, so a crash never double-submits.

Status lifecycle of a `boost_epochs` row:

```
announced -> active -> closing -> computed -> staged -> activated
                                     \           \-> failed   (chain_out_of_sync, dead set job)
                                      \-> failed  (never: compute has no failure exit; it retries)
```

Timeline for one window (E) in normal operation:

| Moment | Event |
|--------|-------|
| start of E | row for E+1 announced (floor published a week ahead) |
| during E | battles append `battle_participation`; ratings move at settle |
| end of E (first tick after `ends_at`) | compute -> stage -> set jobs submitted (1 tx per 200 teams) |
| ~seconds later | activate job submitted; `currentBoostEpoch()` becomes E+1 |
| window E+1 | `startExpedition` pays `base x (1 + bps/10000) x weight` for boosted teams |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `BOOST_ADMIN_PRIVATE_KEY` | Signs `setTeamBoosts` / `activateBoostEpoch`. Must hold `MiningPool.BOOST_ADMIN_ROLE` (granted to `BOOST_ADMIN_ADDRESS` by `Configure.s.sol`). Falls back to `OPERATOR_PRIVATE_KEY`; the `.env.example` placeholder `0x` counts as unset. Give it its own funded key in prod so it does not share a nonce with the matchmaker/resolver. |
| `BOOST_EPOCH_ANCHOR_TS` | Unix **seconds** of the season-1 start. Defines the weekly grid for api, indexer and engine alike. When unset, the indexed season-1 `start_time` is used; until either exists the engine logs `boost_epoch_anchor_unavailable` every tick and does nothing (it does not crash). Set it explicitly in prod and never change it after launch: the window index is baked into `battle_participation.epoch_id` and the chain epoch numbering. |
| `CHAIN_ENV` | `mainnet` selects Base; anything else Base Sepolia (same as the rest of the engine). |

## Overriding next week's floor

The floor schedule is code (`BOOST_FLOOR_SCHEDULE` in `packages/game-logic/src/rating.ts`),
but each window's floor is **persisted once** on its `boost_epochs` row and the job never
overwrites it. To change a specific week, edit that row **before the window ends** (policy:
announce a week ahead, so edit the row for the *next* window):

```sql
-- next window = current + 1; check first
SELECT epoch_id, starts_at, ends_at, floor_played, status FROM boost_epochs ORDER BY epoch_id DESC LIMIT 3;

UPDATE boost_epochs SET floor_played = 10, updated_at = now() WHERE epoch_id = <next> AND status IN ('announced', 'active');
```

For a window further out (its row does not exist yet) pre-insert it; the job's insert is
`ON CONFLICT DO NOTHING`, so your row wins:

```sql
INSERT INTO boost_epochs (epoch_id, chain_epoch, starts_at, ends_at, floor_played, status)
VALUES (
  <E>, <E> + 1,
  to_timestamp(<anchor_ts> + <E> * 604800),
  to_timestamp(<anchor_ts> + (<E> + 1) * 604800),
  10, 'announced'
);
```

Do not edit a window that has already ended: compute reads the floor at close time, and a
row at `computed` or later is never recomputed. Publish the change wherever players read
the floor (API `GET /api/game/boost/epoch` serves the row).

## The overdue alarm and the 10-day TTL

Two independent safety nets:

- **Server alarm** — every tick, `checkOverdue` compares now with the newest
  `boost_epochs.activated_at` (or the anchor when nothing was ever activated). Older than
  **8 days** -> `boost_epoch_overdue` at error level, every 60 s until fixed. Normal
  operation activates every 7 days, so any alarm means at least a day of slippage.
- **On-chain TTL** — `MiningPool.teamBoostBps` returns 0 for everyone once
  `block.timestamp > boostEpochActivatedAt + 10 days`. Mining continues at the unboosted
  rate; no funds are at risk. Boosts resume with the next `activateBoostEpoch`.

On alarm, check in order: is the engine running and ticking (`boost_epoch_service_started`,
no `boost_epoch_tick_failed`)? Is there a `failed` row or a `boost_epoch_blocked` warning
(see below)? Are there `operator_jobs` rows stuck `pending` with growing `attempts`
(RPC down, `BOOST_ADMIN` wallet out of gas, role not granted -> `revert:AccessControl...`)?

## Failure modes and manual recovery

Every status change and failure is logged with `epochId`, `chainEpoch` and the reason. The
job is idempotent at every step, so recovery is always "fix the cause, reset the status,
let the next tick redo the step".

### A row is `failed`

`boost_epochs.last_error` says why. **A failed row blocks every later window** (the chain
epoch counter cannot skip), and the job logs `boost_epoch_blocked` each tick.

**`chain_out_of_sync: currentBoostEpoch=C expected=E`** (from `stageEpoch`). The job
refuses to post chain epoch E+1 unless the contract is exactly at E.

- `C > E` cannot reach `failed` (the row is marked `activated` automatically).
- `C < E`: an earlier window was marked activated in the DB without the chain following
  (e.g. someone edited a row, or the DB was restored from a backup taken after a
  rollback). Find the gap:

  ```sql
  SELECT epoch_id, chain_epoch, status, activate_tx_hash, activated_at FROM boost_epochs ORDER BY epoch_id;
  ```

  Compare with `cast send $MINING_POOL "currentBoostEpoch()(uint32)"`. Reset the earliest
  row whose chain epoch is above `C` back to `computed` (its `team_boosts` rows are kept,
  so staging just re-enqueues the set jobs) and reset the failed row too:

  ```sql
  UPDATE boost_epochs SET status = 'computed', set_job_ids = '[]', activate_job_id = NULL, activate_tx_hash = NULL,
         activated_at = NULL, last_error = NULL, updated_at = now()
   WHERE epoch_id IN (<first_unactivated>, <failed>);
  ```

  The outbox keys are per chain epoch and batch, so an old `succeeded` job with the same
  key would be reused as-is; delete such rows first if their tx is not actually on chain:

  ```sql
  DELETE FROM operator_jobs WHERE idempotency_key LIKE 'boost:set:<chainEpoch>:%' OR idempotency_key = 'boost:activate:<chainEpoch>';
  ```

**`set_job_dead: <id>:<error>`** / **`activate_job_dead: <error>`** / **`*_job_missing`**
(from `activateEpoch`). An outbox job exhausted its retries or reverted. Typical causes:
`revert:AccessControlUnauthorizedAccount` (role not granted to the signer),
`revert:BoostTooHigh` / `revert:BatchTooLarge` (should be impossible: the ladder is
clamped and batched server-side), `max_attempts_exceeded` (RPC outage), or
`revert:InvalidBoostEpoch` on a set job (the contract moved on; the batch is stale).

1. Fix the cause (grant the role, fund the wallet, restore RPC).
2. Requeue the dead job. Keep `tx_hash` if one was recorded: the handler reconciles the
   receipt before resubmitting.

   ```sql
   UPDATE operator_jobs SET status = 0, attempts = 0, next_attempt_at = now(), last_error = NULL WHERE id = <id>;
   ```

3. Put the epoch row back to `staged` so the job re-checks the set jobs and (re)enqueues
   activation:

   ```sql
   UPDATE boost_epochs SET status = 'staged', last_error = NULL, updated_at = now() WHERE epoch_id = <E>;
   ```

   If the *activate* job was the dead one and the chain shows the epoch live anyway, the
   requeued handler returns success without a tx (it checks `currentBoostEpoch()`).

### Nothing is failed but the alarm fires

- `operator_jobs` rows stuck `pending` with `attempts` climbing: the worker is retrying a
  transient error (5 s -> 30 s -> 5 min -> 1 h backoff, then dead). Look at `last_error`.
- No due rows at all and no rows being announced: the anchor is unavailable
  (`boost_epoch_anchor_unavailable`) or the clock is wrong. Verify
  `BOOST_EPOCH_ANCHOR_TS` against `seasons.start_time`.
- `boost_epoch_backfill` with a large `count`: the engine was down across several
  boundaries (or the anchor moved). Each missed window is computed and activated in
  turn, one activation per tick; this is expected and self-healing.

### Reconciliation SQL

Settled battles that never moved a rating (indexer gap):

```sql
SELECT b.battle_id, b.settled_at, b.team_a, b.team_b, b.winner
  FROM battles b
 WHERE b.settled_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM rating_events e
      WHERE e.battle_id = b.battle_id AND e.kind IN ('battle', 'forfeit_loss'))
 ORDER BY b.settled_at DESC;
```

`games_played_epoch` cache vs the `battle_participation` ledger (the job logs
`played_cache_mismatch` with the same list at close; the ledger always wins):

```sql
SELECT r.team_id, r.epoch_id, r.games_played_epoch AS cached, COALESCE(p.n, 0) AS ledger
  FROM team_ratings r
  LEFT JOIN (
    SELECT team_id, epoch_id, COUNT(*) AS n FROM battle_participation GROUP BY 1, 2
  ) p ON p.team_id = r.team_id AND p.epoch_id = r.epoch_id
 WHERE r.games_played_epoch <> COALESCE(p.n, 0);
```

Posted table vs what the contract holds for one team (spot check):

```sql
SELECT epoch_id, team_id, rank, boost_bps, power, batch_index, tx_hash FROM team_boosts WHERE team_id = <teamId> ORDER BY epoch_id DESC LIMIT 3;
-- cast call $MINING_POOL "teamBoostBps(uint256,uint8)(uint16)" <teamId> <power>
```

## Day-one telemetry

All from Postgres; no metrics stack. Run these against the read replica the morning after
launch and once per window afterwards.

Queue wait and search radius at match (`matchmaking_decisions.meta` is JSON text with
`ratingGap`, `ratingRadius`, `powerRadius`):

```sql
SELECT date_trunc('hour', created_at) AS hour, stake_bracket, power_score,
       COUNT(*) AS matches,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_sec) AS p50_wait_sec,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_sec) AS p95_wait_sec,
       AVG(((meta::jsonb)->>'ratingGap')::numeric)    AS avg_rating_gap,
       AVG(((meta::jsonb)->>'ratingRadius')::numeric) AS avg_rating_radius,
       AVG(((meta::jsonb)->>'powerRadius')::numeric)  AS avg_power_radius
  FROM matchmaking_decisions
 WHERE decision IN ('matched', 'matched-after-expansion')
   AND created_at > now() - interval '24 hours'
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
```

Battle duration (queue + battle ~30 min is the trigger for the Apex base-boost review):

```sql
SELECT stake_bracket,
       COUNT(*) AS battles,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM settled_at - created_at)) AS p50_sec,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM settled_at - created_at)) AS p95_sec
  FROM battles
 WHERE settled_at IS NOT NULL AND created_at > now() - interval '7 days'
 GROUP BY 1 ORDER BY 1;
```

Battles per epoch per bracket and Power (one row per team-battle):

```sql
SELECT p.epoch_id, b.stake_bracket,
       CASE WHEN p.team_id = b.team_a THEN b.power_a ELSE b.power_b END AS power,
       COUNT(*) AS team_battles,
       COUNT(DISTINCT p.team_id) AS teams
  FROM battle_participation p
  JOIN battles b ON b.battle_id = p.battle_id
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
```

Boost uptake by mine tier (0 Base .. 3 Apex):

```sql
SELECT mine_tier,
       COUNT(*) AS expeditions,
       COUNT(*) FILTER (WHERE boost_bps > 0) AS boosted,
       ROUND(100.0 * COUNT(*) FILTER (WHERE boost_bps > 0) / COUNT(*), 1) AS boosted_pct,
       AVG(boost_bps) FILTER (WHERE boost_bps > 0) AS avg_boost_bps
  FROM expeditions
 WHERE created_at > now() - interval '7 days'
 GROUP BY 1 ORDER BY 1;
```

Ladder shape and lapse rate per window:

```sql
SELECT e.epoch_id, e.floor_played, e.rated_count, e.qualified_count, e.avg_boost_bps,
       e.lapsed_count, prev.qualified_count AS prev_qualified,
       ROUND(e.lapsed_count::numeric / NULLIF(prev.qualified_count, 0), 3) AS lapse_rate,
       e.status, e.activated_at
  FROM boost_epochs e
  LEFT JOIN boost_epochs prev ON prev.epoch_id = e.epoch_id - 1
 WHERE e.status IN ('computed', 'staged', 'activated', 'failed')
 ORDER BY e.epoch_id;
```

Win-trading flags (pairs meeting 3+ times in a window; same-owner subset):

```sql
SELECT epoch_id,
       jsonb_array_length(flags->'repeatedPairs')  AS repeated_pairs,
       jsonb_array_length(flags->'sameOwnerPairs') AS same_owner_pairs,
       flags->'sameOwnerPairs'                     AS detail
  FROM boost_epochs
 WHERE flags IS NOT NULL AND jsonb_array_length(flags->'repeatedPairs') > 0
 ORDER BY epoch_id;
```

The same pairs, live, before the window closes:

```sql
SELECT LEAST(team_id, opponent_team_id) AS a, GREATEST(team_id, opponent_team_id) AS b,
       COUNT(DISTINCT battle_id) AS battles
  FROM battle_participation
 WHERE epoch_id = <E> AND opponent_team_id IS NOT NULL
 GROUP BY 1, 2 HAVING COUNT(DISTINCT battle_id) >= 3
 ORDER BY 3 DESC;
```

## Log messages (grep list)

| Message | Level | Meaning |
|---------|-------|---------|
| `boost_epoch_service_started` / `_stopped` | info | lifecycle |
| `boost_epoch_clock_ready` | info | anchor resolved |
| `boost_epoch_anchor_unavailable` | warn | no anchor yet; retried each tick |
| `boost_epoch_announced` | info | a window row was created |
| `boost_epoch_backfill` | warn | more than the usual two rows created at once |
| `played_cache_mismatch` | warn | cache differs from ledger for listed teams |
| `boost_win_trading_flag` | warn | a repeated pair (with `sameOwner`) |
| `boost_epoch_computed` / `_staged` / `_activate_enqueued` / `_activated` | info | pipeline progress |
| `boost_epoch_already_activated` | warn | chain was ahead; row marked activated without posting |
| `boost_epoch_failed` | error | row moved to `failed` (`error` field says why) |
| `boost_epoch_blocked` | warn | a failed row is holding up later windows (every tick) |
| `boost_epoch_overdue` | error | newest activation older than 8 days (every tick) |
| `boost_epoch_tick_failed` | error | a tick threw (DB/RPC); next tick retries |
| `boost_epoch_row_missing` / `_unknown_status` | error | hand-edited data the job will not guess about |
