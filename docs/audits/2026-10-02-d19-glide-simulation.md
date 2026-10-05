# D-19 — the mining-reward glide as the contract runs it (simulation, 2026-10-02)

**Decision (2026-10-02): the full fix, shipped in this PR.** The daily reward glide, as `MiningPool` was written, could not keep up with a crowd: any adoption above roughly 6,000 teams spent far more than its share of the season budget in the first week, and a large day-one surge emptied the whole 60-day budget within days. The contract now re-pegs every **hour**, no hour may mint more than **twice its fair share** of what is left (never less than one expedition), and the "exhausted budget" hold covers any remainder smaller than one reward. With those three changes the contract tracks the ideal glide within 1% in every scenario modelled, including 30,000 teams arriving on day one — the "after" tables are in the appendix, section 1.

## What the glide is meant to do

Each season has a fixed budget (352.5M GOLD in Season 1). The glide re-sets the reward per expedition so the budget lasts the full 60 days: the more teams mine, the lower the reward. The design was validated with a simulator (`season.ts`) that re-pegs *exactly* every day from that day's demand.

The contract differs in three ways the audit flagged (D-19): it re-pegs from the **previous** day's demand, it can move the rate at most **±30% per day**, and it does **nothing on day one**. The launch rate (1,250 GOLD per Base expedition) is sized for about 800 teams; for 20,000 teams the sustainable rate is 49. At 30% a day, getting from 1,250 to 49 takes nine days — and the crowd mines at 5–25× the sustainable rate the whole time.

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
- From 15,000 teams up, the first week eats a third to three quarters of the season. Everyone who arrives later mines at a fraction of the intended rate for the remaining seven weeks; at 30,000 teams the reward is 2 GOLD from day 10 on — mining is effectively dead and the battle layer with it (the Elite breakeven boost reads 3,411%, far past the 50% cap).
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

**What players see.** Only in a genuine rush. Hour 0 of Season 1 can mint 2 × 352.5M / 1,440 ≈ **489,583 GOLD** — about 391 Base expeditions at the launch rate, or 15 Apex ones. Teams beyond that in the first hour are told the mine is full until hour 1, by which time the rate has seen hour 0's demand and come down toward the crowd. The API refuses such a start up front (`409 MINE_FULL` with the opening time) and `GET /api/game/mining/budget` shows how much room is left and how many expeditions per tier still fit; on-chain the revert carries the same time. Within an hour it is first come, first served. For 30,000 teams arriving in one day, most cannot mine during the first hours while the rate finds its level — the tables above show the rate at 32–33 GOLD from day 1 and the season intact, against a budget that was gone by day 2 before. `EPOCH_SPEND_CAP_BPS` is the one-constant knob (3× would be the next setting to consider; the tables show 2× never binding outside a surge). Outside a rush nothing changes except that the reward — and repair prices, a percentage of it — adjust hourly instead of daily. An admin `setBaseReward` override above launch now snaps back within the hour.

**How it was verified.** `test/MiningPool.t.sol` (hourly vectors for the clamp, D-18 over 1,439 epochs, the last epoch of a 1,440-hour season, both D-19(c) holds, the ceiling binding then opening, its floor, its last-epoch behaviour, the allocation clamp, the view), the fuzz reference model `FuzzMiningGlide.t.sol` (now models the ceiling, the rollback of a refused call, the hourly epoch and the wider hold, against the real contract over random multi-day scenarios), the invariant suites, seven mutation checks (each change undone one at a time makes the suites fail), Slither, the TypeScript model re-pinned to the new contract vectors, the API route tests and the end-to-end harness.

## D-C (review 2026-10-03): what the glide measures demand with

