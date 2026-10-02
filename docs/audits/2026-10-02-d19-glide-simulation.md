# D-19 — the mining-reward glide as the contract runs it (simulation, 2026-10-02)

**Decision needed before the first deploy.** The daily reward glide, as written in `MiningPool`, cannot keep up with a crowd. Any adoption above roughly 6,000 teams spends far more than its share of the season budget in the first week, and a large day-one surge empties the whole 60-day budget within days. The fix is small (two constants and one check) but it changes the contract, and the contracts cannot be changed after launch.

**Recommendation:** re-peg every **hour** instead of every day, add a **per-epoch spend ceiling** of 2× the fair share, and close the "exhausted budget" hold's gap. With those three changes the contract tracks the ideal glide within 1–2% in every scenario modelled, including 30,000 teams arriving on day one.

## What the glide is meant to do

Each season has a fixed budget (352.5M CLAW in Season 1). The glide re-sets the reward per expedition so the budget lasts the full 60 days: the more teams mine, the lower the reward. The design was validated with a simulator (`season.ts`) that re-pegs *exactly* every day from that day's demand.

The contract differs in three ways the audit flagged (D-19): it re-pegs from the **previous** day's demand, it can move the rate at most **±30% per day**, and it does **nothing on day one**. The launch rate (1,250 CLAW per Base expedition) is sized for about 800 teams; for 20,000 teams the sustainable rate is 49. At 30% a day, getting from 1,250 to 49 takes nine days — and the crowd mines at 5–25× the sustainable rate the whole time.

## What the numbers say

Same populations, idealised daily glide vs the deployed controller (7-day faucet ramp, 50% of income retained for upgrades, boost on the same budget):

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

### Candidate contract changes

| Controller | Spent by day 7: 20K ramp / 30K ramp / 20K surge / 30K surge | Worst day | Day-60 reward (ideal 49 / 33 / 49 / 33) | Days to recover after the exodus |
|---|---|---|---|---|
| **Deployed: 24 h epoch, ±30%** | 50% / 76% / dry day 4 / dry day 2 | 5–38× | 18 / 2 / — / — | 17 |
| 24 h, down 50% / up 30% | 25% / 36% / 84% / dry day 3 | 4–38× | 30 / 24 / 9 / — | 10 |
| 24 h, 2× spend ceiling | 22% / 22% / 22% / 22% | 2.0× | 42 / 27 / 42 / 27 | 9 |
| 6 h epoch | 15% / 17% / 40% / 56% | 2–24× | 47 / 31 / 33 / 16 | 11 |
| 4 h epoch | 14% / 15% / 30% / 41% | 2–19× | 48 / 31 / 39 / 22 | 0 |
| 1 h epoch | 12% / 13% / 16% / 19% | 1.2–5.7× | 49 / 32 / 46 / 30 | 0 |
| 6 h epoch + 2× ceiling | 14% / 15% / 15% / 15% | 1.7–2.0× | 48 / 32 / 47 / 31 | 0 |
| 4 h epoch, down 50%, 2× ceiling | 13% / 13% / 13% / 13% | 1.3–1.9× | 48 / 32 / 48 / 32 | 0 |
| **1 h epoch + 2× ceiling** | **12% / 12% / 12% / 12%** | **1.1–1.4×** | **49 / 32 / 49 / 32** | **0** |

Reading it:
- **The epoch length is the main lever.** A shorter epoch lets the rate find the crowd within hours instead of days, and fixes the slow recovery (D-19 a) as a side effect.
- **A shorter epoch alone is not enough for a surge.** The first epoch of a season is always blind at the launch rate; at 4 h that one blind epoch still costs 30–40% of the budget if 20–30 thousand teams arrive at once.
- **The ceiling is the backstop.** It bounds what any epoch can mint regardless of the rate, so no surge — modelled or not — can drain the season. With 1 h epochs it almost never binds (worst day 1.4× against a 2× cap).
- Widening the downward step helps on its own but cannot rescue the day-one case.

### Recommended change (MiningPool, before the first deploy)

1. `REPEG_EPOCH`: 1 day → **1 hour**. The arithmetic already works in epochs (D-18), so this is a constant change plus renaming `remainingDays` to `remainingEpochs`; the glide tests and the D-30 fuzz reference model (`FuzzMiningGlide.t.sol`, which hard-codes `1 days` and `60`) move to the new constants.
2. **Per-epoch spend ceiling:** `startExpedition` reverts (new error, e.g. `EpochBudgetFull`) when this epoch's minted total would exceed `2 × (remaining / epochsLeft)`. Track `epochMinted` alongside `epochWeightServed` (reset on re-peg).
3. **Close the D-19(c) gap:** hold the rate when `remaining < baseReward` (nothing can start), not only when `remaining == 0`. See below.

