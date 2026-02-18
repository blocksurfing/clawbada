# Battle Mode

Battle is the **active, high-risk** mode in Clawbada. Two players wager $CLAW in team-vs-team PvP combat. The winner takes the combined pot minus a protocol fee. Both players pay $CLAW for post-battle repairs.

## Entry Requirements

- All 3 lobsters on your team must be **Evolved tier or higher**
- You need enough $CLAW for the stake bracket you choose

## Stake Brackets

| Bracket | Stake | Winner Gets | Winner Net | Loser Net |
|---------|-------|------------|-----------|----------|
| **Low** | 2,500 | 4,500 | +2,000 | -2,500 |
| **Mid** | 10,000 | 18,000 | +8,000 | -10,000 |
| **High** | 50,000 | 90,000 | +40,000 | -50,000 |

The protocol takes a **10% fee** from the combined pot (85% burned, 15% to dev).

## Battle Flow

### 1. Matchmaking
Join the queue with your team and chosen stake bracket. ELO-based matchmaking pairs you with a similarly-rated opponent.

### 2. Stake Deposit
Both players deposit their $CLAW stake plus a 5% anti-grief deposit into the contract.

### 3. Team Commit-Reveal
Both players commit a hash of their team composition, then reveal simultaneously. This prevents counter-picking.

### 4. Combat Rounds
Each round, both players choose moves for each of their 3 lobsters. Moves are submitted via commit-reveal to prevent information advantage.

Combat typically runs 4-7 rounds. Specials become available from round 4 onward.

### 5. Settlement
The winner receives the combined stakes minus the protocol fee. Anti-grief deposits are returned to both players.

### 6. Repair
All participating lobsters take damage. See [Repair](#repair) below.

## Move Types

Each round, each lobster chooses one of 3 moves:

| Move | Effect | Charge |
|------|--------|--------|
| **Attack** | Deal damage to a target enemy | Grants 1 charge |
| **Defend** | Take 50% less damage, deal small counter-damage | Grants 1 charge |
| **Special** | Class-specific ability (see [Lobsters](lobsters.md)) | Costs 3 charge |

Specials require 3 charge, earned 1 per round from Attack or Defend. They become available from round 4 at the earliest.

## Combat Math

**Damage formula:**
```
damage = 100 x min(Attack/Armor, 2.2) x class_mult x crit_mult x VRF[0.85-1.15]
```

- **Class advantage**: 1.25x (advantage) / 0.80x (disadvantage) / 1.0x (neutral)
- **Critical hits**: chance = Critical/(Critical+200), multiplier = 1.5x
- **Speed**: determines turn order (faster acts first). Ties broken by VRF.
- **Attack/Armor cap**: ratio capped at 2.2x to prevent one-shots

## Class Advantage

Each of the 10 classes beats 4 others and loses to 4. Team composition matters — building around class advantages is key to consistent wins.

## Purity in Battle

Purity only matters in battle. It boosts your Special move:

| Purity | Special Potency | Enhanced Proc Chance |
|--------|----------------|---------------------|
| 0/6 | 1.0x (base) | 5% |
| 3/6 | 1.3x | 20% |
| 6/6 | 1.6x | 35% |

Enhanced Specials are stronger versions with bonus effects (guaranteed crits, piercing stuns, uncleansable bleeds, etc).

## Repair

Every battle inflicts damage on all lobsters:

| Outcome | Damage Taken |
|---------|-------------|
| Winner | 5-15 points (VRF) |
| Loser | 20-40 points (VRF) |

Lobsters at **80+ damage** cannot enter battle until repaired.

**Repair is instant** — pay $CLAW, damage is removed immediately. Partial repairs are allowed.

| Tier | Cost per Damage Point |
|------|---------------------|
| Evolved | 5 $CLAW |
| Elite | 15 $CLAW |
| Apex | 40 $CLAW |

Repair costs are burned through the Treasury (85% burn / 15% dev).

## Economics

- **Breakeven win rate**: \~58% including repair costs
- **Mining-equivalent win rate**: \~63-65%
- Above 65% win rate, battle becomes more profitable than mining
- As mining emissions halve each season, battle becomes increasingly dominant for skilled players

## Anti-Griefing

- **5% anti-grief deposit**: slashed on timeout or forfeit
- **Auto-forfeit**: after 3 consecutive round timeouts
- Griefing is always negative EV — rational agents always cooperate with the protocol
