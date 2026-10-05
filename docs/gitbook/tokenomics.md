# $GOLD Tokenomics

**$GOLD — Grubby Old Lost Doubloons** — is the ERC-20 token powering Clawbada's economy. It's fair-launched with no team allocation — the dev earns from protocol fees, not token distribution.

## Supply

**Fixed max supply: 1,000,000,000 $GOLD (1 billion)**

| Allocation | % | Amount | Purpose |
|-----------|---|--------|---------|
| Mining emissions | 70.5% | 705M | Earned through gameplay — a **hard lifetime cap enforced on-chain**; mining stops when it is spent |
| DEX liquidity | 12.5% | 125M | Uniswap V3 pool ($GOLD/ETH) |
| Treasury | 10% | 100M | Protocol reserves, bug bounties |
| Faucet | 7% | 70M | Pre-minted onboarding drip (~10K wallets × 7K $GOLD). **Unclaimed funds are burned** when the faucet closes (6 days 23 hours after the game opens) — the burn is the only thing the contract can do with them; nobody can redirect them. |

No airdrop. No team tokens. No VC allocation.

## Emission Schedule

Mining emissions follow a **60-day season** cycle with halving:

| Season | Days | Emissions |
|--------|------|----------|
| **S1** | 1-60 | 352.5M (gold rush) |
| **S2** | 61-120 | 176.25M |
| **S3** | 121-180 | 88.125M |
| **S4** | 181-240 | 44.06M |
| **S5** | 241-300 | 22.03M |
| **S6** | 301-360 | 11.02M |
| **S7** | 361-420 | 7.05M (cumulative 701.0M) |
| **S8+** | 421+ | ≤3.97M, then **0** — the 705M allocation is spent and mining emissions end |

\~98.4% of the mining pool is emitted in year 1. Season 1 is the gold rush — the most $GOLD anyone will ever earn from mining. There is no perpetual floor: once the 705M allocation is distributed, the economy is purely zero-sum battle redistribution plus fee burns.

### How the mining rate is set

Every expedition pays a fixed amount, locked when it starts: the current `baseReward` × the mine tier's weight (1× / 3× / 10× / 25×). The `baseReward` itself re-pegs **once an hour** to what the season can afford — the remaining budget divided by the remaining hours and the average demand of the last four hours — moving at most ±30% per hour and never above the season's launch value (1,250 $GOLD in S1). On top of that, no hour may mint more than twice its fair share of what is left; in a genuine rush the last expeditions of the hour wait for the next one. Crowding therefore compresses everyone's yield smoothly instead of exhausting the budget early. Battle-rank boosts (+10% to +50% on a team's own mining, see [Battle](battle.md)) are paid from the same budget through the same glide. The full mechanics are in [Mining](mining.md).

### Prices that follow the rate

Two other prices are pegged to the mining rate so the economy stays proportionate as yields glide:

- **Repair** costs 0.40% / 1.20% / 3.20% of the current `baseReward` per damage point (Evolved / Elite / Apex) — 5 / 15 / 40 $GOLD at launch.
- **Battle stakes** are 2× / 8× / 40× of a unit that is 20% the launch reward (fixed forever) and 80% the base reward sampled once a day, floored to whole $GOLD and never above the launch values of 2,500 / 10,000 / 50,000. The 20% anchor is a governance dial behind a 24-hour timelock.

## DEX Liquidity

- **Pair**: $GOLD/ETH on Uniswap V3 (Base)
- **Fee tier**: 0.3%
- **LP seed**: 125M $GOLD + 6 ETH
- **Launch price**: \~$0.0001 per $GOLD (\~$100K FDV at $2,100/ETH)
- **Range**: \~5x down (\~$20K FDV) to \~5x up (\~$500K FDV)
- **Operational reserve**: 3.5 ETH retained for gas, emergency LP adjustments, and contract deployments. Total launch ETH budget: 9.5 ETH.

Self-deployed LP — no Clanker, no third-party extraction.

## Protocol Fee

Every protocol fee is split two ways:

| Recipient | Share | Purpose |
|-----------|-------|---------|
| **Burn** | 85% | Deflationary pressure |
| **Dev wallet** | 15% | Ongoing development |

Applied to: battle settlement (10% of the combined pot; a draw pays the same total, half from each side), repairs, evolution costs, breeding fees, marketplace trades, and the 5% anti-grief deposits forfeited by players who resign, time out or fail their team reveal.

## Token Sinks

$GOLD is designed to be **net deflationary**:

| Sink | Mechanism |
|------|-----------|
| **Battle stakes** | 10% of every pot is the protocol fee, 85% of it burned |
| **Battle repair** | All combatants burn $GOLD to fix damage (rates pegged to the mining rate) |
| **Evolution** | 2K / 10K / 50K $GOLD burned per tier, plus two fuel lobsters destroyed |
| **Breeding** | Costs scale exponentially by generation |
| **Protocol fees** | 85% of all fees burned |
| **Frozen results** | A battle result the Safe never resolves is closed after 72 hours by burning the held stakes (players are repaid from a reserve) |
| **Faucet residual** | Everything unclaimed when the faucet closes |

As mining emissions halve each season, sinks increasingly outpace new supply; once the 705M allocation is spent there is no new supply at all.

## Token Locks

While playing, your $GOLD and lobsters can be locked into active game state:

| What | Lock Trigger | Released When |
|------|-------------|--------------|
| **Mining stake** | Sending a team on an expedition | Expedition completes (4 hours) and you claim |
| **Battle stake** | Depositing for a match (the amount is fixed when the match is created) | Paid out after the result's review window — 5 min (Low) / 30 min (Mid) / 1 hour (High). A frozen result is resolved by the governance Safe within 72 hours, or both players are repaid from a reserve |
| **Anti-grief deposit** | 5% of stake, deposited with it | Returned with the payout; forfeited by a player who resigns, times out three turns in a row, or fails to open a playable team commit |
| **Lobster (team)** | Assigned to a team slot | Removed from the team |
| **Lobster (mining)** | On an active expedition | Expedition claimed |
| **Lobster (battle)** | In a battle being played | The moment the result is recorded on-chain — before the payout, review or any freeze |

Locked lobsters cannot be sold or transferred on the marketplace.

## No Passive Yield

Clawbada has **no ve-GOLD**, no staking yield, and no governance rewards. The only way to earn $GOLD is by playing — mining, winning battles, or breeding/selling lobsters. This keeps the token explicitly **not a security**: there is no expectation of profit from the efforts of others, and no passive return for holding.

## Two-Mode Economy

| Mode | Economy | Risk |
|------|---------|------|
| Mining | Inflationary (emissions) | Low — guaranteed rewards |
| Battle | Zero-sum / deflationary | High — winner takes the pot minus the 10% fee; both sides pay repairs |

At \~60-65% battle win rate, both modes produce roughly equal returns (breakeven is \~58% including repairs). Above 65%, battle is more profitable. As emissions decrease, battle becomes the dominant $GOLD source for skilled players.
