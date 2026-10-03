# D-19 — the mining-reward glide as the contract runs it (simulation, 2026-10-02)

**Decision (2026-10-02): the full fix, shipped in this PR.** The daily reward glide, as `MiningPool` was written, could not keep up with a crowd: any adoption above roughly 6,000 teams spent far more than its share of the season budget in the first week, and a large day-one surge emptied the whole 60-day budget within days. The contract now re-pegs every **hour**, no hour may mint more than **twice its fair share** of what is left (never less than one expedition), and the "exhausted budget" hold covers any remainder smaller than one reward. With those three changes the contract tracks the ideal glide within 1% in every scenario modelled, including 30,000 teams arriving on day one — the "after" tables are in the appendix, section 1.

## What the glide is meant to do

Each season has a fixed budget (352.5M CLAW in Season 1). The glide re-sets the reward per expedition so the budget lasts the full 60 days: the more teams mine, the lower the reward. The design was validated with a simulator (`season.ts`) that re-pegs *exactly* every day from that day's demand.

The contract differs in three ways the audit flagged (D-19): it re-pegs from the **previous** day's demand, it can move the rate at most **±30% per day**, and it does **nothing on day one**. The launch rate (1,250 CLAW per Base expedition) is sized for about 800 teams; for 20,000 teams the sustainable rate is 49. At 30% a day, getting from 1,250 to 49 takes nine days — and the crowd mines at 5–25× the sustainable rate the whole time.

## What the numbers said about the daily controller

Same populations, idealised daily glide vs the controller as it was written (7-day faucet ramp, 50% of income retained for upgrades, boost on the same budget):

| Teams | Budget spent by day 7 (fair share: 11.7%) | Worst single day vs fair share | Reward at day 30 / 60 (ideal) | A day-1 team's season earnings (ideal) |
|---|---|---|---|---|
| 800 (design rate) | 9.1% | 1.5× | 151 / 103 (159 / 111) | 670K (667K) |
| 6,000 (faucet scale) | 20.8% | 2.1× | 70 / 44 (80 / 47) | 114K (96K) |
| 15,000 | **37.7%** | 4.0× | 33 / 25 (65 / 48) | 56K (33K) |
| 20,000 | **50.3%** | 5.4× | 18 / 18 (49 / 49) | 43K (21K) |
| 30,000 | **75.5%** | 8.0× | **2 / 2** (33 / 33) | 28K (14K) |

- At the design rate and at faucet scale the contract is close enough to the ideal.
- From 15,000 teams up, the first week eats a third to three quarters of the season. Everyone who arrives later mines at a fraction of the intended rate for the remaining seven weeks; at 30,000 teams the reward is 2 CLAW from day 10 on — mining is effectively dead and the battle layer with it (the Elite breakeven boost reads 3,411%, far past the 50% cap).
- Early arrivals get a windfall (a day-1 team earns 1.7–2× the ideal) at the expense of everyone after them.
- **A surge on day one is fatal.** 20,000 teams arriving on day one drain the budget by **day 4** (56 days of zero income follow); 30,000 teams drain it by **day 2**.
- A step mid-season (+20,000 teams on day 20) is milder (worst day 3.1×, end-of-season reward 24 vs 31) because the rate has already come down from launch.
- Recovery is slow too (D-19 a): after 70% of 20,000 teams leave on day 30, the rate sits at 11% of where it should be that day and takes 17 days to get within 10% of the ideal.

### The alternatives weighed

| Controller | Spent by day 7: 20K ramp / 30K ramp / 20K surge / 30K surge | Worst day | Day-60 reward (ideal 49 / 33 / 49 / 33) | Days to recover after the exodus |
|---|---|---|---|---|
| **As written: 24 h epoch, ±30%** | 50% / 76% / dry day 4 / dry day 2 | 5–38× | 18 / 2 / — / — | 17 |
| 24 h, down 50% / up 30% | 25% / 36% / 84% / dry day 3 | 4–38× | 30 / 24 / 9 / — | 10 |
| 24 h, 2× spend ceiling | 22% / 22% / 22% / 22% | 2.0× | 42 / 27 / 42 / 27 | 9 |
| 6 h epoch | 15% / 17% / 40% / 56% | 2–24× | 47 / 31 / 33 / 16 | 11 |
| 4 h epoch | 14% / 15% / 30% / 41% | 2–19× | 48 / 31 / 39 / 22 | 0 |
| 1 h epoch | 12% / 13% / 16% / 19% | 1.2–5.7× | 49 / 32 / 46 / 30 | 0 |
| 6 h epoch + 2× ceiling | 14% / 15% / 15% / 15% | 1.7–2.0× | 48 / 32 / 47 / 31 | 0 |
| 4 h epoch, down 50%, 2× ceiling | 13% / 13% / 13% / 13% | 1.3–1.9× | 48 / 32 / 48 / 32 | 0 |
| **1 h epoch + 2× ceiling — shipped** | **12% / 12% / 12% / 12%** | **1.1–1.4×** | **49 / 32 / 49 / 32** | **0** |

