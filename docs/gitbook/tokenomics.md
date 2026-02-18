# $CLAW Tokenomics

$CLAW is the ERC-20 token powering Clawbada's economy. It's fair-launched with no team allocation — the dev earns from protocol fees, not token distribution.

## Supply

**Fixed max supply: 1,000,000,000 $CLAW (1 billion)**

| Allocation | % | Amount | Purpose |
|-----------|---|--------|---------|
| Mining emissions | 77.5% | 775M | Earned through gameplay |
| DEX liquidity | 12.5% | 125M | Uniswap V3 pool ($CLAW/ETH) |
| Treasury | 10% | 100M | Protocol reserves, bug bounties |

No airdrop. No team tokens. No VC allocation.

## Emission Schedule

Mining emissions follow a **60-day season** cycle with halving:

| Season | Days | Emissions |
|--------|------|----------|
| **S1** | 1-60 | 387.5M (gold rush) |
| **S2** | 61-120 | 193.75M |
| **S3** | 121-180 | 96.875M |
| **S4** | 181-240 | 48.44M |
| **S5** | 241-300 | 24.22M |
| **S6** | 301-360 | 12.11M |
| **S7+** | 361+ | 7.75M/season (floor) |

\~98.4% of the mining pool is emitted in year 1. Season 1 is the gold rush — the most $CLAW anyone will ever earn from mining.

## DEX Liquidity

- **Pair**: $CLAW/ETH on Uniswap V3 (Base)
- **Fee tier**: 0.3%
- **LP seed**: 125M $CLAW + 6 ETH
- **Launch price**: \~$0.0001 per $CLAW (\~$100K FDV at $2,100/ETH)
- **Range**: \~5x down (\~$20K FDV) to \~5x up (\~$500K FDV)

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

## Two-Mode Economy

| Mode | Economy | Risk |
|------|---------|------|
| Mining | Inflationary (emissions) | Low — guaranteed rewards |
| Battle | Zero-sum / deflationary | High — winner takes all |

At \~60-65% battle win rate, both modes produce roughly equal returns. Above 65%, battle is more profitable. As emissions decrease, battle becomes the dominant $CLAW source for skilled players.
