# Clawbada — Battle-Rank Mining Boost: On-Chain Surface Note

Date: 2026-09-03
Cross-references: [`2026-05-01-v3-s1-campaign.md`](./2026-05-01-v3-s1-campaign.md) (prior closed campaign, Slither baseline), `docs/runbooks/admin-roles.md` (BOOST_ADMIN_ROLE policy)
Design reference: `.claude/CLAUDE.md` "Battle-Rank Mining Boost (S1 — locked 2026-09-02)"; economics model `packages/game-logic/src/v3/boost.ts` (`bun run boost`)

## Scope

Single-contract extension of `contracts/MiningPool.sol` adding the on-chain half of the S1 battle-rank mining boost. The off-chain half (team rating, banded matchmaking, weekly ladder job) lands separately and only *writes* to this surface through `BOOST_ADMIN_ROLE`.

Surface added:

1. **Role** `BOOST_ADMIN_ROLE` — hot service key (class of MATCHMAKER/RESOLVER), granted by `Configure.s.sol` to `BOOST_ADMIN_ADDRESS`; mainnet requires it set and distinct from the deployer. Not migrated by `Handoff.s.sol` (service role, not governance).
2. **Storage** `mapping(teamId => TeamBoost{epoch: uint32, bps: uint16, power: uint8})` (one slot), `currentBoostEpoch: uint32`, `boostEpochActivatedAt: uint64`.
3. **Writes** `setTeamBoosts(uint32 epoch, BoostEntry[] calldata)` — `epoch ∈ {current, current+1}`, `epoch ≠ 0`, `≤ MAX_BOOST_BATCH (200)` rows, each `bps ≤ MAX_BOOST_BPS (5,000)`; pure storage writes, no external calls. `activateBoostEpoch(uint32)` — must be `current + 1`; stamps `boostEpochActivatedAt`.
4. **Reads** `teamBoostBps(teamId, power)` (effective), `getTeamBoost(teamId)` (raw).
5. **Reward path** in `startExpedition`: `power` accumulated from the existing tier-gate reads; `boostedBase = baseReward × (BPS + bps) / BPS` **before** the tier multiply; `epochWeightServed += weight × (BPS + bps)` (demand now bps-scaled; `_repegIfNeeded` divides by `BPS` when rolling into `trailingWeightServed`, so `BaseRewardRepegged` and `getSeasonConfig` keep their units).
6. **Event change** `ExpeditionStarted(..., uint256 reward, uint16 boostBps)` — new topic0; indexer + ABI regenerated.
7. **Constants** `BPS_DENOMINATOR = 10_000`, `MAX_BOOST_BPS = 5_000`, `BOOST_EPOCH_TTL = 10 days`, `MAX_BOOST_BATCH = 200`.

## Trust assumptions

| Assumption | Bound if violated |
|---|---|
| `BOOST_ADMIN` posts the ladder the server computed | Any table it posts is capped at +50% per team, stamped with Power, evented row-by-row, and expires after 10 days. |
| The server keeps posting weekly | If it stops, `_effectiveBoost` returns 0 for every team once `boostEpochActivatedAt + 10 days` passes — no stale ladder pays forever. |
| Boosted spend is paid from the season budget, not new emissions | Enforced structurally: the boosted reward runs through the same `SeasonBudgetExhausted` / `MiningAllocationExhausted` checks and the same escrow mint; boosted weight is credited to glide demand so `baseReward` compresses for everyone rather than the budget being overrun. |
| Rank is bound to the roster that earned it | On-chain half: the entry's `power` must equal the live sum of tiers at `startExpedition`; evolving any lobster changes Power and zeroes the boost until re-posted. Off-chain half (lineage across disband/recreate) is the server's job. |

## Threat walk-through