**What was wrong.** The glide paced against *the last epoch that had any demand*. Agents run a 4-hour expedition cycle, and a population that happens to start everything in one hour of four — which is what a fleet of identical scripts does — showed the controller one busy hour and three it never saw. Pacing on the busy hour reads the population as four times its size; carrying it over the quiet hours means the rate never corrects. The table in appendix 4 has the numbers: at 100 % phase-locking the single-epoch rule stranded **65M GOLD** of the season (81.5 % spent) while paying 12–20 GOLD a unit instead of 49, and at 25–90 % it paid the bunched cohort 14–21 % more per unit than everyone else (ratio 1.14–1.21).

**What was tried.** Three estimators on the same four demand shapes (smooth; phase-locked at 25 / 50 / 90 / 100 %; a whale that idles then bursts; a daily rhythm with 60 % or 80 % of starts in a third of the day), 20,000 teams from day 1, refused starts retrying the next hour, scored on budget spent, GOLD per unit by cohort, refused starts, worst day against the fair share:

| Estimator | Phase-locked (any %) | Surge day 1 (20K / 30K) | Daily rhythm | Cost |
|---|---|---|---|---|
| last epoch with demand (D-19 as first shipped) | strands up to 65M, pays the bunch +14–21 % | tracks the ideal within 1 % | pays off-peak starters ~2× peak (ratio 0.47–0.54) | — |
| **last 4 epochs — one expedition cycle** | **spends 100 %, ratio 1.00–1.01** | **tracks the ideal within 1 %** (week 1: 12.3 / 12.4 % vs 11.7 % fair; worst day 1.45× / 1.51× against 1.40× / 1.47× single-epoch, inside the 2× hourly ceiling) | ratio 0.58–0.59 (unchanged) | +0.04 on the surge worst-day multiple; ~0.5 pt more refused starts |
| last 24 epochs — a day | spends 100 %, ratio 1.00–1.01 | week 1 ~1.5–2 pts over the ideal share; day 1 pays 70 then dips to 48; worst day 1.98× the fair share; slower recovery after an exodus | ratio 1.02 (fair) | 12–26 % refused starts on day 1 |

**What shipped.** `DEMAND_WINDOW = 4`: the demand estimate is the average over the last four closed epochs. Epochs nobody touched are quiet ones — a lazy re-peg after a gap inside the window zeroes the skipped slots; after a gap *longer* than the window nothing recent is left and the rate holds (as it does before the first expedition). The published `trailingWeightServed` is that average; the target uses the window *sum* over the epochs counted, so a small population still moves the rate. Every roll emits `EpochRolled(season, epoch, trailing, cap)`. The day-window's fairness under a daily rhythm was the one thing given up: it costs the surge cases, which are the cases the glide exists for, and the human play rhythm it would serve is a fraction of an agent-first population. Revisit if telemetry shows a strong daily rhythm (the window is one constant).

**Also in the same change (D-D).** `startSeason` reverts `SeasonBudgetTooSmall` when the budget cannot pay one Base expedition (a missing `e18`) and `BaseRewardTooHigh` when a season's launch reward is more than 3× the previous season's; `setBaseReward` reverts `BaseRewardTooHigh` above 3× the season's launch or above what the budget can still pay. `epochBudget()` is all-zero once the season's 60 days are over. The pre-TOK-M1 schedule in `constants.ts` is renamed `LEGACY_*` and deprecated.

## A second finding: the "exhausted budget holds the rate" fix (#99) has a gap

D-19(c) said that after an exhaustion the glide should not keep walking the reward down 30% a day (repair prices are a percentage of the reward, so they would become nearly free). The fix holds the rate when `remaining == 0` — **exactly** zero. Expeditions are discrete, so an exhausted season normally keeps a remainder smaller than one reward, and with it the decay continues. Reproduced on the contract itself (probe test, not committed): a 6.5-reward season, six expeditions, half a reward left → the rate goes 1,250 → 875 → 612 → 429 on consecutive days and 300 after a quiet stretch, and once it has fallen below the remainder an expedition can start again at the depressed rate.