Reading it:
- **The epoch length is the main lever.** A shorter epoch lets the rate find the crowd within hours instead of days, and fixes the slow recovery (D-19 a) as a side effect.
- **A shorter epoch alone is not enough for a surge.** The first epoch of a season is always blind at the launch rate; at 4 h that one blind epoch still costs 30–40% of the budget if 20–30 thousand teams arrive at once.
- **The ceiling is the backstop.** It bounds what any epoch can mint regardless of the rate, so no surge — modelled or not — can drain the season. With 1 h epochs it almost never binds (worst day 1.4× against a 2× cap).
- Widening the downward step helps on its own but cannot rescue the day-one case.

### What shipped (MiningPool, before the first deploy)

1. **`REPEG_EPOCH`: 1 day → 1 hour.** The arithmetic already worked in epochs (D-18), so the contract change is the constant, `remainingDays` → `remainingEpochs`, and the comments. `SEASON_DURATION / REPEG_EPOCH` = 1,440 epochs.
2. **Per-epoch spend ceiling.** `startExpedition` reverts `EpochBudgetFull(nextEpochAt)` when this epoch's minted total would exceed `EPOCH_SPEND_CAP_BPS = 20,000` (2×) of its fair share of what is left — `(left + mintedThisEpoch) × 2 / epochsLeft`, with D-20's allocation clamp inside `left`. `epochMinted` is tracked beside `epochWeightServed` and reset at the re-peg. The ceiling never falls below **one expedition of the heaviest tier at the highest boost** (an Apex team at +50%): the rate only moves on a demand signal, so an epoch that could admit nothing would never re-peg — a deadlock for any season whose budget is under 720× its launch reward (a Sepolia test season, say). An `epochBudget()` view returns `(cap, minted, nextEpochAt)` so clients can say "full until HH:MM" instead of sending a reverting transaction.
3. **The D-19(c) hold** now covers any remainder smaller than one Base reward (`remaining < baseReward`), not only exactly zero.

**What players see.** Only in a genuine rush. Hour 0 of Season 1 can mint 2 × 352.5M / 1,440 ≈ **489,583 CLAW** — about 391 Base expeditions at the launch rate, or 15 Apex ones. Teams beyond that in the first hour are told the mine is full until hour 1, by which time the rate has seen hour 0's demand and come down toward the crowd. The API refuses such a start up front (`409 MINE_FULL` with the opening time) and `GET /api/game/mining/budget` shows how much room is left and how many expeditions per tier still fit; on-chain the revert carries the same time. Within an hour it is first come, first served. For 30,000 teams arriving in one day, most cannot mine during the first hours while the rate finds its level — the tables above show the rate at 32–33 CLAW from day 1 and the season intact, against a budget that was gone by day 2 before. `EPOCH_SPEND_CAP_BPS` is the one-constant knob (3× would be the next setting to consider; the tables show 2× never binding outside a surge). Outside a rush nothing changes except that the reward — and repair prices, a percentage of it — adjust hourly instead of daily. An admin `setBaseReward` override above launch now snaps back within the hour.

**How it was verified.** `test/MiningPool.t.sol` (hourly vectors for the clamp, D-18 over 1,439 epochs, the last epoch of a 1,440-hour season, both D-19(c) holds, the ceiling binding then opening, its floor, its last-epoch behaviour, the allocation clamp, the view), the fuzz reference model `FuzzMiningGlide.t.sol` (now models the ceiling, the rollback of a refused call, the hourly epoch and the wider hold, against the real contract over random multi-day scenarios), the invariant suites, seven mutation checks (each change undone one at a time makes the suites fail), Slither, the TypeScript model re-pinned to the new contract vectors, the API route tests and the end-to-end harness.

