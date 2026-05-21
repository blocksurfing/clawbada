# $CLAW Tokenomics

$CLAW is the ERC-20 token powering Clawbada's economy. It's fair-launched with no team allocation — the dev earns from protocol fees, not token distribution.

## Supply

**Fixed max supply: 1,000,000,000 $CLAW (1 billion)**

| Allocation | % | Amount | Purpose |
|-----------|---|--------|---------|
| Mining emissions | 70.5% | 705M | Earned through gameplay |
| DEX liquidity | 12.5% | 125M | Uniswap V3 pool ($CLAW/ETH) |
| Treasury | 10% | 100M | Protocol reserves, bug bounties |
| Faucet | 7% | 70M | Pre-minted onboarding drip (~10K wallets × 7K $CLAW) |

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
| **S7+** | 361+ | 7.05M/season (floor) |

\~98.4% of the mining pool is emitted in year 1. Season 1 is the gold rush — the most $CLAW anyone will ever earn from mining.

## DEX Liquidity

- **Pair**: $CLAW/ETH on Uniswap V3 (Base)
- **Fee tier**: 0.3%
- **LP seed**: 125M $CLAW + 6 ETH
- **Launch price**: \~$0.0001 per $CLAW (\~$100K FDV at $2,100/ETH)
- **Range**: \~5x down (\~$20K FDV) to \~5x up (\~$500K FDV)
- **Operational reserve**: 3.5 ETH retained for gas, emergency LP adjustments, and contract deployments. Total launch ETH budget: 9.5 ETH.

Self-deployed LP — no Clanker, no third-party extraction.

## Protocol Fee

Every protocol fee is split two ways:

| Recipient | Share | Purpose |
|-----------|-------|---------|
| **Burn** | 85% | Deflationary pressure |
| **Dev wallet** | 15% | Ongoing development |

Applied to: mining settlement, breeding fees, marketplace trades, battle settlement, repairs, evolution costs.

## Token Sinks

$CLAW is designed to be **net deflationary**:

| Sink | Mechanism |
|------|-----------|
| **Battle stakes** | Protocol fee burned each match |
| **Battle repair** | All combatants burn $CLAW to fix damage |
| **Evolution** | 2K / 10K / 50K $CLAW burned per tier |
| **Breeding** | Costs scale exponentially by generation |
| **Protocol fees** | 85% of all fees burned |

As mining emissions halve each season, sinks increasingly outpace new supply.

## Token Locks

While playing, your $CLAW and lobsters can be locked into active game state:

| What | Lock Trigger | Released When |
|------|-------------|--------------|
| **Mining stake** | Sending a team on an expedition | Expedition completes (4 hours) and you claim |
| **Battle stake** | Joining a battle queue at a stake bracket | Battle settles (winner takes pot, loser's stake transferred) |
| **Anti-grief deposit** | 5% of stake on entering battle | Returned after settlement, slashed on timeout/forfeit |
| **Lobster (team)** | Assigned to a team slot | Removed from the team |
| **Lobster (mining)** | On an active expedition | Expedition claimed |
| **Lobster (battle)** | In an active battle | Battle settled |

Locked lobsters cannot be sold or transferred on the marketplace.

## No Passive Yield

Clawbada has **no ve-CLAW**, no staking yield, and no governance rewards. The only way to earn $CLAW is by playing — mining, winning battles, or breeding/selling lobsters. This keeps the token explicitly **not a security**: there is no expectation of profit from the efforts of others, and no passive return for holding.

## Two-Mode Economy

| Mode | Economy | Risk |
|------|---------|------|
| Mining | Inflationary (emissions) | Low — guaranteed rewards |
| Battle | Zero-sum / deflationary | High — winner takes all |

At \~60-65% battle win rate, both modes produce roughly equal returns. Above 65%, battle is more profitable. As emissions decrease, battle becomes the dominant $CLAW source for skilled players.
