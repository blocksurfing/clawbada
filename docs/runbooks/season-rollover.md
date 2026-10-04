# Season rollover (the Safe starts each season)

**Decision D-25 (2026-10-01):** every 60 days a new mining season must be started on-chain with `MiningPool.startSeason(totalEmission, baseReward)`. That call needs `SEASON_ADMIN_ROLE`, which belongs to the governance Safe after the handoff. No engine key holds it, and none must: a hot key that could pick season numbers could print the mining allocation. The engine only watches the clock and hands the Safe the exact transaction.

## What you will see

| Alarm (log `msg`) | When | Meaning |
|---|---|---|
| `season_rollover_due` | from 3 days before the season ends, repeated daily | Prepare and collect signatures for the Safe transaction in the alarm. |
| `season_rollover_overdue` | the season has ended and no new one started, repeated hourly | **Mining pays nothing until the Safe executes the transaction.** |
| `season_allocation_exhausted` (info) | the 705M mining allocation is used up | Nothing to do: mining emissions have ended for good (TOK-M1). |
| `New season started` (info) | the indexer synced a new season | The alarms reset. |

Each alarm carries `safeTx`:

```
{ to: <MiningPool>, value: "0", data: 0x25c7fcdf…, call: "MiningPool.startSeason(<emission>, <baseReward>)" }
```

## What to do

1. In the Safe, create a transaction to `safeTx.to` with `safeTx.data`. Use the custom-data option; don't retype the numbers.
2. Check the decoded call against the schedule below.
3. Collect the signatures before the season ends. `startSeason` reverts `SeasonStillActive` until the end time passes, so execute it right after the end.
4. Confirm: the indexer logs `New season started` and the API's season endpoint shows the new number.

## The numbers

- **Emission** follows the TOK-M1 schedule, in wei:
  - Season 1 is 352.5M.
  - It halves each season through Season 6.
  - Season 7 is 7.05M.
  - From Season 8 it's whatever is left of the 705M allocation.
  - The prepared value is already clamped to the allocation left (`MINING_ALLOCATION − lifetimeMinted`, read from chain). The contract applies the same clamp anyway (D-20).
- **Base reward** is a governance choice. The plan proposes `min(2 × the closing rate, 1,250)` (D-B), and the hourly glide (TOK-G1) re-pegs from there — never above it. You may change it before signing. If so, rebuild the calldata (`cast calldata "startSeason(uint256,uint256)" <emission> <baseReward>`).
- **The contract refuses the two classic typos (D-D, 2026-10-03).** `startSeason` reverts `SeasonBudgetTooSmall` when the budget cannot pay even one Base expedition (a missing `e18`), and `BaseRewardTooHigh` when the launch reward is more than 3× the previous season's launch (an extra zero). `setBaseReward` (the emergency override) reverts `BaseRewardTooHigh` above 3× the season's launch or above what the budget can still pay. These are backstops, not a substitute for decoding the calldata before signing.

Code: `apps/engine/src/seasons/manager.ts`.

> **Note.** `legacyGetSeasonEmission` / `LEGACY_SEASON_EMISSIONS` in `packages/game-logic/src/constants.ts` is the stale pre-TOK-M1 schedule (renamed and deprecated 2026-10-03; nothing reads it): it starts at 387.5M, has a 7.75M floor, and its numbers carry no token decimals. The engine no longer uses it. The old automatic rollover would have passed it to `startSeason` as wei and started Season 2 with a near-zero budget. Don't use it for anything on-chain.