What players would see: in a genuine rush (tens of thousands of teams in one hour) some expeditions get "the mine is full until the next hour" instead of starting. The API, agent kit and web need to show that plainly. Outside such a rush nothing changes except that the reward adjusts hourly instead of daily (repair prices, a percentage of the reward, move with it).

**Minimal alternative:** the 1 h epoch alone (one constant). It keeps the budget alive in every scenario modelled and tracks the ideal within 2% except in a day-one surge of 30,000 teams, where it spends 19% of the budget in the first week (worst hour 5.7× its share). It gives no guarantee against something larger than modelled — a whale fielding a thousand Apex teams on day one, say — which is what the ceiling is for.

## A second finding: the "exhausted budget holds the rate" fix (#99) has a gap

D-19(c) said that after an exhaustion the glide should not keep walking the reward down 30% a day (repair prices are a percentage of the reward, so they would become nearly free). The fix holds the rate when `remaining == 0` — **exactly** zero. Expeditions are discrete, so an exhausted season normally keeps a remainder smaller than one reward, and with it the decay continues. Reproduced on the contract itself (probe test, not committed): a 6.5-reward season, six expeditions, half a reward left → the rate goes 1,250 → 875 → 612 → 429 on consecutive days and 300 after a quiet stretch, and once it has fallen below the remainder an expedition can start again at the depressed rate.

With the ceiling above, a mid-season exhaustion cannot happen, so this only matters at the natural end of a season — but it is a one-line fix (`if (remaining < season.baseReward) return;`) and should go in with the rest.

## How this was modelled

- `packages/game-logic/src/v3/season-glide.ts`: the controller in integer wei math, mirroring `MiningPool._repegIfNeeded` via the fuzz suite's reference model; `v3-season-glide.test.ts` pins it to the contract's own test vectors (the 1,250 → 875 clamp, the launch cap, the admin-override snap-back) and to the step properties over 2,000 random states. The population dynamics are `season.ts`'s (ramp, tiers, retention, upgrades, boost) plus join/leave events.
- `bun run season:glide` regenerates every table below. The levers (`epochHours`, `upStepBps`, `downStepBps`, `epochSpendCapX`) are what a contract change would set, so a change can be re-checked on the same populations.
- Limits: expeditions are continuous (an epoch that cannot pay everyone pays the fraction it can — on-chain the excess reverts, first come first served); the upgrade-cost figures are the assumption `season.ts` makes; the boost is a flat expected +15% on Evolved+. The controller itself is exact.

## Appendix — full tables (`bun run season:glide`)

### 1. Ideal glide vs the contract, same populations