## A second finding: the "exhausted budget holds the rate" fix (#99) has a gap

D-19(c) said that after an exhaustion the glide should not keep walking the reward down 30% a day (repair prices are a percentage of the reward, so they would become nearly free). The fix holds the rate when `remaining == 0` — **exactly** zero. Expeditions are discrete, so an exhausted season normally keeps a remainder smaller than one reward, and with it the decay continues. Reproduced on the contract itself (probe test, not committed): a 6.5-reward season, six expeditions, half a reward left → the rate goes 1,250 → 875 → 612 → 429 on consecutive days and 300 after a quiet stretch, and once it has fallen below the remainder an expedition can start again at the depressed rate.

With the ceiling, a mid-season exhaustion cannot happen, so this only matters at the natural end of a season — but it is a one-line fix (`if (remaining < season.baseReward) return;`) and shipped with the rest, with a regression test that asserts the hold on a half-reward remainder.

## How this was modelled

- `packages/game-logic/src/v3/season-glide.ts`: the controller in integer wei math, mirroring `MiningPool._repegIfNeeded` via the fuzz suite's reference model; `v3-season-glide.test.ts` pins it to the contract's own test vectors (the 1,250 → 875 clamp, the launch cap, the admin-override snap-back) and to the step properties over 2,000 random states. The population dynamics are `season.ts`'s (ramp, tiers, retention, upgrades, boost) plus join/leave events.
- `bun run season:glide` regenerates every table below. The levers (`epochHours`, `upStepBps`, `downStepBps`, `epochSpendCapX`) are what a contract change sets; `ONCHAIN` is the controller that shipped and `LEGACY_DAILY` the one it replaced, so any future change can be re-checked on the same populations.
- Limits: expeditions are continuous (an epoch that cannot pay everyone pays the fraction it can — on-chain the excess reverts, first come first served); the upgrade-cost figures are the assumption `season.ts` makes; the boost is a flat expected +15% on Evolved+. The controller itself is exact.

## Appendix — full tables (`bun run season:glide`, after the fix)

S1 budget 352.5M CLAW, 60 days, launch reward 1,250 per Base expedition, 6 expeditions a day per team, tier weights 1/3/10/25, 50% of income retained toward upgrades (12k/60k/300k effective), boost on the same budget (+15% expected on Evolved+). "Ideal" is the daily exact re-peg the design was validated with (season.ts): no clamp, no lag, no blind first day. "On-chain" is `MiningPool` as it deploys after D-19 (2026-10-02): re-peg once an HOUR from the previous hour's demand, at most ±30% an hour, nothing in hour 0, and no hour minting more than twice its fair share of what is left. Section 2 keeps the controller this replaced ("before D-19") and the alternatives weighed.

### 1. Ideal glide vs the contract (D-19 controller), same populations