With the ceiling, a mid-season exhaustion cannot happen, so this only matters at the natural end of a season — but it is a one-line fix (`if (remaining < season.baseReward) return;`) and shipped with the rest, with a regression test that asserts the hold on a half-reward remainder.

## How this was modelled

- `packages/game-logic/src/v3/season-glide.ts`: the controller in integer wei math, mirroring `MiningPool._repegIfNeeded` via the fuzz suite's reference model; `v3-season-glide.test.ts` pins it to the contract's own test vectors (the 1,250 → 875 clamp, the launch cap, the admin-override snap-back) and to the step properties over 2,000 random states. The population dynamics are `season.ts`'s (ramp, tiers, retention, upgrades, boost) plus join/leave events.
- `bun run season:glide` regenerates every table below. The levers (`epochHours`, `upStepBps`, `downStepBps`, `epochSpendCapX`) are what a contract change sets; `ONCHAIN` is the controller that shipped and `LEGACY_DAILY` the one it replaced, so any future change can be re-checked on the same populations.
- Limits: expeditions are continuous (an epoch that cannot pay everyone pays the fraction it can — on-chain the excess reverts, first come first served); the upgrade-cost figures are the assumption `season.ts` makes; the boost is a flat expected +15% on Evolved+. The controller itself is exact.

## Appendix — full tables (`bun run season:glide`, after the fix)

Regenerated 2026-10-04 after D-C: "on-chain" rows and the "ON-CHAIN since D-C" controller are the 4-epoch window; "D-19 as first shipped" is the single-epoch rule it replaced.

### 1. Ideal glide vs the contract (D-19 controller), same populations

| Scenario · mode | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| Design rate: 800 teams, 7-day ramp · ideal | — | 0 | 7.7% | 1.0× | 1,250 / 1,250 / 1,250 / 624 / 159 / 111 | 667,499 | 0.0M | 59% |
| Design rate: 800 teams, 7-day ramp · on-chain | — | 0 | 7.8% | 1.1× | 1,250 / 1,250 / 1,250 / 623 / 158 / 110 | 665,337 | 0.0M | 59% |
| Faucet scale: 6,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 1,143 / 571 / 381 / 163 / 80 / 47 | 95,674 | 0.0M | 136% |
| Faucet scale: 6,000 teams, 7-day ramp · on-chain | — | 0 | 12.0% | 1.1× | 1,144 / 571 / 380 / 163 / 79 / 47 | 97,739 | 0.0M | 137% |
| 15,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 457 / 228 / 152 / 65 / 65 / 48 | 33,350 | 0.0M | 133% |
| 15,000 teams, 7-day ramp · on-chain | 60 | 0 | 12.2% | 1.1× | 457 / 228 / 152 / 65 / 65 / 48 | 34,204 | 0.0M | 134% |
| 20,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 49 / 49 | 20,900 | 0.0M | 131% |
| 20,000 teams, 7-day ramp · on-chain | — | 0 | 12.2% | 1.1× | 342 / 171 / 114 / 49 / 49 / 49 | 21,065 | 0.0M | 132% |
| 30,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 228 / 114 / 76 / 33 / 33 / 33 | 13,933 | 0.0M | 196% |
| 30,000 teams, 7-day ramp · on-chain | — | 0 | 12.3% | 1.2× | 228 / 114 / 76 / 32 / 32 / 32 | 13,943 | 0.0M | 198% |
| Surge: 20,000 teams all on day 1 · ideal | — | 0 | 11.7% | 1.0× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 131% |
| Surge: 20,000 teams all on day 1 · on-chain | — | 0 | 12.3% | 1.5× | 49 / 49 / 49 / 49 / 49 / 49 | 17,396 | 0.0M | 132% |
| Surge: 30,000 teams all on day 1 · ideal | — | 0 | 11.7% | 1.0× | 33 / 33 / 33 / 33 / 33 / 33 | 11,750 | 0.0M | 196% |
| Surge: 30,000 teams all on day 1 · on-chain | — | 0 | 12.4% | 1.5× | 32 / 32 / 32 / 32 / 32 / 32 | 11,570 | 0.0M | 198% |
| Step: 5,000 teams, then 20,000 more join on day 20 · ideal | — | 0 | 11.5% | 1.0× | 1,250 / 686 / 458 / 196 / 34 / 31 | 79,142 | 0.0M | 209% |
| Step: 5,000 teams, then 20,000 more join on day 20 · on-chain | 60 | 0 | 11.9% | 1.2× | 1,250 / 686 / 457 / 195 / 34 / 30 | 78,959 | 0.0M | 211% |
| Exodus: 20,000 teams, 70 % leave on day 30 · ideal | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 163 / 47 | 11,794 | 0.0M | 136% |
| Exodus: 20,000 teams, 70 % leave on day 30 · on-chain | — | 0 | 12.2% | 1.2× | 342 / 171 / 114 / 49 / 163 / 47 | 12,017 | 0.0M | 138% |

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
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 40 / 40 | 20,285 | 0.0M | 159% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 14.1% | 2.0× | 429 / 168 / 112 / 48 / 48 / 48 | 21,776 | 0.0M | 135% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.8% | 1.3× | 341 / 170 / 113 / 48 / 48 / 48 | 21,297 | 0.0M | 133% |
| D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand | — | 0 | 12.1% | 1.2× | 342 / 171 / 114 / 49 / 49 / 49 | 21,047 | 0.0M | 132% |
| ON-CHAIN since D-C: D-19 + 4-epoch demand window | — | 0 | 12.2% | 1.1× | 342 / 171 / 114 / 49 / 49 / 49 | 21,065 | 0.0M | 132% |
| D-19 + 24-epoch demand window (D-C runner-up) | — | 0 | 13.6% | 1.4× | 342 / 173 / 114 / 48 / 48 / 48 | 21,424 | 0.0M | 134% |