| Scenario · mode | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| Design rate: 800 teams, 7-day ramp · ideal | — | 0 | 7.7% | 1.0× | 1,250 / 1,250 / 1,250 / 624 / 159 / 111 | 667,499 | 0.0M | 59% |
| Design rate: 800 teams, 7-day ramp · on-chain | — | 0 | 9.1% | 1.5× | 1,250 / 1,250 / 1,250 / 842 / 151 / 103 | 669,885 | 0.0M | 64% |
| Faucet scale: 6,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 1,143 / 571 / 381 / 163 / 80 / 47 | 95,674 | 0.0M | 136% |
| Faucet scale: 6,000 teams, 7-day ramp · on-chain | 60 | 0 | 20.8% | 2.1× | 1,250 / 1,141 / 799 / 192 / 70 / 44 | 113,925 | 0.0M | 145% |
| 15,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 457 / 228 / 152 / 65 / 65 / 48 | 33,350 | 0.0M | 133% |
| 15,000 teams, 7-day ramp · on-chain | 60 | 0 | 37.7% | 4.0× | 1,250 / 875 / 613 / 147 / 33 / 25 | 56,431 | 0.0M | 252% |
| 20,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 49 / 49 | 20,900 | 0.0M | 131% |
| 20,000 teams, 7-day ramp · on-chain | 60 | 0 | 50.3% | 5.4× | 1,250 / 875 / 613 / 147 / 18 / 18 | 43,223 | 0.0M | 358% |
| 30,000 teams, 7-day ramp · ideal | — | 0 | 11.7% | 1.0× | 228 / 114 / 76 / 33 / 33 / 33 | 13,933 | 0.0M | 196% |
| 30,000 teams, 7-day ramp · on-chain | 60 | 0 | 75.5% | 8.0× | 1,250 / 875 / 613 / 147 / 2 / 2 | 28,208 | 0.0M | 3411% |
| Surge: 20,000 teams all on day 1 · ideal | — | 0 | 11.7% | 1.0× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 131% |
| Surge: 20,000 teams all on day 1 · on-chain | 4 | 56 | 100.0% | 25.5× | 1,250 / 875 / 613 / 429 / 429 / 429 | 17,625 | 0.0M | 17% |
| Surge: 30,000 teams all on day 1 · ideal | — | 0 | 11.7% | 1.0× | 33 / 33 / 33 / 33 / 33 / 33 | 11,750 | 0.0M | 196% |
| Surge: 30,000 teams all on day 1 · on-chain | 2 | 58 | 100.0% | 38.3× | 1,250 / 875 / 875 / 875 / 875 / 875 | 11,750 | 0.0M | 9% |
| Step: 5,000 teams, then 20,000 more join on day 20 · ideal | — | 0 | 11.5% | 1.0× | 1,250 / 686 / 458 / 196 / 34 / 31 | 79,142 | 0.0M | 209% |
| Step: 5,000 teams, then 20,000 more join on day 20 · on-chain | 60 | 0 | 18.8% | 3.1× | 1,250 / 1,250 / 875 / 210 / 26 / 24 | 90,924 | 0.0M | 264% |
| Exodus: 20,000 teams, 70 % leave on day 30 · ideal | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 163 / 47 | 11,794 | 0.0M | 136% |
| Exodus: 20,000 teams, 70 % leave on day 30 · on-chain | — | 0 | 50.3% | 5.4× | 1,250 / 875 / 613 / 147 / 18 / 90 | 31,800 | 0.0M | 72% |

### 2. Candidate contract changes on the hard cases

### 20,000 teams, 7-day ramp

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 49 / 49 | 20,900 | 0.0M | 131% |
| on-chain today: 24 h epoch, ±30 % | 60 | 0 | 50.3% | 5.4× | 1,250 / 875 / 613 / 147 / 18 / 18 | 43,223 | 0.0M | 358% |
| 6 h epoch, ±30 % | — | 0 | 14.7% | 2.3× | 429 / 167 / 111 / 47 / 47 / 47 | 23,498 | 0.0M | 136% |
| 4 h epoch, ±30 % | — | 0 | 13.7% | 1.9× | 338 / 168 / 112 / 48 / 48 / 48 | 22,624 | 0.0M | 134% |
| 1 h epoch, ±30 % | — | 0 | 12.2% | 1.2× | 342 / 171 / 114 / 49 / 49 / 49 | 21,330 | 0.0M | 132% |
| 1 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 12.0% | 1.1× | 342 / 171 / 114 / 49 / 49 / 49 | 21,173 | 0.0M | 132% |
| 24 h epoch, down 50 % / up 30 % | 60 | 0 | 25.0% | 3.6× | 1,250 / 625 / 313 / 49 / 42 / 30 | 34,983 | 0.0M | 212% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 42 / 42 | 24,078 | 0.0M | 154% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 13.9% | 1.8× | 429 / 168 / 112 / 48 / 48 / 48 | 22,542 | 0.0M | 135% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.7% | 1.3× | 341 / 170 / 113 / 48 / 48 / 48 | 21,590 | 0.0M | 133% |

### 30,000 teams, 7-day ramp

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 228 / 114 / 76 / 33 / 33 / 33 | 13,933 | 0.0M | 196% |
| on-chain today: 24 h epoch, ±30 % | 60 | 0 | 75.5% | 8.0× | 1,250 / 875 / 613 / 147 / 2 / 2 | 28,208 | 0.0M | 3411% |
| 6 h epoch, ±30 % | — | 0 | 17.0% | 3.5× | 429 / 108 / 72 / 31 / 31 / 31 | 17,182 | 0.0M | 209% |
| 4 h epoch, ±30 % | — | 0 | 14.9% | 2.7× | 222 / 111 / 74 / 31 / 31 / 31 | 16,033 | 0.0M | 204% |
| 1 h epoch, ±30 % | — | 0 | 12.5% | 1.4× | 227 / 113 / 76 / 32 / 32 / 32 | 14,455 | 0.0M | 198% |
| 1 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 12.1% | 1.2× | 228 / 114 / 76 / 32 / 32 / 32 | 14,170 | 0.0M | 197% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 35.6% | 5.5× | 1,250 / 625 / 313 / 28 / 24 / 24 | 22,498 | 0.0M | 268% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 27 / 27 | 16,052 | 0.0M | 236% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 14.5% | 2.0× | 429 / 111 / 74 / 32 / 32 / 32 | 15,357 | 0.0M | 203% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.9% | 1.4× | 227 / 113 / 75 / 32 / 32 / 32 | 14,497 | 0.0M | 199% |

