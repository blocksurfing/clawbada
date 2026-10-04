# Season rollover (the Safe starts each season)

**Decision D-25 (2026-10-01):** every 60 days a new mining season must be started on-chain with `MiningPool.startSeason(totalEmission, baseReward)`. That call needs `SEASON_ADMIN_ROLE`, which belongs to the governance Safe after the handoff. No engine key holds it, and none must: a hot key that could pick season numbers could print the mining allocation. The engine only watches the clock and hands the Safe the exact transaction.

## What you will see

The engine reads the season from the contracts (`currentSeason()` + `getSeasonConfig()`), so it alarms even when the indexer has no `seasons` row; the indexer's row is only its fallback when the RPC is down.

| Alarm (log `msg`) | When | Meaning |
|---|---|---|
| `season_not_started` | the contracts answer, `currentSeason()` is 0 and no `SeasonStarted` was ever indexed; repeated daily | **Season 1 has never been started** (`Configure.s.sol` has not run against this deploy). Mining cannot start at all. |
| `season_rollover_due` | from 3 days before the season ends, repeated daily | Prepare and collect signatures for the Safe transaction in the alarm. |
| `season_rollover_overdue` | **the season gap**: the season has ended and no new one started, repeated hourly | **Mining pays nothing until the Safe executes the transaction.** The payload's `seasonGap` says since when and for how long. |
| `season_allocation_exhausted` (info) | the 705M mining allocation is used up | Nothing to do: mining emissions have ended for good (TOK-M1). |
| `season_chain_db_mismatch` (warn) | `currentSeason()` is 0 but the indexer holds a season row | The DB is stale or the indexer watches another MiningPool address. Fix the deploy/env, not the season. |
| `New season started` (info) | the engine saw a new season on chain (or the indexer synced it) | The alarms reset. |

Each rollover alarm carries `safeTx`, plus the rules behind both numbers (`emissionRule`, `baseRewardRule`) and the rate the season closed on (`closingBaseReward`):

```
{ to: <MiningPool>, value: "0", data: 0x25c7fcdf…, call: "MiningPool.startSeason(<emission>, <baseReward>)" }
```

## During the gap

Between the end of a season (`startTime + 60 days`) and the Safe's `startSeason`:

- `startExpedition` and `repeg` revert `SeasonNotActive`. The API answers `409 SEASON_GAP` on `POST /api/game/mining/start` and `GET /api/game/mining/budget` (the message carries `seasonEndedAt`); `/budget` reports `seasonEndsAt` / `seasonEndsAtIso` while a season is active so clients can see the gap coming.
- `claimExpedition` still pays: expeditions started before the end finish and claim normally. Nobody loses a reward to the gap.
- A late start is not a shortened season: `startSeason` begins a fresh 60 days from the block it lands in. The gap is simply lost mining time.

## What to do

1. In the Safe, create a transaction to `safeTx.to` with `safeTx.data`. Use the custom-data option; don't retype the numbers.
2. **Before anyone signs**, decode the data and check both arguments (mandatory — a wrong `startSeason` is permanent for 60 days):

   ```
   cast calldata-decode "startSeason(uint256,uint256)" <safeTx.data>
   ```

   - The first value is the **emission**. It carries 18 decimals (`352500000000000000000000000` = 352.5M) and must equal the schedule below for the season being started (or the allocation left, from Season 8). A value with no decimals would start a season with a near-zero budget.
   - The second value is the **base reward**. It must be `≤ 1250000000000000000000` (1,250e18, the genesis rate) and equal the alert's proposal (`safeTx.call`), unless the Safe decided on another rate — see "Base reward" below.
3. Collect the signatures before the season ends. `startSeason` reverts `SeasonStillActive` until the end time passes, so execute it right after the end.
4. Confirm on chain and in the logs:

   ```
   cast call <MiningPool> "currentSeason()(uint256)" --rpc-url <rpc>
   ```

   shows the new number, the indexer logs the mirrored `SeasonStarted` (a new `seasons` row) and the engine logs `New season started`. The `season_rollover_*` alarms stop.

## The numbers

- **Emission** follows the TOK-M1 schedule, in wei:
  - Season 1 is 352.5M.
  - It halves each season through Season 6.
  - Season 7 is 7.05M.
  - From Season 8 it's whatever is left of the 705M allocation.
  - The prepared value is already clamped to the allocation left (`MINING_ALLOCATION − lifetimeMinted`, read from chain). The contract applies the same clamp anyway (D-20). If the alarm's `emissionRule` says the chain was unreadable, the value is the unclamped schedule — still safe to sign, the contract clamps it.
- **Base reward** is a governance choice. The plan proposes **2× the rate the season closed on, capped at the genesis 1,250** (D-B: `min(2 × currentBaseReward(), 1,250e18)`). The hourly glide (TOK-G1) re-pegs it from there as needed, never above the launch value, so a season that closed compressed reopens with room to recover and one that closed at the cap reopens at the cap. If the closing rate was unreadable, the plan falls back to the genesis 1,250 and the alarm says so. You may change it before signing; if so, rebuild the calldata (`cast calldata "startSeason(uint256,uint256)" <emission> <baseReward>`) and decode it again.
- **The contract refuses the two classic typos (D-D, 2026-10-03, PR #182).** `startSeason` reverts `SeasonBudgetTooSmall` when the budget cannot pay even one Base expedition (a missing `e18`), and `BaseRewardTooHigh` when the launch reward is more than 3× the previous season's launch (an extra zero). `setBaseReward` (the emergency override) reverts `BaseRewardTooHigh` above 3× the season's launch or above what the budget can still pay. These are backstops, not a substitute for decoding the calldata before signing.
- **Escape hatch**: a rate that turns out wrong after the start is not permanent. `MiningPool.setBaseReward(newBaseReward)` (also `SEASON_ADMIN_ROLE`, the Safe) overrides the live rate mid-season; the glide keeps re-pegging from the new value, still capped at the season's launch reward.

Code: `apps/engine/src/seasons/manager.ts`.

> **Note.** `legacyGetSeasonEmission` / `LEGACY_SEASON_EMISSIONS` in `packages/game-logic/src/constants.ts` (renamed and deprecated by PR #182; nothing reads it) is the stale pre-TOK-M1 schedule: it starts at 387.5M, has a 7.75M floor, and its numbers carry no token decimals. The engine no longer uses it. The old automatic rollover would have passed it to `startSeason` as wei and started Season 2 with a near-zero budget. Don't use it for anything on-chain.
