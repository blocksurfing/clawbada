# Mining

Mining is the **idle, low-risk** mode in Clawbada. Send a team of 3 lobsters on an expedition, wait 4 hours, and claim a fixed $CLAW reward.

## How It Works

1. Assign 3 lobsters to a team (see [Teams](#teams))
2. Choose a mine tier your team qualifies for
3. Start an expedition — your reward is locked in at the start
4. Wait 4 hours
5. Claim your $CLAW

Each team can run **6 expeditions per day** (one every 4 hours). You can have unlimited teams running simultaneously.

## Mine Tiers

Higher tiers require evolved lobsters but pay proportionally more.

| Mine | Requirement | Reward per Expedition |
|------|------------|----------------------|
| **Base** | All 3 lobsters at Base tier | 1,250 $CLAW |
| **Evolved** | All 3 lobsters at Evolved+ | 3,750 $CLAW |
| **Elite** | All 3 lobsters at Elite+ | 12,500 $CLAW |
| **Apex** | All 3 lobsters at Apex | 31,250 $CLAW |

**Tier gate**: all 3 lobsters on your team must meet the mine's minimum tier. You can exceed the minimum — for example, 2 Elite + 1 Apex works for the Elite mine.

## Rewards

Rewards are **locked at expedition start** — when your expedition begins, you know exactly what it will pay, and nothing changes that. There is no pro-rata splitting within an expedition.

The reward *rate* glides: `baseReward` re-pegs automatically once per day to `remaining budget ÷ (remaining days × yesterday's demand)`, moving at most ±30% per day and never above the season's launch value (S1 launch: 1,250 $CLAW). When the mines get crowded, everyone's yield drifts down smoothly; when they empty out, it drifts back up toward the launch rate. The table above shows launch-rate values.

## Battle-Rank Boost

Teams that battle earn more from mining. Once a week, every team that played at least the published floor of ranked battles (7 per week at launch, rising to 14 once the ladder is liquid) is placed on a single ladder by its battle rating. For the following week:

| Ladder position | Boost on that team's own mining income |
|---|---|
| Bottom of the qualified ladder | **+10%** |
| Middle | **+30%** |
| Top | **+50%** |

Everyone in between sits on the straight line between +10% and +50%. The boost is applied to every expedition the team starts that week, at every mine tier.

Rules worth knowing:

- **It is your team's own income.** The boost multiplies that team's reward; it does not create a shared prize pool.
- **Play, don't necessarily win.** Qualifying counts battles played; rank decides the size.
- **Miss the floor, lose the boost.** Skip a week and the boost is 0 the following week. Your rating survives (it drifts back toward the starting rating while you are away).
- **It is bound to your roster.** The boost is tied to the Team Power it was earned at. Evolve a lobster mid-week and the boost pauses until the team re-qualifies at its new Power.
- **It cannot go stale.** A posted week only pays for 10 days. If the ladder is ever not posted, every boost drops to 0 on its own.

Where the money comes from: the same season budget. Boosted expeditions count as extra demand in the daily glide, so the boost is paid by a slightly faster glide for everyone, not by new emissions. Battle → *Battle Rank & Mining Boost* has the full rules.

## Season Budget

Each season has a total emission budget — Season 1 has 352.5M $CLAW. The daily glide paces spending so the budget lasts the full 60 days: crowding compresses per-team yield instead of halting mining mid-season. (The hard budget check still exists on-chain as a backstop, but under the glide it is not expected to trigger.)

## Teams

- Teams require exactly **3 lobsters**
- Unlimited team slots per wallet
- Lobsters are locked while on a team or active expedition
- Duplicate classes on a team are allowed
- A team can mine any tier where all 3 members meet the minimum

## Tips

- Faucet lobsters start at Base tier — evolve them to Evolved to unlock 3x rewards
- Running multiple teams in parallel multiplies your mining output
- Mining rewards are guaranteed — no risk of loss (unlike battle)
- Damaged lobsters can still mine (damage only gates battle entry)