#### 30,000 teams, 7-day ramp

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 228 / 114 / 76 / 33 / 33 / 33 | 13,933 | 0.0M | 196% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 60 | 0 | 75.5% | 8.0× | 1,250 / 875 / 613 / 147 / 2 / 2 | 28,208 | 0.0M | 3411% |
| 6 h epoch, ±30 % | — | 0 | 17.0% | 3.5× | 429 / 108 / 72 / 31 / 31 / 31 | 17,182 | 0.0M | 209% |
| 4 h epoch, ±30 % | — | 0 | 14.9% | 2.7× | 222 / 111 / 74 / 31 / 31 / 31 | 16,033 | 0.0M | 204% |
| 1 h epoch, ±30 % | — | 0 | 12.5% | 1.4× | 227 / 113 / 76 / 32 / 32 / 32 | 14,455 | 0.0M | 198% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 35.6% | 5.5× | 1,250 / 625 / 313 / 28 / 24 / 24 | 22,498 | 0.0M | 268% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 26 / 26 | 12,787 | 0.0M | 243% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 14.8% | 2.0× | 429 / 103 / 74 / 31 / 31 / 31 | 13,966 | 0.0M | 203% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.9% | 1.4× | 203 / 113 / 75 / 32 / 32 / 32 | 14,073 | 0.0M | 199% |
| D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand | — | 0 | 12.2% | 1.2× | 228 / 114 / 76 / 32 / 32 / 32 | 13,938 | 0.0M | 197% |
| ON-CHAIN since D-C: D-19 + 4-epoch demand window | — | 0 | 12.3% | 1.2× | 228 / 114 / 76 / 32 / 32 / 32 | 13,943 | 0.0M | 198% |
| D-19 + 24-epoch demand window (D-C runner-up) | — | 0 | 13.7% | 1.4× | 228 / 115 / 76 / 32 / 32 / 32 | 14,204 | 0.0M | 201% |