| Scenario · mode | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| Design rate: 800 teams, 7-day ramp · ideal | — | 0 | 7.7% | 1.0× | 1,250 / 1,250 / 1,250 / 624 / 159 / 111 | 667,499 | 0.0M | 59% |
| Design rate: 800 teams, 7-day ramp · on-chain | — | 0 | 7.7% | 1.1× | 1,250 / 1,250 / 1,250 / 624 / 159 / 111 | 668,026 | 0.0M | 59% |
| Faucet scale: 6,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 1,143 / 571 / 381 / 163 / 80 / 47 | 95,674 | 0.0M | 136% |
| Faucet scale: 6,000 teams, 7-day ramp · on-chain | — | 0 | 11.9% | 1.1× | 1,144 / 571 / 381 / 163 / 79 / 47 | 95,867 | 0.0M | 137% |
| 15,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 457 / 228 / 152 / 65 / 65 / 48 | 33,350 | 0.0M | 133% |
| 15,000 teams, 7-day ramp · on-chain | 60 | 0 | 12.0% | 1.1× | 457 / 228 / 152 / 65 / 65 / 48 | 34,227 | 0.0M | 134% |
| 20,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 49 / 49 | 20,900 | 0.0M | 131% |
| 20,000 teams, 7-day ramp · on-chain | — | 0 | 12.0% | 1.1× | 342 / 171 / 114 / 49 / 49 / 49 | 21,173 | 0.0M | 132% |
| 30,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 228 / 114 / 76 / 33 / 33 / 33 | 13,933 | 0.0M | 196% |
| 30,000 teams, 7-day ramp · on-chain | — | 0 | 12.1% | 1.2× | 228 / 114 / 76 / 32 / 32 / 32 | 14,170 | 0.0M | 197% |
| Surge: 20,000 teams all on day 1 · ideal | — | 0 | 11.7% | 1.0× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 131% |
| Surge: 20,000 teams all on day 1 · on-chain | — | 0 | 12.2% | 1.3× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 132% |
| Surge: 30,000 teams all on day 1 · ideal | — | 0 | 11.7% | 1.0× | 33 / 33 / 33 / 33 / 33 / 33 | 11,750 | 0.0M | 196% |
| Surge: 30,000 teams all on day 1 · on-chain | — | 0 | 12.3% | 1.4× | 32 / 32 / 32 / 32 / 32 / 32 | 11,750 | 0.0M | 197% |
| Step: 5,000 teams, then 20,000 more join on day 20 · ideal | — | 0 | 11.5% | 1.0× | 1,250 / 686 / 458 / 196 / 34 / 31 | 79,142 | 0.0M | 209% |
| Step: 5,000 teams, then 20,000 more join on day 20 · on-chain | 60 | 0 | 11.7% | 1.1× | 1,250 / 686 / 458 / 196 / 34 / 30 | 79,332 | 0.0M | 210% |
| Exodus: 20,000 teams, 70 % leave on day 30 · ideal | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 163 / 47 | 11,794 | 0.0M | 136% |
| Exodus: 20,000 teams, 70 % leave on day 30 · on-chain | — | 0 | 12.0% | 1.1× | 342 / 171 / 114 / 49 / 163 / 47 | 12,105 | 0.0M | 137% |

### 2. The controller before D-19, the alternatives weighed, and the one shipped — on the hard cases

#### 20,000 teams, 7-day ramp

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 49 / 49 | 20,900 | 0.0M | 131% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 60 | 0 | 50.3% | 5.4× | 1,250 / 875 / 613 / 147 / 18 / 18 | 43,223 | 0.0M | 358% |
| 6 h epoch, ±30 % | — | 0 | 14.7% | 2.3× | 429 / 167 / 111 / 47 / 47 / 47 | 23,498 | 0.0M | 136% |
| 4 h epoch, ±30 % | — | 0 | 13.7% | 1.9× | 338 / 168 / 112 / 48 / 48 / 48 | 22,624 | 0.0M | 134% |
| 1 h epoch, ±30 % | — | 0 | 12.2% | 1.2× | 342 / 171 / 114 / 49 / 49 / 49 | 21,330 | 0.0M | 132% |
| 24 h epoch, down 50 % / up 30 % | 60 | 0 | 25.0% | 3.6× | 1,250 / 625 / 313 / 49 / 42 / 30 | 34,983 | 0.0M | 212% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 42 / 42 | 24,078 | 0.0M | 154% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 13.9% | 1.8× | 429 / 168 / 112 / 48 / 48 / 48 | 22,542 | 0.0M | 135% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.7% | 1.3× | 341 / 170 / 113 / 48 / 48 / 48 | 21,590 | 0.0M | 133% |
| ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling | — | 0 | 12.0% | 1.1× | 342 / 171 / 114 / 49 / 49 / 49 | 21,173 | 0.0M | 132% |