### Surge: 20,000 teams all on day 1

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 131% |
| on-chain today: 24 h epoch, ±30 % | 4 | 56 | 100.0% | 25.5× | 1,250 / 875 / 613 / 429 / 429 / 429 | 17,625 | 0.0M | 17% |
| 6 h epoch, ±30 % | — | 0 | 39.6% | 16.2× | 429 / 103 / 33 / 33 / 33 / 33 | 17,625 | 0.0M | 191% |
| 4 h epoch, ±30 % | — | 0 | 30.0% | 12.5× | 210 / 39 / 39 / 39 / 39 / 39 | 17,625 | 0.0M | 165% |
| 1 h epoch, ±30 % | — | 0 | 16.2% | 4.0× | 46 / 46 / 46 / 46 / 46 / 46 | 17,625 | 0.0M | 138% |
| 1 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 12.2% | 1.3× | 49 / 49 / 49 / 49 / 49 / 49 | 17,625 | 0.0M | 132% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 84.4% | 25.5× | 1,250 / 625 / 313 / 20 / 9 / 9 | 17,625 | 0.0M | 738% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 42 / 42 | 17,625 | 0.0M | 154% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 14.8% | 2.0× | 429 / 103 / 47 / 47 / 47 / 47 | 17,625 | 0.0M | 136% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.8% | 1.8× | 48 / 48 / 48 / 48 / 48 / 48 | 17,625 | 0.0M | 133% |

### Surge: 30,000 teams all on day 1

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 33 / 33 / 33 / 33 / 33 / 33 | 11,750 | 0.0M | 196% |
| on-chain today: 24 h epoch, ±30 % | 2 | 58 | 100.0% | 38.3× | 1,250 / 875 / 875 / 875 / 875 / 875 | 11,750 | 0.0M | 9% |
| 6 h epoch, ±30 % | — | 0 | 55.8% | 24.3× | 429 / 103 / 25 / 16 / 16 / 16 | 11,750 | 0.0M | 390% |
| 4 h epoch, ±30 % | — | 0 | 40.6% | 18.8× | 210 / 25 / 22 / 22 / 22 / 22 | 11,750 | 0.0M | 291% |
| 1 h epoch, ±30 % | — | 0 | 18.7% | 5.7× | 30 / 30 / 30 / 30 / 30 / 30 | 11,750 | 0.0M | 213% |
| 1 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 12.3% | 1.4× | 32 / 32 / 32 / 32 / 32 / 32 | 11,750 | 0.0M | 197% |
| 24 h epoch, down 50 % / up 30 % | 3 | 57 | 100.0% | 38.3× | 1,250 / 625 / 313 / 313 / 313 / 313 | 11,750 | 0.0M | 22% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 27 / 27 | 11,750 | 0.0M | 236% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 15.3% | 2.0× | 429 / 103 / 31 / 31 / 31 / 31 | 11,750 | 0.0M | 204% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.9% | 1.9× | 39 / 32 / 32 / 32 / 32 / 32 | 11,750 | 0.0M | 199% |

### Step: 5,000 teams, then 20,000 more join on day 20

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.5% | 1.0× | 1,250 / 686 / 458 / 196 / 34 / 31 | 79,142 | 0.0M | 209% |
| on-chain today: 24 h epoch, ±30 % | 60 | 0 | 18.8% | 3.1× | 1,250 / 1,250 / 875 / 210 / 26 / 24 | 90,924 | 0.0M | 264% |
| 6 h epoch, ±30 % | 60 | 0 | 12.5% | 2.1× | 1,250 / 683 / 454 / 194 / 33 / 29 | 81,251 | 0.0M | 218% |
| 4 h epoch, ±30 % | 60 | 0 | 12.2% | 1.7× | 1,250 / 684 / 455 / 195 / 33 / 30 | 81,383 | 0.0M | 215% |
| 1 h epoch, ±30 % | 60 | 0 | 11.7% | 1.3× | 1,250 / 686 / 458 / 196 / 34 / 30 | 79,337 | 0.0M | 211% |
| 1 h epoch, ±30 %, 2× epoch spend ceiling | 60 | 0 | 11.7% | 1.1× | 1,250 / 686 / 458 / 196 / 34 / 30 | 79,332 | 0.0M | 210% |
| 24 h epoch, down 50 % / up 30 % | 60 | 0 | 15.7% | 3.2× | 1,250 / 1,250 / 677 / 220 / 30 / 25 | 87,944 | 0.0M | 254% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | 60 | 0 | 18.8% | 1.9× | 1,250 / 1,250 / 875 / 210 / 27 / 25 | 90,922 | 0.0M | 251% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | 60 | 0 | 12.5% | 1.7× | 1,250 / 683 / 454 / 194 / 33 / 30 | 81,238 | 0.0M | 216% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | 60 | 0 | 12.1% | 1.3× | 1,250 / 685 / 456 / 195 / 34 / 30 | 79,293 | 0.0M | 212% |

