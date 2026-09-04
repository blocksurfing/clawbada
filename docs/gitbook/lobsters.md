# Lobsters

Lobsters are the characters in Clawbada. Each lobster is an **ERC-1155 NFT** with on-chain DNA that determines its class, stats, appearance, and genetic potential.

## 10 Classes

Each class has a unique stat spread and Special move. The 10 classes form a balanced tournament graph where every class beats 4 others and loses to 4 — there is no dominant class.

| # | Class | Role | Special Move | Description |
|---|-------|------|-------------|-------------|
| 1 | **Bulwark** | Tank | Fortify | Team-wide damage reduction |
| 2 | **Mantis** | Assassin | Ambush | Armor-piercing single target |
| 3 | **Leviathan** | Bruiser | Crush | Massive single-target burst |
| 4 | **Tempest** | Nuker | Maelstrom | AoE damage to all enemies |
| 5 | **Specter** | Debuffer | Haunt | Reduce target stats for 4 turns of target |
| 6 | **Sentinel** | Support | Rally | Heal + cleanse an ally |
| 7 | **Reaver** | DPS | Rend | Bleed damage over 6 turns of target |
| 8 | **Abyss** | Lifesteal | Devour | Damage enemy, heal self |
| 9 | **Kraken** | Controller | Bind | Stun target for 1 turn (then 2-turn immunity) |
| 10 | **Ember** | Glass Cannon | Inferno | Highest burst, self-damage |

## Stats

Every lobster has 5 stats:

| Stat | Role |
|------|------|
| **HP** | Health pool. Lobster dies at 0. |
| **Attack** | Offense. Higher = more damage dealt. |
| **Armor** | Defense. Higher = less damage taken. |
| **Speed** | Turn order. Faster lobsters act first. |
| **Critical** | Crit chance. Crits deal 1.5x damage. |

Stats are determined by: **base class stats** + **body part modifiers** + **evolution tier bonus** + **legend bonus**.

## Base Class Stats

Each class has a distinct stat spread before any modifiers, evolution, or legend bonus:

| Class | HP | Atk | Armor | Spd | Crit |
|-------|-----|-----|-------|-----|------|
| **Bulwark** | 700 | 100 | 120 | 80 | 90 |
| **Mantis** | 375 | 100 | 70 | 130 | 125 |
| **Leviathan** | 600 | 130 | 100 | 70 | 80 |
| **Tempest** | 450 | 110 | 80 | 105 | 115 |
| **Specter** | 425 | 85 | 85 | 125 | 120 |
| **Sentinel** | 650 | 70 | 110 | 90 | 100 |
| **Reaver** | 475 | 120 | 80 | 110 | 95 |
| **Abyss** | 525 | 110 | 90 | 95 | 100 |
| **Kraken** | 550 | 90 | 100 | 105 | 95 |
| **Ember** | 350 | 140 | 60 | 100 | 130 |

Notice the trade-offs: tanks (Bulwark, Sentinel) sacrifice damage for survivability; glass cannons (Ember, Mantis) hit hard but die fast. Speed sets how often you act on the battle's ATB initiative bar — faster classes simply take more turns. HP is used as-is in battle.

For full battle damage formulas and class advantage relationships, see [Battle Mode](battle.md).

## Evolution Tiers

| Tier | Stat Bonus | Unlocks |
|------|-----------|---------|
| **Base** | — | Base Mine |
| **Evolved** | +20% all stats | Evolved Mine, Battle Mode |
| **Elite** | +40% all stats | Elite Mine |
| **Apex** | +60% all stats | Apex Mine |

See [Evolution](evolution.md) for how to evolve your lobsters.

## DNA

Each lobster's genetics are encoded in a single **uint256** stored on-chain. The DNA determines:

- **Class** (1 of 10)
- **Legend status** (normal or legend)
- **6 body parts**, each with 3 alleles (Dominant, Recessive 1, Recessive 2)
- **Breed type** (visual subtype)

### Body Parts

| Part | Primary Stat | Visual |
|------|-------------|--------|
| Carapace | HP | Shell color, pattern |
| Claws | Attack | Claw shape, size |
| Tail | Speed | Tail fan shape |
| Antennae | Critical | Length, glow effects |
| Eyes | Armor | Eye stalk shape, color |
| Legs | HP | Leg style |

### Alleles

Each body part has 3 alleles. Each allele is 8 bits encoding:
- **Class affinity** (4 bits) — which class this gene "belongs" to
- **Variant** (4 bits) — visual and stat variant within that class

The dominant allele determines the body part's appearance and primary stat contribution.

## Purity

**Purity Score** = how many of your 6 body parts have a dominant allele matching your lobster's class (0 to 6).

Purity does **not** affect base stats or mining. It exclusively enhances your **Special move** in battle:

- **Potency**: base effect x (1 + 0.10 x purity). A 6/6 pure lobster's Special is 60% stronger.
- **Enhanced proc chance**: 5% + (5% x purity). A 6/6 pure lobster triggers enhanced Specials 35% of the time.

This makes purity a battle-specific advantage that drives breeding demand.

## Legends

Legends are rare lobsters with unique visuals and a modest stat edge.

- **\~0.3% chance** per breed (VRF roll)
- **+10% base stats** (stacks with evolution)
- **Not hereditary** — each breed is an independent roll
- Faucet lobsters cannot be legends — only bred offspring
- No gameplay-exclusive access — prestige + stat edge

## Locking

A lobster is **locked** (cannot be sold or transferred) when it is:
- Assigned to a team
- On an active mining expedition
- In an active battle

Remove the lobster from the team or wait for the activity to complete before trading.

## Battle Damage

Lobsters accumulate **damage points** (0-100) from battles. A lobster with **80 or more damage** cannot enter another battle until it's repaired — pay $CLAW at the Repair Shop to restore it. Damaged lobsters can still mine and breed (damage only gates battle entry, not other activities). See [Battle Mode → Repair](battle.md#repair) for repair costs by tier.