#### 30,000 teams, 7-day ramp

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 228 / 114 / 76 / 33 / 33 / 33 | 13,933 | 0.0M | 196% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 60 | 0 | 75.5% | 8.0× | 1,250 / 875 / 613 / 147 / 2 / 2 | 28,208 | 0.0M | 3411% |
| 6 h epoch, ±30 % | — | 0 | 17.0% | 3.5× | 429 / 108 / 72 / 31 / 31 / 31 | 17,182 | 0.0M | 209% |
| 4 h epoch, ±30 % | — | 0 | 14.9% | 2.7× | 222 / 111 / 74 / 31 / 31 / 31 | 16,033 | 0.0M | 204% |
| 1 h epoch, ±30 % | — | 0 | 12.5% | 1.4× | 227 / 113 / 76 / 32 / 32 / 32 | 14,455 | 0.0M | 198% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 35.6% | 5.5× | 1,250 / 625 / 313 / 28 / 24 / 24 | 22,498 | 0.0M | 268% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 27 / 27 | 16,052 | 0.0M | 236% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 14.5% | 2.0× | 429 / 111 / 74 / 32 / 32 / 32 | 15,357 | 0.0M | 203% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.9% | 1.4× | 227 / 113 / 75 / 32 / 32 / 32 | 14,497 | 0.0M | 199% |
| ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling | — | 0 | 12.1% | 1.2× | 228 / 114 / 76 / 32 / 32 / 32 | 14,170 | 0.0M | 197% |

#### Surge: 20,000 teams all on day 1

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 131% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 4 | 56 | 100.0% | 25.5× | 1,250 / 875 / 613 / 429 / 429 / 429 | 17,625 | 0.0M | 17% |
| 6 h epoch, ±30 % | — | 0 | 39.6% | 16.2× | 429 / 103 / 33 / 33 / 33 / 33 | 17,625 | 0.0M | 191% |
| 4 h epoch, ±30 % | — | 0 | 30.0% | 12.5× | 210 / 39 / 39 / 39 / 39 / 39 | 17,625 | 0.0M | 165% |
| 1 h epoch, ±30 % | — | 0 | 16.2% | 4.0× | 46 / 46 / 46 / 46 / 46 / 46 | 17,625 | 0.0M | 138% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 84.4% | 25.5× | 1,250 / 625 / 313 / 20 / 9 / 9 | 17,625 | 0.0M | 738% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 42 / 42 | 17,625 | 0.0M | 154% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 14.8% | 2.0× | 429 / 103 / 47 / 47 / 47 / 47 | 17,625 | 0.0M | 136% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.8% | 1.8× | 48 / 48 / 48 / 48 / 48 / 48 | 17,625 | 0.0M | 133% |
| ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling | — | 0 | 12.2% | 1.3× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 132% |

#### Surge: 30,000 teams all on day 1

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 33 / 33 / 33 / 33 / 33 / 33 | 11,750 | 0.0M | 196% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 2 | 58 | 100.0% | 38.3× | 1,250 / 875 / 875 / 875 / 875 / 875 | 11,750 | 0.0M | 9% |
| 6 h epoch, ±30 % | — | 0 | 55.8% | 24.3× | 429 / 103 / 25 / 16 / 16 / 16 | 11,750 | 0.0M | 390% |
| 4 h epoch, ±30 % | — | 0 | 40.6% | 18.8× | 210 / 25 / 22 / 22 / 22 / 22 | 11,750 | 0.0M | 291% |
| 1 h epoch, ±30 % | — | 0 | 18.7% | 5.7× | 30 / 30 / 30 / 30 / 30 / 30 | 11,750 | 0.0M | 213% |
| 24 h epoch, down 50 % / up 30 % | 3 | 57 | 100.0% | 38.3× | 1,250 / 625 / 313 / 313 / 313 / 313 | 11,750 | 0.0M | 22% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 27 / 27 | 11,750 | 0.0M | 236% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 15.3% | 2.0× | 429 / 103 / 31 / 31 / 31 / 31 | 11,750 | 0.0M | 204% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.9% | 1.9× | 39 / 32 / 32 / 32 / 32 / 32 | 11,750 | 0.0M | 199% |
| ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling | — | 0 | 12.3% | 1.4× | 32 / 32 / 32 / 32 / 32 / 32 | 11,750 | 0.0M | 197% |