### Exodus: 20,000 teams, 70 % leave on day 30

| Controller | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |
|---|---|---|---|---|---|---|---|---|
| ideal (reference) | — | 0 | 11.7% | 1.0× | 343 / 171 / 114 / 49 / 163 / 47 | 11,794 | 0.0M | 136% |
| on-chain today: 24 h epoch, ±30 % | — | 0 | 50.3% | 5.4× | 1,250 / 875 / 613 / 147 / 18 / 90 | 31,800 | 0.0M | 72% |
| 6 h epoch, ±30 % | — | 0 | 14.7% | 2.3× | 429 / 167 / 111 / 47 / 104 / 42 | 14,706 | 0.0M | 151% |
| 4 h epoch, ±30 % | — | 0 | 13.7% | 1.9× | 338 / 168 / 112 / 48 / 161 / 45 | 13,727 | 0.0M | 142% |
| 1 h epoch, ±30 % | — | 0 | 12.2% | 1.2× | 342 / 171 / 114 / 49 / 163 / 46 | 12,276 | 0.0M | 138% |
| 1 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 12.0% | 1.1× | 342 / 171 / 114 / 49 / 163 / 47 | 12,105 | 0.0M | 137% |
| 24 h epoch, down 50 % / up 30 % | — | 0 | 25.0% | 3.6× | 1,250 / 625 / 313 / 49 / 42 / 22 | 20,660 | 0.0M | 286% |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 22.1% | 2.0× | 1,250 / 875 / 613 / 147 / 42 / 21 | 16,347 | 0.0M | 310% |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | — | 0 | 13.9% | 1.8× | 429 / 168 / 112 / 48 / 105 / 44 | 13,665 | 0.0M | 145% |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | — | 0 | 12.7% | 1.3× | 341 / 170 / 113 / 48 / 163 / 46 | 12,595 | 0.0M | 139% |

### 3. Recovery after the exodus (D-19 a): on-chain reward as a share of the ideal, by day

| Controller | d30 | d31 | d32 | d33 | d35 | d40 | d45 | d60 | days below 90% of ideal after d30 |
|---|---|---|---|---|---|---|---|---|---|
| on-chain today: 24 h epoch, ±30 % | 10.9% | 14.2% | 18.4% | 24.0% | 40.5% | 55.4% | 55.4% | 191.2% | 17 |
| 6 h epoch, ±30 % | 63.6% | 98.4% | 98.4% | 98.4% | 98.4% | 98.4% | 98.4% | 89.6% | 11 |
| 4 h epoch, ±30 % | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 98.9% | 95.5% | 0 |
| 1 h epoch, ±30 % | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 99.7% | 98.2% | 0 |
| 1 h epoch, ±30 %, 2× epoch spend ceiling | 99.9% | 99.9% | 99.9% | 99.9% | 99.9% | 99.9% | 99.9% | 99.0% | 0 |
| 24 h epoch, down 50 % / up 30 % | 25.5% | 33.1% | 43.0% | 55.9% | 92.3% | 92.3% | 92.3% | 47.2% | 10 |
| 24 h epoch, ±30 %, 2× epoch spend ceiling | 25.5% | 33.1% | 43.0% | 56.0% | 92.4% | 92.4% | 92.4% | 43.4% | 9 |
| 6 h epoch, ±30 %, 2× epoch spend ceiling | 64.2% | 99.3% | 99.3% | 99.3% | 99.3% | 99.3% | 99.3% | 93.4% | 0 |
| 4 h epoch, down 50 % / up 30 %, 2× ceiling | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 97.8% | 0 |