#### Surge: 20,000 teams all on day 1

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 131% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 4 | 56 | 100.0% | 25.5× | 1,250 / 875 / 613 / 429 / 429 / 429 | 17,625 | 0.0M | 17% |
| 6 h epoch, ±30 % | — | 0 | 39.6% | 16.2× | 429 / 103 / 33 / 33 / 33 / 33 | 17,625 | 0.0M | 191% |
| 4 h epoch, ±30 % | — | 0 | 30.0% | 12.5× | 210 / 39 / 39 / 39 / 39 / 39 | 17,625 | 0.0M | 165% |
| 1 h epoch, ±30 % | — | 0 | 16.2% | 4.0× | 46 / 46 / 46 / 46 / 46 / 46 | 17,625 | 0.0M | 138% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 84.4% | 25.5× | 1,250 / 625 / 313 / 20 / 9 / 9 | 17,625 | 0.0M | 738% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 40 / 40 | 13,151 | 0.0M | 161% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 15.4% | 2.0× | 429 / 103 / 25 / 47 / 47 / 47 | 16,461 | 0.0M | 137% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.8% | 2.0× | 39 / 48 / 48 / 48 / 48 / 48 | 17,284 | 0.0M | 133% |
| D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand | — | 0 | 12.3% | 1.4× | 49 / 49 / 49 / 49 / 49 / 49 | 17,429 | 0.0M | 132% |
| ON-CHAIN since D-C: D-19 + 4-epoch demand window | — | 0 | 12.3% | 1.5× | 49 / 49 / 49 / 49 / 49 / 49 | 17,396 | 0.0M | 132% |
| D-19 + 24-epoch demand window (D-C runner-up) | — | 0 | 13.3% | 2.0× | 70 / 37 / 48 / 48 / 48 / 48 | 17,013 | 0.0M | 134% |

#### Surge: 30,000 teams all on day 1

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 33 / 33 / 33 / 33 / 33 / 33 | 11,750 | 0.0M | 196% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 2 | 58 | 100.0% | 38.3× | 1,250 / 875 / 875 / 875 / 875 / 875 | 11,750 | 0.0M | 9% |
| 6 h epoch, ±30 % | — | 0 | 55.8% | 24.3× | 429 / 103 / 25 / 16 / 16 / 16 | 11,750 | 0.0M | 390% |
| 4 h epoch, ±30 % | — | 0 | 40.6% | 18.8× | 210 / 25 / 22 / 22 / 22 / 22 | 11,750 | 0.0M | 291% |
| 1 h epoch, ±30 % | — | 0 | 18.7% | 5.7× | 30 / 30 / 30 / 30 / 30 / 30 | 11,750 | 0.0M | 213% |
| 24 h epoch, down 50 % / up 30 % | 3 | 57 | 100.0% | 38.3× | 1,250 / 625 / 313 / 313 / 313 / 313 | 11,750 | 0.0M | 22% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 26 / 26 | 8,298 | 0.0M | 243% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 16.0% | 2.0× | 429 / 103 / 25 / 31 / 31 / 31 | 10,841 | 0.0M | 206% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.9% | 2.0× | 39 / 28 / 32 / 32 / 32 / 32 | 11,479 | 0.0M | 199% |
| D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand | — | 0 | 12.4% | 1.5× | 32 / 32 / 32 / 32 / 32 / 32 | 11,597 | 0.0M | 198% |
| ON-CHAIN since D-C: D-19 + 4-epoch demand window | — | 0 | 12.4% | 1.5× | 32 / 32 / 32 / 32 / 32 / 32 | 11,570 | 0.0M | 198% |
| D-19 + 24-epoch demand window (D-C runner-up) | — | 0 | 13.7% | 2.0× | 70 / 21 / 32 / 32 / 32 / 32 | 11,195 | 0.0M | 201% |