#### Step: 5,000 teams, then 20,000 more join on day 20

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.5% | 1.0× | 1,250 / 686 / 458 / 196 / 34 / 31 | 79,142 | 0.0M | 209% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 60 | 0 | 18.8% | 3.1× | 1,250 / 1,250 / 875 / 210 / 26 / 24 | 90,924 | 0.0M | 264% |
| 6 h epoch, ±30 % | 60 | 0 | 12.5% | 2.1× | 1,250 / 683 / 454 / 194 / 33 / 29 | 81,251 | 0.0M | 218% |
| 4 h epoch, ±30 % | 60 | 0 | 12.2% | 1.7× | 1,250 / 684 / 455 / 195 / 33 / 30 | 81,383 | 0.0M | 215% |
| 1 h epoch, ±30 % | 60 | 0 | 11.7% | 1.3× | 1,250 / 686 / 458 / 196 / 34 / 30 | 79,337 | 0.0M | 211% |
| 24 h epoch, down 50 % / up 30 % | 60 | 0 | 15.7% | 3.2× | 1,250 / 1,250 / 677 / 220 / 30 / 25 | 87,944 | 0.0M | 254% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | 60 | 0 | 18.8% | 1.9× | 1,250 / 1,250 / 875 / 210 / 27 / 25 | 90,922 | 0.0M | 251% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | 60 | 0 | 12.5% | 1.7× | 1,250 / 683 / 454 / 194 / 33 / 30 | 81,238 | 0.0M | 216% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | 60 | 0 | 12.1% | 1.3× | 1,250 / 685 / 456 / 195 / 34 / 30 | 79,293 | 0.0M | 212% |
| ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling | 60 | 0 | 11.7% | 1.1× | 1,250 / 686 / 458 / 196 / 34 / 30 | 79,332 | 0.0M | 210% |

#### Exodus: 20,000 teams, 70 % leave on day 30

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 163 / 47 | 11,794 | 0.0M | 136% |
| before D-19: 24 h epoch, ±30 %, no ceiling | — | 0 | 50.3% | 5.4× | 1,250 / 875 / 613 / 147 / 18 / 90 | 31,800 | 0.0M | 72% |
| 6 h epoch, ±30 % | — | 0 | 14.7% | 2.3× | 429 / 167 / 111 / 47 / 104 / 42 | 14,706 | 0.0M | 151% |
| 4 h epoch, ±30 % | — | 0 | 13.7% | 1.9× | 338 / 168 / 112 / 48 / 161 / 45 | 13,727 | 0.0M | 142% |
| 1 h epoch, ±30 % | — | 0 | 12.2% | 1.2× | 342 / 171 / 114 / 49 / 163 / 46 | 12,276 | 0.0M | 138% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 25.0% | 3.6× | 1,250 / 625 / 313 / 49 / 42 / 22 | 20,660 | 0.0M | 286% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 42 / 21 | 16,347 | 0.0M | 310% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 13.9% | 1.8× | 429 / 168 / 112 / 48 / 105 / 44 | 13,665 | 0.0M | 145% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.7% | 1.3× | 341 / 170 / 113 / 48 / 163 / 46 | 12,595 | 0.0M | 139% |
| ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling | — | 0 | 12.0% | 1.1× | 342 / 171 / 114 / 49 / 163 / 47 | 12,105 | 0.0M | 137% |

### 3. Recovery after the exodus (D-19 a): on-chain reward as a share of the ideal, by day

| Controller | d30 | d31 | d32 | d33 | d35 | d40 | d45 | d60 | days below 90% of ideal after d30 |
|---|---|---|---|---|---|---|---|---|---|
| before D-19: 24 h epoch, ±30 %, no ceiling | 10.9% | 14.2% | 18.4% | 24.0% | 40.5% | 55.4% | 55.4% | 191.2% | 17 |
| 6 h epoch, ±30 % | 63.6% | 98.4% | 98.4% | 98.4% | 98.4% | 98.4% | 98.4% | 89.6% | 11 |
| 4 h epoch, ±30 % | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 95.5% | 0 |
| 1 h epoch, ±30 % | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 98.2% | 0 |
| 24 h epoch, down 50 % / up 30 % | 25.5% | 33.1% | 43.0% | 55.9% | 92.3% | 92.3% | 92.3% | 47.2% | 10 |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | 25.5% | 33.1% | 43.0% | 56.0% | 92.4% | 92.4% | 92.4% | 43.4% | 9 |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | 64.2% | 99.3% | 99.3% | 99.3% | 99.3% | 99.3% | 99.3% | 93.4% | 0 |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 97.8% | 0 |
| ON-CHAIN since D-19: 1 h epoch, ±30 %, 2× ceiling | 99.9% | 99.9% | 99.9% | 99.9% | 99.9% | 99.9% | 99.9% | 99.0% | 0 |