- **Compromised BOOST_ADMIN key** → grants ≤ +50% to attacker-chosen teams for ≤ 10 days. Cannot mint, cannot touch `baseReward`, stakes, NFTs, or other teams' rewards. Detectable from `TeamBoostSet` vs the published ladder (runbook detection signals). Rotation = grant/revoke from DEFAULT_ADMIN.
- **Half-written table** → impossible to observe: entries are staged for `current + 1` and become live only on `activateBoostEpoch`. A crash mid-batch leaves the live epoch intact.
- **Stale entry replay** → an entry from epoch N is inert once epoch N+1 activates (`b.epoch != currentBoostEpoch`), which is also how the lapse rule is enforced with zero clearing writes.
- **Rank laundering via evolution** → closed by the Power stamp (test `test_boostDropsWhenTeamPowerChanges`).
- **Rounding escape** → boost applied to the base *before* the tier multiply keeps `reward % TIER_WEIGHTS[tier] == 0` (invariant I-4 unchanged) and bounds truncation at < 1 wei per weight unit.
- **Budget interaction** → boosted rewards still revert on the season budget and the 705M lifetime cap (`test_boostedRewardStillBoundedBySeasonBudget`, `…ByLifetimeAllocation`).
- **Glide interaction** → six +50% expeditions register as 9 trailing units, not 6 (`test_boostedExpeditionsCountAsScaledGlideDemand`), so the next re-peg targets lower than an unboosted control. Without this the glide would over-estimate headroom and the budget would exhaust early.
- **Griefing via batch size** → `MAX_BOOST_BATCH` bounds gas per call; entries for non-existent teams are harmless storage (no external calls in the loop, so no calls-loop DoS).
- **Epoch-0 write** → rejected (`epoch == 0` reverts) so nothing can be made effective before the first activation, including in test environments where `block.timestamp` is small.

## Tests added

- `test/MiningPool.t.sol` (+18): boosted reward formula, event, escrow and claim; zero before activation; lapse; TTL expiry (boundary exact); Power change; amend live epoch; stage-does-not-leak; activation ordering; epoch-0 / far-epoch rejection; cap; batch bound; role gating (SEASON_ADMIN is deliberately insufficient); events; scaled glide demand vs unboosted control; season-budget and lifetime-cap binding on boosted amounts; tier-weight multiple with an odd bps.
- `contracts/test/fuzz/FuzzMiningPool.t.sol`: `testFuzz_boostedReward_bounded` — for all `bps ∈ [0, 5000]`, `tier ∈ [1, 3]`: `unboosted ≤ reward ≤ 1.5 × unboosted`, `reward % weight == 0`, exact formula.
- `contracts/test/invariant/`: handler gains `handler_setTeamBoosts` (random team, true or wrong Power, live or next epoch, bps up to 6,000 so some revert) and `handler_activateBoostEpoch`; new invariants `invariant_rewardWithinBoostBound` (every reward ≤ max base seen at any start × 1.5 × weight) and `invariant_staleBoostEpochPaysNothing` (past the TTL every team reads 0). Existing I-1..I-5 unchanged and still green.

Scoreboard (default profile): **878 / 878** forge (857 → 878).

## Slither

`slither contracts --filter-paths "lib/|node_modules/|test/|script/" --fail-medium` → **exit 0, 89 results**, all Low / Informational / Optimization.

Baseline note: the pre-change engine branch exited **255 with 93 results**. Six Medium findings were live, all in `MiningPool`: one `divide-before-multiply` from this change and five from the TOK-G1 glide (`_repegIfNeeded`: one `divide-before-multiply`, four `incorrect-equality`) that were merged to the engine branch without passing through main's `contracts-audit` workflow. All six are suppressed at the call site with written justification per the workflow policy:

- `startExpedition` — `divide-before-multiply` is deliberate (boost before tier multiply preserves the tier-weight-multiple invariant; truncation < 1 wei per weight unit).
- `_repegIfNeeded` — `remainingDays` is an integer day count by design; the strict equalities compare epoch indices and unit counters, never balances.

## Open items / follow-ups

- Server side (next PR): team-keyed rating with lineage across disband/recreate, banded matchmaking, weekly ladder job posting through the `operator_jobs` outbox with `BOOST_ADMIN_PRIVATE_KEY`, telemetry.
- `ExpeditionStarted` gained a field: `apps/indexer/src/watchers/mining-watcher.ts` must read `boostBps` (written to `expeditions.boost_bps` in the server PR).
- Launch-pool edge: the closed-interval percentile pays a lone qualified team +50%. Product-level constant on the server (`BOOST_MIN_LADDER_SIZE`), not a contract concern.