#### Step: 5,000 teams, then 20,000 more join on day 20

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.5% | 1.0× | 1,250 / 686 / 458 / 196 / 34 / 31 | 79,142 | 0.0M | 209% |
| before D-19: 24 h epoch, ±30 %, no ceiling | 60 | 0 | 18.8% | 3.1× | 1,250 / 1,250 / 875 / 210 / 26 / 24 | 90,924 | 0.0M | 264% |
| 6 h epoch, ±30 % | 60 | 0 | 12.5% | 2.1× | 1,250 / 683 / 454 / 194 / 33 / 29 | 81,251 | 0.0M | 218% |
| 4 h epoch, ±30 % | 60 | 0 | 12.2% | 1.7× | 1,250 / 684 / 455 / 195 / 33 / 30 | 81,383 | 0.0M | 215% |
| 1 h epoch, ±30 % | 60 | 0 | 11.7% | 1.3× | 1,250 / 686 / 458 / 196 / 34 / 30 | 79,337 | 0.0M | 211% |
| 24 h epoch, down 50 % / up 30 % | 60 | 0 | 15.7% | 3.2× | 1,250 / 1,250 / 677 / 220 / 30 / 25 | 87,944 | 0.0M | 254% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | 60 | 0 | 18.8% | 1.9× | 1,250 / 1,250 / 875 / 210 / 27 / 25 | 89,891 | 0.0M | 257% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | 60 | 0 | 12.5% | 1.9× | 1,250 / 683 / 454 / 194 / 33 / 29 | 80,982 | 0.0M | 217% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | 60 | 0 | 12.1% | 1.3× | 1,250 / 685 / 456 / 195 / 34 / 30 | 79,205 | 0.0M | 213% |
| D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand | 60 | 0 | 11.7% | 1.2× | 1,250 / 686 / 458 / 196 / 34 / 30 | 79,283 | 0.0M | 210% |
| ON-CHAIN since D-C: D-19 + 4-epoch demand window | 60 | 0 | 11.9% | 1.2× | 1,250 / 686 / 457 / 195 / 34 / 30 | 78,959 | 0.0M | 211% |
| D-19 + 24-epoch demand window (D-C runner-up) | 60 | 0 | 13.2% | 1.8× | 1,250 / 697 / 460 / 194 / 33 / 29 | 82,705 | 0.0M | 220% |

#### Exodus: 20,000 teams, 70 % leave on day 30

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 163 / 47 | 11,794 | 0.0M | 136% |
| before D-19: 24 h epoch, ±30 %, no ceiling | — | 0 | 50.3% | 5.4× | 1,250 / 875 / 613 / 147 / 18 / 90 | 31,800 | 0.0M | 72% |
| 6 h epoch, ±30 % | — | 0 | 14.7% | 2.3× | 429 / 167 / 111 / 47 / 104 / 42 | 14,706 | 0.0M | 151% |
| 4 h epoch, ±30 % | — | 0 | 13.7% | 1.9× | 338 / 168 / 112 / 48 / 161 / 45 | 13,727 | 0.0M | 142% |
| 1 h epoch, ±30 % | — | 0 | 12.2% | 1.2× | 342 / 171 / 114 / 49 / 163 / 46 | 12,276 | 0.0M | 138% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 25.0% | 3.6× | 1,250 / 625 / 313 / 49 / 42 / 22 | 20,660 | 0.0M | 286% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | 58 | 1 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 40 / 25 | 12,801 | 0.0M | 260% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 14.1% | 2.0× | 429 / 168 / 112 / 48 / 105 / 44 | 12,920 | 0.0M | 147% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.8% | 1.3× | 341 / 170 / 113 / 48 / 163 / 46 | 12,304 | 0.0M | 139% |
| D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand | — | 0 | 12.1% | 1.2× | 342 / 171 / 114 / 49 / 163 / 47 | 11,984 | 0.0M | 138% |
| ON-CHAIN since D-C: D-19 + 4-epoch demand window | — | 0 | 12.2% | 1.2× | 342 / 171 / 114 / 49 / 163 / 47 | 12,017 | 0.0M | 138% |
| D-19 + 24-epoch demand window (D-C runner-up) | — | 0 | 13.6% | 1.5× | 342 / 173 / 114 / 48 / 148 / 44 | 12,515 | 0.0M | 145% |

