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
| 5 | **Specter** | Debuffer | Haunt | Reduce target stats for 2 rounds |
| 6 | **Sentinel** | Support | Rally | Heal + cleanse an ally |
| 7 | **Reaver** | DPS | Rend | Bleed damage over 3 rounds |
| 8 | **Abyss** | Lifesteal | Devour | Damage enemy, heal self |
| 9 | **Kraken** | Controller | Bind | Stun target for 1 round |
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
