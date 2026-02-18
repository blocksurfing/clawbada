# Breeding

Breeding produces new lobsters from two parents. It's the primary way to create lobsters with targeted classes, high purity, and (with luck) legend status.

## Rules

- **2 parents produce 1 offspring**
- Offspring is always **Base tier** and **tradeable**
- Each lobster can breed up to **5 times** (lifetime cap)
- **48-hour cooldown** per parent after each breed
- Parents are **not consumed** (unlike evolution fuel)
- Soulbound parents produce **tradeable** offspring

## Cost

Breeding cost is calculated per parent based on that parent's breed count and generation.

**Per-parent cost** = 500 x breed_multiplier x 1.5^generation

| Breed # | Multiplier | Gen 0 Cost (per parent) |
|---------|-----------|------------------------|
| 1st | 1x | 500 |
| 2nd | 1.5x | 750 |
| 3rd | 2.5x | 1,250 |
| 4th | 4x | 2,000 |
| 5th | 8x | 4,000 |

**Total cost** = parent A cost + parent B cost.

**Example**: Two fresh Gen 0 parents, 5 breeds = 17,000 $CLAW total for 5 offspring. Breakeven at 3,400 $CLAW per offspring.

Higher-generation parents cost more due to the 1.5^generation multiplier. Gen 2 parents cost 2.25x more than Gen 0.

## Offspring Properties

| Property | Value |
|----------|-------|
| Tier | Always Base (must evolve independently) |
| Generation | max(parent A gen, parent B gen) + 1 |
| Class | 50/50 from either parent (VRF). Same-class parents = guaranteed class. |
| Soulbound | Never (always tradeable) |
| Breed count | 0 (fresh) |
| Damage | 0 |

## Gene Inheritance

For each of the 6 body parts, the offspring gets 3 alleles:

**Step 1 — One allele from each parent:**
- Dominant (50%) / R1 (33%) / R2 (17%) probability

**Step 2 — Third allele:**
- VRF picks one parent; from that parent's remaining alleles, one is drawn at random

**Step 3 — Ordering:**
- Alleles matching the offspring's class become dominant first
- Ties broken by variant value
- This naturally surfaces class-matching alleles as dominant

All offspring genes come from parents — no mutations in Season 1.

## Purity Breeding

Selective breeding can increase purity over generations:

| Generation | Expected Purity |
|-----------|----------------|
| Gen 0 (faucet) | 0-1 matching |
| Gen 1 | 2-3 matching |
| Gen 2 | 3-4 matching |
| Gen 3+ | 5-6 matching |

The "gene hunting" metagame: breeders who identify parents with matching alleles hiding in R1/R2 slots can produce higher-purity offspring faster.

## Legend Chance

Each breed has a **\~0.3% chance** (about 1 in 333) of producing a legend offspring. This is a VRF roll at creation — legend status is not inherited from parents. Faucet lobsters cannot be legends.

## Strategy

- Breed same-class parents to guarantee offspring class
- Look for hidden value in recessive alleles (R1/R2 matching the class)
- Gen 0 pairs are cheapest — maximize breeds before moving to higher gens
- The marketplace creates a self-correcting economy: if offspring sell below 3,400 $CLAW, breeders exit and supply drops