### 3. Recovery after the exodus (D-19 a): on-chain reward as a share of the ideal, by day

| Controller | d30 | d31 | d32 | d33 | d35 | d40 | d45 | d60 | days below 90% of ideal after d30 |
|---|---|---|---|---|---|---|---|---|---|
| before D-19: 24 h epoch, ±30 %, no ceiling | 10.9% | 14.2% | 18.4% | 24.0% | 40.5% | 55.4% | 55.4% | 191.2% | 17 |
| 6 h epoch, ±30 % | 63.6% | 98.4% | 98.4% | 98.4% | 98.4% | 98.4% | 98.4% | 89.6% | 11 |
| 4 h epoch, ±30 % | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 95.5% | 0 |
| 1 h epoch, ±30 % | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 98.2% | 0 |
| 24 h epoch, down 50 % / up 30 % | 25.5% | 33.1% | 43.0% | 55.9% | 92.3% | 92.3% | 92.3% | 47.2% | 10 |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | 24.7% | 32.1% | 41.7% | 54.2% | 89.4% | 89.4% | 89.4% | 51.8% | 19 |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | 64.1% | 99.1% | 99.1% | 99.1% | 99.1% | 99.1% | 99.1% | 92.2% | 0 |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 97.7% | 0 |
| D-19 as first shipped: 1 h epoch, ±30 %, 2× ceiling, last epoch with demand | 99.8% | 99.8% | 99.8% | 99.8% | 99.8% | 99.8% | 99.8% | 98.8% | 0 |
| ON-CHAIN since D-C: D-19 + 4-epoch demand window | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 98.4% | 0 |
| D-19 + 24-epoch demand window (D-C runner-up) | 90.6% | 99.4% | 99.4% | 99.4% | 99.4% | 99.4% | 99.4% | 93.7% | 0 |

### 4. Demand shape × demand estimator (review 2026-10-03 D-C): 20,000 teams from day 1

"Locked / spread" = GOLD earned per unit demanded by the bunched cohort vs the smooth one (phase-locked: the cohort starting on one hour in four; daily rhythm: peak-hour vs off-peak starts). Ratio 1.00 = fair. Refused starts retry next hour.

| Shape · estimator | Spent | Reward d1 / d7 / d30 / d60 | Locked / spread per unit | Ratio | Refused starts | Worst day | Unspent |
|---|---|---|---|---|---|---|---|
| smooth · last epoch with demand (D-19 as first shipped) | 100.0% | 49 / 49 / 49 / 49 | 0.0 / 49.0 | 1.00 | 2.6% | 1.40× | 0.0M |
| smooth · last 4 epochs (one expedition cycle) — ON-CHAIN since D-C | 100.0% | 49 / 49 / 49 / 49 | 0.0 / 49.0 | 1.00 | 3.3% | 1.45× | 0.0M |
| smooth · last 24 epochs (a day) | 100.0% | 70 / 48 / 48 / 48 | 0.0 / 49.0 | 1.00 | 12.3% | 1.98× | 0.0M |
| phase-locked 25 % (one hour in four) · last epoch with demand (D-19 as first shipped) | 100.0% | 63 / 62 / 57 / 14 | 53.8 / 47.3 | 1.14 | 9.1% | 1.41× | 0.0M |
| phase-locked 25 % (one hour in four) · last 4 epochs (one expedition cycle) — ON-CHAIN since D-C | 100.0% | 49 / 49 / 49 / 55 | 49.2 / 48.9 | 1.01 | 3.7% | 1.44× | 0.1M |
| phase-locked 25 % (one hour in four) · last 24 epochs (a day) | 100.0% | 70 / 48 / 48 / 55 | 49.2 / 48.9 | 1.01 | 13.2% | 1.98× | 0.1M |
| phase-locked 50 % · last epoch with demand (D-19 as first shipped) | 100.0% | 42 / 42 / 42 / 39 | 53.6 / 44.3 | 1.21 | 25.1% | 1.36× | 0.0M |
| phase-locked 50 % · last 4 epochs (one expedition cycle) — ON-CHAIN since D-C | 100.0% | 49 / 49 / 49 / 46 | 49.1 / 48.8 | 1.01 | 16.3% | 1.43× | 0.2M |
| phase-locked 50 % · last 24 epochs (a day) | 100.0% | 70 / 48 / 48 / 46 | 49.1 / 48.8 | 1.01 | 26.0% | 1.98× | 0.1M |
| phase-locked 90 % · last epoch with demand (D-19 as first shipped) | 99.8% | 39 / 40 / 44 / 97 | 49.6 / 42.0 | 1.18 | 44.4% | 1.84× | 0.8M |
| phase-locked 90 % · last 4 epochs (one expedition cycle) — ON-CHAIN since D-C | 100.0% | 49 / 49 / 49 / 36 | 49.0 / 48.7 | 1.01 | 46.5% | 1.43× | 0.2M |
| phase-locked 90 % · last 24 epochs (a day) | 100.0% | 70 / 48 / 48 / 35 | 49.0 / 48.6 | 1.01 | 56.6% | 1.98× | 0.2M |
| phase-locked 100 % · last epoch with demand (D-19 as first shipped) | 81.5% | 12 / 13 / 20 / 1,250 | 39.9 / 0.0 | 1.00 | 3.9% | 10.49× | 65.1M |
| phase-locked 100 % · last 4 epochs (one expedition cycle) — ON-CHAIN since D-C | 100.0% | 49 / 49 / 49 / 34 | 48.9 / 0.0 | 1.00 | 54.1% | 1.43× | 0.2M |
| phase-locked 100 % · last 24 epochs (a day) | 100.0% | 70 / 48 / 48 / 34 | 48.9 / 0.0 | 1.00 | 64.3% | 1.98× | 0.2M |
| daily rhythm: 60 % of starts in 8 of 24 h · last epoch with demand (D-19 as first shipped) | 100.0% | 81 / 81 / 79 / 71 | 36.5 / 67.7 | 0.54 | 11.6% | 1.33× | 0.0M |
| daily rhythm: 60 % of starts in 8 of 24 h · last 4 epochs (one expedition cycle) — ON-CHAIN since D-C | 100.0% | 81 / 81 / 78 / 67 | 38.0 / 65.4 | 0.58 | 16.4% | 1.41× | 0.0M |
| daily rhythm: 60 % of starts in 8 of 24 h · last 24 epochs (a day) | 99.9% | 70 / 48 / 48 / 121 | 49.3 / 48.4 | 1.02 | 20.1% | 1.98× | 0.3M |
| daily rhythm: 80 % of starts in 6 of 24 h · last epoch with demand (D-19 as first shipped) | 99.8% | 167 / 183 / 183 / 300 | 39.9 / 84.8 | 0.47 | 214.0% | 1.26× | 0.7M |
| daily rhythm: 80 % of starts in 6 of 24 h · last 4 epochs (one expedition cycle) — ON-CHAIN since D-C | 99.9% | 94 / 181 / 175 / 246 | 42.9 / 72.7 | 0.59 | 275.9% | 1.32× | 0.5M |
| daily rhythm: 80 % of starts in 6 of 24 h · last 24 epochs (a day) | 99.7% | 70 / 48 / 48 / 172 | 49.0 / 48.2 | 1.02 | 176.3% | 1.98× | 1.0M |
