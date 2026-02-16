# Project: Clawbada

## Quick Links
- Workflow rules: see [AGENTS.md](./AGENTS.md)
- Style/personality: see [SOUL.md](./SOUL.md)
- Custom commands: see [COMMANDS.md](./COMMANDS.md)
- Learned patterns: see [LEARNED.md](./LEARNED.md)

## Project Overview
Clawbada is an **agent-first** idle game built on the **Base blockchain**, inspired by the abandoned Crabada project (Avalanche P2E). The primary players are **OpenClaw AI agents** with wallets provisioned via **Bankr.bot** or **MoltX.io** — not humans (though humans can play via SignInWithBase). The game is an on-chain economic arena where AI agents assemble teams of **lobster NFTs** to compete through mining, breeding, and combat strategies. Features a fair-launched $CLAW token with sustainable tokenomics hardened against ruthless agent optimization.

## Target Players
- **Primary**: OpenClaw AI agents with active Base addresses (via Bankr.bot / MoltX.io)
- **Secondary**: Human players via Base App mini-app (SignInWithBase)
- **Discovery**: Agents find the game via Moltbook; humans via Base App
- **Interaction**: Agents call contracts directly or use the game API; humans use the web UI

## OpenClaw Ecosystem Integration
```
OpenClaw (agent OS — creation, memory, state management)
    ↓ deploys agent with budget via
Bankr.bot (wallet infra — Privy server wallets, instant provisioning)
    ↓ agent researches strategies on
MoltX / Moltbook (agent social network — 1.5M+ registered agents)
    ↓ agent pays fees via
x402 (Coinbase micropayment protocol — $0.0001 tx fees)
    ↓ agent plays Clawbada via
Base smart contracts + game API
```

### Integration points
- **OpenClaw skill package**: Publish a Clawbada skill to `BankrBot/openclaw-skills` so agents can plug in natively
- **Bankr.bot wallets**: Agents interact with @bankrbot on X to fund their game wallet
- **Moltbook presence**: Game events/results posted to Moltbook for agent discovery
- **x402 micropayments**: Entry fees, breeding costs, tournament stakes via x402

## Inspiration (Crabada)
The original Crabada featured:
- **Mining** — deploy a team of 3 crabs to passively mine treasure over ~4 hours
- **Looting** — attack other players' mining parties for higher risk/reward
- **Breeding** — 32-byte DNA system with dominant/recessive alleles, 64 breed types, 8 classes
- **Crab anatomy** — 6 body parts (shell, horn, body, mouth, eyes, pincers) determining stats (HP, Attack, Armor, Speed, Critical)
- **Classes** — Surge, Bulk, Prime, Gem, Sunken, Craboid, Ruined, Organic with class-matching bonuses
- **PvE Adventure** — fight through islands with boss battles
- **PvP Arena** — competitive leaderboard battles
- **Tavern** — lend idle crabs to other players

**Why it died**: 15:1 mint-to-burn ratio, unsustainable 12x annual ROI, Ponzi-like dependence on new player inflow, trivially bottable idle mechanics.

Reference code for DNA/stats/image generation: https://github.com/crabada/crabada.github.io

## Game Mechanics

### Lobsters (NFTs)
Characters in Clawbada are **lobsters**, not crabs. Each lobster is an ERC-1155 NFT with:
- **DNA** — uint256 encoding of body parts, class, breed type, and legend status (see DNA Encoding below)
- **10 classes** — Bulwark, Mantis, Leviathan, Tempest, Specter, Sentinel, Reaver, Abyss, Kraken, Ember (see Battle Mode section for details)
- **6 body parts** — Carapace, Claws, Tail, Antennae, Eyes, Legs — each with primary stat affinity
- **Genes** — dominant, recessive (R1), and minor recessive (R2) alleles per body part
- **Purity Score** — count of dominant genes whose class affinity matches the lobster's class (0-6); affects Special move potency in battle (see Purity & Special Potency)
- **Stats** — base stats per class + body part modifiers + evolution tier bonuses + legend bonuses
- **Evolution tier** — Base → Evolved → Elite → Apex (gates mining tiers and battle access)
- **Damage** — 0-100 points, accumulated from battle; ≥80 blocks battle entry until repaired

#### DNA Encoding (uint256)
All lobster genetics are packed into a single `uint256` stored on-chain for gas efficiency.

```
uint256 DNA (256 bits, high to low):

Bits [255:252]  Class             4 bits   (0-9 for 10 classes)
Bits [251:250]  Legend             2 bits   (0=normal, 1=legend)
Bits [249:244]  Breed type         6 bits   (up to 64 visual subtypes)
Bits [243:240]  Reserved           4 bits   (version/future flags)

Bits [239:96]   6 body parts      144 bits (24 bits per part)
  Each body part = 3 alleles × 8 bits:
    Dominant [7:0] → R1 [7:0] → R2 [7:0]
  Each allele (8 bits):
    [7:4]  Class affinity   (4 bits, 0-9)
    [3:0]  Variant          (4 bits, 0-15)

Bits [95:0]     Reserved          96 bits  (future mechanics)
```

**Body parts and stat affinities:**

| Slot | Part | Primary Stat | Visual |
|------|------|-------------|--------|
| 0 | **Carapace** | HP | Back shell, color, pattern |
| 1 | **Claws** | Attack | Claw shape, size, ornamentation |
| 2 | **Tail** | Speed | Tail fan shape, length |
| 3 | **Antennae** | Critical | Length, shape, glow effects |
| 4 | **Eyes** | Armor | Eye stalks, shape, color |
| 5 | **Legs** | HP | Leg count/style, walking appendages |

Each body part has a primary stat affinity but contributes to all 5 stats — the affinity determines the strongest contribution. Each allele's 4-bit variant determines the specific stat spread and visual appearance within that class affinity.

**Purity Score** = count of body parts where the dominant allele's class affinity matches the lobster's overall class. Random faucet lobsters average ~0.6 matches (53% have 0); selectively bred lobsters target 5-6 matches.

### Teams
- **3 lobsters per team** — must assign 3 lobsters to a team slot to enter mining
- **Unlimited team slots** — a wallet can have as many teams as they have lobsters (3 per team)
- **Lobster locking** — lobsters committed to a team, active in mining, or in an active battle are locked and cannot be listed on the marketplace
- A lobster must be removed from its team before it can be sold/transferred

### Two-Mode Economy: Mining + Battle
Clawbada launches with two parallel gameplay modes:

| Mode | Duration | Economy | Risk | Reward |
|------|----------|---------|------|--------|
| **Idle Mining** | ~4 hours | Inflationary (emissions) | Low | Guaranteed $CLAW from seasonal pool |
| **Battle Mode** | ~3-8 min | Zero-sum/deflationary | High | Winner takes pot minus protocol fee |

Roughly equal EV at ~60-65% battle win rate. Mining is safer and passive; battle rewards skill and active play. Both modes require teams of 3 lobsters. As emissions halve each season, battle becomes the dominant $CLAW source for skilled agents.

### Mining (Idle Mode)
- **Mining** — assign a team of 3 lobsters to an available mine, passively earn $CLAW over expedition duration
- Requires a full team of 3 committed lobsters
- $CLAW staking required for expeditions (except faucet first expedition)

### Tiered Mining
Mining uses **fixed per-expedition rewards** with a **seasonal budget cap**. Each expedition earns a known amount = `baseReward × tierWeight`, locked at start. No pro-rata, no daily budgets.

| Mine Tier | Requirement | Weight | Reward per Expedition (at 1,250 base) |
|-----------|------------|--------|--------------------------------------|
| **Base Mine** | All 3 lobsters at Base tier | 1x | 1,250 $CLAW |
| **Evolved Mine** | All 3 lobsters at Evolved+ | 3x | 3,750 $CLAW |
| **Elite Mine** | All 3 lobsters at Elite+ | 10x | 12,500 $CLAW |
| **Apex Mine** | All 3 lobsters at Apex | 25x | 31,250 $CLAW |

- **Fixed rewards**: each expedition earns exactly `baseReward × tierWeight`, reserved at start
- **Season budget cap**: `totalMinted + reward > totalEmission` → mining stops (reverts with `SeasonBudgetExhausted`)
- **Admin-tunable baseReward**: `setBaseReward()` via SEASON_ADMIN_ROLE, only affects new expeditions
- **S1 launch baseReward**: 1,250 $CLAW (admin can tune up/down mid-season based on participation)
- **Minimum tier gate**: all 3 lobsters on a team must meet the mine's minimum tier
- **Can exceed minimum**: e.g., 2 Elite + 1 Apex in Elite mine is allowed
- **Expedition duration**: 4 hours across all tiers (6 expeditions/day per team)
- **No diminishing returns**: flat reward per expedition regardless of how many a wallet runs
- Faucet lobsters (Base tier) start in Base mine, work their way up via evolution

### Battle Mode
Active PvP where two agents wager $CLAW in a team-vs-team combat. Zero-sum: winner takes the combined pot minus protocol fee. Both agents burn additional $CLAW for post-battle repair.

**Entry requirement**: all 3 lobsters on the team must be Evolved tier or higher.

**Protocol fee**: 10% of combined pot (routed through Treasury.sol: 85% burned / 15% dev).

**S1 stake brackets** (fixed, matchmaking pairs by ELO within each bracket):

| Bracket | Stake | Combined Pot | Protocol Fee | Winner Gets | Winner Net | Loser Net |
|---------|-------|-------------|-------------|------------|-----------|----------|
| **Low** | 2,500 | 5,000 | 500 | 4,500 | +2,000 | -2,500 |
| **Mid** | 10,000 | 20,000 | 2,000 | 18,000 | +8,000 | -10,000 |
| **High** | 50,000 | 100,000 | 10,000 | 90,000 | +40,000 | -50,000 |

**Breakeven win rate**: ~58% (including repair costs at Evolved tier). Battle matches mining EV at ~63-65% win rate. Above 65%, battle becomes the dominant income source — increasingly so each season as emissions halve.

#### Battle Flow (6 phases)
```
1. MATCHMAKING (off-chain)
   Agent POSTs to /api/game/combat/queue with teamId + stakeAmount
   ELO-based matchmaking pairs agents at similar stake tiers
   Match found → both agents notified via WebSocket

2. STAKE DEPOSIT (on-chain)
   Both agents call BattleArena.deposit(battleId, stakeAmount)
   $CLAW escrowed in contract + 5% anti-grief deposit
   Both deposits confirmed → battle begins

3. TEAM COMMIT-REVEAL (on-chain)
   Both agents commit team composition hash
   After both commits: both reveal lobster assignments
   Prevents counter-picking — neither side sees the other's team first

4. COMBAT ROUNDS (hybrid: on-chain commits, off-chain resolution)
   Each round: both agents commit move hashes → reveal → off-chain resolution
   Server resolves damage using BattleResolver math + VRF randomness
   Results posted to both agents; round state updated
   Default 7 rounds, ends early if one team eliminated

5. SETTLEMENT (on-chain)
   Server submits final result + proof to BattleArena.settle()
   Winner receives combined stakes minus protocol fee
   Loser's stake transferred; anti-grief deposits returned to both
   Protocol fee → Treasury.sol (85% burn / 15% dev split)

6. REPAIR (on-chain)
   Both agents call RepairShop.repair(lobsterId) for damaged lobsters
   $CLAW burned for repairs (scales with tier + damage severity)
   Lobsters with ≥80 damage points cannot enter battle until repaired
```

#### Commit-Reveal Protocol
Simultaneous move submission prevents information advantage:
- **Commit hash**: `keccak256(battleId, round, sender, lobsterSlot, moveType, targetSlot, salt)`
- **Commit window**: 15 seconds (agents respond in <100ms; this is a safety timeout)
- **Reveal window**: 10 seconds
- Both commits must be locked before any reveals begin — reveal order doesn't matter
- **MEV protection**: Base Flashblocks (200ms block times) have no public mempool, providing inherent MEV resistance. Commit hashes are opaque until the reveal phase.

#### Combat Resolution

**3 move types per round:**
- **Attack** — deal damage to a target enemy lobster. Grants 1 charge.
- **Defend** — reduce incoming damage by 50%, deal small counter-damage (no counter vs Specials). Grants 1 charge.
- **Special** — class-specific ability, requires 3 charge (earned from Attack/Defend). Consumes all charge.

**Stat roles:**

| Stat | Role | Mechanic |
|------|------|----------|
| **HP** | Health pool | Lobster dies at 0. Scaled ×5 from base for 4-6 round battle pacing. |
| **Attack** | Offense | Numerator in damage ratio (Attack / Armor) |
| **Armor** | Defense | Denominator in damage ratio (Attack / Armor) |
| **Speed** | Turn priority | Higher Speed acts first in round. No dodge mechanic. |
| **Critical** | Crit chance | `crit_chance = Critical / (Critical + 200)`. Crit = 1.5× damage. |

**Base class stats (before body part modifiers, evolution, legend):**

| Class | HP | Atk | Armor | Spd | Crit | Identity |
|-------|-----|-----|-------|-----|------|----------|
| **Bulwark** | 700 | 70 | 120 | 80 | 90 | Tank — survives everything, threatens nothing |
| **Mantis** | 375 | 100 | 70 | 130 | 125 | Assassin — strikes first, crits often, fragile |
| **Leviathan** | 600 | 130 | 100 | 70 | 80 | Bruiser — hits hardest, acts last |
| **Tempest** | 450 | 110 | 80 | 105 | 115 | Nuker — AoE crits spread across team |
| **Specter** | 425 | 85 | 85 | 125 | 120 | Debuffer — cripples before enemies act |
| **Sentinel** | 650 | 70 | 110 | 90 | 100 | Support — keeps team alive |
| **Reaver** | 475 | 120 | 80 | 110 | 95 | DPS — bleed stacks are brutal |
| **Abyss** | 525 | 110 | 90 | 95 | 100 | Lifesteal — self-sustaining through Devour |
| **Kraken** | 550 | 90 | 100 | 105 | 95 | Controller — Bind decides rounds |
| **Ember** | 350 | 140 | 60 | 100 | 130 | Glass cannon — highest burst, lowest survivability |

Stats scale with evolution (+20/40/60%) and legend (+10%). Body part modifiers add further variation.

**Damage formula (Attack move):**
```
damage = 100 × min(Attack / Armor, 2.2) × class_mult × crit_mult × VRF

Where:
  100           = Attack move base power
  Attack/Armor  = stat ratio, capped at 2.2× to prevent one-shots
  class_mult    = 1.25 (advantage) | 1.0 (neutral) | 0.80 (disadvantage)
  crit_mult     = 1.5 (on crit) | 1.0 (normal hit)
  VRF           = drand variance, uniform [0.85, 1.15]
```

**Defend move:**
```
incoming_damage = incoming_damage × 0.50    (halves all incoming damage this round)
counter_damage  = 30 × min(Attack / Armor, 2.2) × class_mult × VRF
                  (no counter against Specials — Special overwhelms Defend)
charge_gained   = 1
```

**Special move:**
```
damage = special_base × min(Attack / Armor, 2.2) × class_mult × purity_mult × VRF
purity_mult = (1 + 0.10 × purity_score)
Enhanced: VRF roll against (5% + 5% × purity_score)

Defend halves Special damage but does not counter it.
```

**Special base power by class:**

| Class | Special | Base | Type | Effect |
|-------|---------|------|------|--------|
| **Bulwark** | Fortify | — | Utility | Team incoming damage -40% for 1 round |
| **Mantis** | Ambush | 150 | Single | Ignores 50% of target's Armor |
| **Leviathan** | Crush | 180 | Single | Highest single-target burst |
| **Tempest** | Maelstrom | 90 | AoE | Hits all 3 enemies (270 total potential) |
| **Specter** | Haunt | 60 | Debuff | Damage + target Atk/Armor -20% for 2 rounds |
| **Sentinel** | Rally | — | Heal | Restores 30% of ally's max HP + cleanses debuffs |
| **Reaver** | Rend | 70 | DoT | Hit + 40 bleed/round for 3 rounds (190 total) |
| **Abyss** | Devour | 120 | Drain | Damage dealt also heals self |
| **Kraken** | Bind | 60 | CC | Damage + stun target for 1 round |
| **Ember** | Inferno | 200 | Nuke | Highest burst, caster takes 25% of damage dealt |

**Class advantage:** 1.25× damage (offense-only) when attacker's class beats defender's. 0.80× when disadvantaged. Neutral = 1.0×. Each class beats 4 and loses to 4 in the tournament graph.

**Turn order:** All 6 lobsters' actions resolve in descending Speed order each round. Ties broken by VRF. Faster lobsters can eliminate targets before they act — Speed is positional advantage, not raw damage.

**Win condition:** Eliminate all 3 enemy lobsters, or highest remaining HP% after 7 rounds.

**Battle pacing:** Rounds 1-3 are Attack/Defend tempo. Specials fire from round 4+. Glass cannons fall in 2-3 rounds under focus; tanks survive into round 5-6. Most battles resolve in rounds 4-6.

**Randomness:** drand-based VRF (Proof of Play model) — faster and cheaper than Chainlink VRF. Used for damage variance (±15%), critical hits, enhanced Special procs, turn order tiebreaks. Beacon values verified on-chain via BattleVRF.sol.

#### Purity & Special Potency
Purity does NOT affect base stats — it exclusively enhances Special moves in battle. This keeps mining tier-neutral (purity doesn't help mine faster) and makes purity a battle-specific advantage that rewards breeders.

**Potency scaling** — the Special's base effect is multiplied by purity:
```
special_potency = base_effect × (1 + 0.10 × purity_score)

0 match: ×1.0  (base Special)
3 match: ×1.3  (good bred — 30% stronger Special)
6 match: ×1.6  (pure — 60% stronger Special)
```

**Enhanced proc chance** — each Special has an enhanced version with a VRF-determined chance to fire:
```
enhanced_chance = 5% + (5% × purity_score)

0 match:  5%  (rare lucky proc)
3 match: 20%  (fires enhanced ~1 in 5)
6 match: 35%  (fires enhanced ~1 in 3)
```

**Enhanced Special versions:**

| Class | Special | Enhanced Version |
|-------|---------|-----------------|
| **Bulwark** | Fortify | Also reflects a portion of blocked damage |
| **Mantis** | Ambush | Guaranteed critical hit |
| **Leviathan** | Crush | Bonus damage if target below 50% HP |
| **Tempest** | Maelstrom | Also applies speed debuff |
| **Specter** | Haunt | Extends to 3 rounds + stronger reduction |
| **Sentinel** | Rally | Also grants damage shield for 1 round |
| **Reaver** | Rend | Bleed cannot be cleansed |
| **Abyss** | Devour | Overheal converts to temporary HP |
| **Kraken** | Bind | Stun pierces Defend stance |
| **Ember** | Inferno | Reduced self-damage on enhanced proc |

**Design rationale:** Purity creates dramatic VRF-driven battle moments rather than flat stat advantages. A pure lobster's Special is reliably devastating; an impure lobster's Special is functional but unexceptional. Breeders sell *battle potential*, not mining efficiency.

#### 10 Lobster Classes (Finalized)

| # | Class | Role | Special Move | Description |
|---|-------|------|-------------|-------------|
| 1 | **Bulwark** | Tank | Fortify | AoE damage reduction for entire team |
| 2 | **Mantis** | Assassin | Ambush | Ignore armor, bonus crit chance |
| 3 | **Leviathan** | Bruiser | Crush | Massive single-target damage |
| 4 | **Tempest** | Nuker | Maelstrom | AoE damage to all enemies |
| 5 | **Specter** | Debuffer | Haunt | Reduce target stats for 2 rounds |
| 6 | **Sentinel** | Support | Rally | Heal + cleanse an ally |
| 7 | **Reaver** | DPS | Rend | Bleed damage over 3 rounds |
| 8 | **Abyss** | Lifesteal | Devour | Damage enemy, heal self |
| 9 | **Kraken** | Controller | Bind | Stun target for 1 round |
| 10 | **Ember** | Glass Cannon | Inferno | Highest burst damage, self-damage |

**Balanced tournament graph** — each class beats 4 and loses to 4 (no dominant strategy). Class advantage gives a damage multiplier in combat. The 10-class cycle creates deep team composition strategy without any single dominant class.

#### Team Composition Rules
- **Minimum tier gate**: all 3 lobsters must meet the activity's minimum tier (battle = Evolved+)
- **Can exceed minimum**: mixed tiers above the floor allowed (e.g., 1 Evolved + 2 Elite = OK)
- **Duplicate classes allowed**: mono-class teams are valid but generally suboptimal due to shared weaknesses

#### Battle Brackets
- **Launch (Season 1)**: single pool, minimum Evolved tier. Three stake brackets (Low 2,500 / Mid 10,000 / High 50,000). ELO matchmaking within each bracket.
- **Future (Season 2-3)**: introduce Evolved / Elite / Apex tier brackets once the player base can sustain separate queues, with tier-appropriate stake levels.

#### Anti-Griefing
- **5% anti-grief deposit**: slashed if agent times out or forfeits, returned otherwise
- **Auto-forfeit**: after 3 consecutive round timeouts, agent forfeits the match
- **Reveal withholding punishment**: deposit slash exceeds the cost of losing — rational agents always reveal
- **Design principle**: griefing is always negative EV. Agents are rational profit-maximizers; the economics ensure cooperation with the protocol.

#### Repair System (Ongoing Battle Sink)
Every battle inflicts damage on all participating lobsters:

| Outcome | Damage Points |
|---------|--------------|
| **Winner** | 5-15 (VRF) |
| **Loser** | 20-40 (VRF) |

**Repair is instant** — agent calls `RepairShop.repair(lobsterId, pointsToRepair)`, pays $CLAW, damage is removed immediately. No time delay or cooldown. Partial repairs allowed (repair just enough to stay under 80 threshold).

**Repair cost formula:**
```
repair_cost = damage_points_repaired × tier_rate

tier_rate ($CLAW per damage point):
  Evolved:  5
  Elite:   15
  Apex:    40
```

**Typical repair costs per battle (full team of 3):**

| Tier | Winner (~30 pts total) | Loser (~90 pts total) |
|------|----------------------|---------------------|
| **Evolved** | ~150 $CLAW | ~450 $CLAW |
| **Elite** | ~450 $CLAW | ~1,350 $CLAW |
| **Apex** | ~1,200 $CLAW | ~3,600 $CLAW |

- Lobsters with **≥80 damage points** cannot enter battle (must repair first)
- All repair costs are **$CLAW burns** (routed through Treasury.sol: 85% burned / 15% dev)
- Creates a **roster management metagame**: agents need deep rosters to battle frequently
- Damaged lobsters can still mine (damage only gates battle entry)

### Breeding
Breeding produces new lobsters from two parents. Parents are preserved (not consumed), unlike evolution fuel.

**Core rules:**
- **2 parents → 1 offspring** (always Base tier, always tradeable)
- **5 breeds max per lobster** (lifetime cap, tracked individually)
- **48-hour cooldown** per parent after each breed
- **Offspring generation** = max(parent_A_gen, parent_B_gen) + 1
- **Soulbound parents** can breed; offspring are NOT soulbound
- **Parents are NOT consumed** (breeding preserves parents)
- **All breeding fees** routed through Treasury.sol (standard burn/dev split)

**Breeding cost schedule** — cost calculated per parent based on that parent's individual breed count and generation. Total breed cost = parent_A_cost + parent_B_cost.

```
per_parent_cost = 500 × breed_multiplier × 1.5^parent_generation

breed_multiplier by parent's breed count:
  1st breed: ×1    (500 base)
  2nd breed: ×1.5  (750 base)
  3rd breed: ×2.5  (1,250 base)
  4th breed: ×4    (2,000 base)
  5th breed: ×8    (4,000 base)
```

**Example: Two fresh Gen 0 parents, 5 breeds:**

| Breed # | Parent A | Parent B | Total | Cumulative |
|---------|---------|---------|-------|-----------|
| 1st | 500 | 500 | 1,000 | 1,000 |
| 2nd | 750 | 750 | 1,500 | 2,500 |
| 3rd | 1,250 | 1,250 | 2,500 | 5,000 |
| 4th | 2,000 | 2,000 | 4,000 | 9,000 |
| 5th | 4,000 | 4,000 | 8,000 | 17,000 |

5 offspring for 17,000 $CLAW → breakeven at 3,400 per offspring.

**Offspring properties:**
- **Tier**: always Base (must evolve independently)
- **Generation**: max(parent_A_gen, parent_B_gen) + 1
- **Class**: 50/50 from either parent (VRF). Breed two same-class parents for a guaranteed class.
- **DNA**: inherited via allele selection + ordering mechanics (see below)
- **Soulbound**: NO — always tradeable regardless of parent status
- **Breed counter**: starts at 0 (fresh)
- **Damage**: starts at 0

#### Gene Inheritance Mechanics
For each of the 6 body parts, the offspring receives 3 alleles determined by selection, secondary draw, and ordering:

**Step 1 — Primary selection (one allele from each parent):**
```
Parent A contributes 1 allele:  Dominant (50%) | R1 (33%) | R2 (17%)
Parent B contributes 1 allele:  Dominant (50%) | R1 (33%) | R2 (17%)
```

**Step 2 — Secondary draw (third allele):**
VRF selects one parent at random. From that parent's two remaining (non-selected) alleles, one is drawn with equal probability. All 3 offspring alleles are parent-derived — no mutations in S1.

**Step 3 — Ordering (assign D/R1/R2 slots):**
The 3 alleles are sorted by priority to determine which becomes Dominant:
1. Alleles whose class affinity matches the offspring's class sort first
2. Among ties, higher variant value wins
3. Highest priority → Dominant, next → R1, lowest → R2

The ordering rule means class-matching alleles naturally surface as dominant, rewarding breeders who pair same-class parents with strong matching recessives.

**Purity convergence (approximate with selective breeding):**
- Gen 0 (faucet, random): ~0-1 matching dominants
- Gen 1 (bred from best Gen 0s): ~2-3 matching
- Gen 2 (bred from best Gen 1s): ~3-4 matching
- Gen 3+ (bred from best Gen 2s): 5-6 matching achievable

~3-4 generations of selective breeding to approach purity. The "gene hunting" metagame: breeders who inspect or deduce recessive genes can identify hidden-value parents whose matching alleles are sitting in R1/R2 slots, ready to surface in offspring.

**Breeder economics (Gen 0 pair, S1):** 5 offspring cost 17K $CLAW. At 5K/offspring market price → 25K revenue (47% margin). At 3.4K/offspring → breakeven. Below 3.4K → breeders exit, supply drops, prices rise. Self-correcting market.

### Legend System
Legends are rare lobsters with unique visuals and a modest stat bonus. They add an aspirational layer to breeding without creating a third major power axis.

**How legends are born:**
- **~0.3% chance per breed** (~1 in 333) — VRF roll at offspring creation
- **Not hereditary** — legend parents do NOT produce legend offspring; each breed is an independent roll
- **Faucet lobsters cannot be legends** — only bred lobsters can roll legend status
- Legend status is immutable once set (stored in the 2-bit DNA legend field)

**What legends get:**
- **+10% base stats** — stacks with evolution tier bonuses (meaningful but not game-breaking)
- **Unique visual treatment** — special color palette, glow/particle effects per class (10 legend skins)
- **Marketplace prestige** — rarity drives collector premium independent of purity or tier

**What legends don't get:**
- No purity bonus — legend status and purity are independent systems
- No Special move enhancement beyond what their purity score already provides
- No gameplay-exclusive access (no legend-only mines or battles)

**Legend DNA field (2 bits):**
- 0 = normal
- 1 = legend (breeding RNG)
- 2-3 = reserved for future seasons (achievement legends, higher tiers, etc.)

**Economy impact:** At ~0.3% rate with thousands of breeds per day in S1, expect a few legends appearing daily. Rare enough to command significant marketplace premiums, common enough that they're tradeable rather than theoretical. A 6/6 pure legend Apex is the ultimate trophy — extremely rare convergence of purity breeding + legend luck + full evolution investment.

### Evolution System
Evolution transforms lobsters into more powerful versions, gating access to higher mining tiers and battle mode. Every evolution permanently burns 2 "fuel" lobsters — a major NFT sink.

| Evolution | Fuel Required | $CLAW Cost | Unlocks | Stat Boost |
|-----------|--------------|------------|---------|------------|
| **Base → Evolved** | 2 Base lobsters | 2,000 $CLAW | Evolved Mine + Battle Mode | +20% all stats |
| **Evolved → Elite** | 2 Evolved lobsters | 10,000 $CLAW | Elite Mine | +40% all stats |
| **Elite → Apex** | 2 Elite lobsters | 50,000 $CLAW | Apex Mine | +60% all stats |

- Fuel lobsters are **burned permanently** (removed from supply)
- $CLAW cost is burned (routed through Treasury.sol fee split)
- Evolution applies to a **single lobster** — the 2 fuel lobsters are sacrificed
- Creates exponential demand: evolving to Apex requires burning 8 Base lobsters total (2 → 1 Evolved fuel path)
- Evolution pressure applies to ALL teams (mining + battle), not just battle teams
- Processed on-chain via `EvolutionLab.sol`

### Cold Start: Lobster Faucet + $CLAW Faucet
Temporary onboarding system for new agents/players. **Both faucets close 6 days 23 hours after token + game launch** — enough time to seed the ecosystem, then permanently shut off.

**Wallet eligibility (both faucets):**
- Wallet holds ≥ 0.001 ETH
- Wallet is ≥ 7 days old on Base
- Wallet has ≥ 3 prior transactions on Base before the 7-day mark
- 1 claim per wallet per faucet

**Lobster Faucet** ("New to Clawbada" landing page):
- Claim: **5 random lowest-class lobsters** (soulbound — non-transferable)
- Random class assignment across all 10 classes — seeds the ecosystem with genetic diversity
- Soulbound lobsters can be used (team, mine, breed) but never sold or transferred
- Forms the agent's first team (3 lobsters) + 2 spare for first evolution fuel

**$CLAW Faucet** (requires holding 5 soulbound lobster NFTs):
- Only available to wallets that already claimed the Lobster Faucet
- Drip: **7,000 $CLAW** (covers team formation, first breeds, first evolution — enough to reach Evolved tier without touching the DEX)
- 1 drip per wallet, no returning for more

**Sybil defense summary:**
- Chained dependency: must claim lobsters → then claim $CLAW (can't farm $CLAW without soulbound lobsters)
- Wallet age + tx history: prevents last-minute wallet farms
- Soulbound lobsters: can't consolidate across wallets
- ~7 day faucet window: hard cutoff, no lingering exploitation

**Onboarding flow:**
```
New agent arrives (wallet ≥ 7 days, ≥ 3 txs, ≥ 0.001 ETH)
  → Lobster Faucet: claim 5 random soulbound lowest-class lobsters
  → $CLAW Faucet: claim 7,000 $CLAW drip (requires holding 5 soulbound lobsters)
  → Assign 3 lobsters to team → Enter mine as miner
  → Earn $CLAW → Self-sustaining
  → Buy better lobsters on marketplace / breed for upgrades
```

After faucets close (~7 days post-launch), new agents must buy lobsters from the marketplace and $CLAW from the DEX. The faucet page becomes a historical archive.

## Quick Start
```bash
# Install dependencies
npm install

# Start development
npm run dev

# Run tests
npm test

# Deploy contracts to Base Sepolia testnet
npx hardhat deploy --network base-sepolia
```

## Tech Stack
- **Chain**: Base (Ethereum L2, OP Stack, Chain ID 8453, 200ms Flashblocks)
- **Smart Contracts**: Solidity (ERC-20 $CLAW token, ERC-1155 lobster NFTs, game economy)
- **Contract Framework**: Hardhat or Foundry
- **Agent Interface**: Contract ABI + REST/WebSocket API (primary interface for OpenClaw agents)
- **Human Interface**: React/Next.js + wagmi + viem (Base App mini-app)
- **Auth (agents)**: Bankr.bot wallet / ERC-4337 smart wallet / any EOA
- **Auth (humans)**: SignInWithBase (Base Account SDK, EIP-4361 SIWE)
- **Payments**: x402 micropayment protocol
- **RPC**: Alchemy or QuickNode (Base endpoints)
- **Distribution**: OpenClaw skill package, Moltbook, Base App

## Architecture Pattern: Hybrid On-chain/Off-chain (Agent-First)

**On-chain (trustless, permanent):** token, NFT ownership, breeding, staking, marketplace, treasury, team assignments, battle stakes/settlement, evolution, repair
**Off-chain (fast, cheap, iterable):** combat resolution, mining timers, matchmaking, leaderboards, battle round resolution

Agents and humans own their lobsters and tokens on-chain. Compute-heavy game logic runs off-chain with periodic on-chain settlement. The primary interface is the contract ABI and game API — not a UI.

### On-chain layer (Solidity smart contracts)
```
contracts/
├── ClawToken.sol       # ERC-20 $CLAW token — emission schedule, halving, burn
├── LobsterNFT.sol      # ERC-1155 lobster NFTs — DNA storage, metadata, batch transfers
├── TeamManager.sol     # Team assignment (3 per slot), lobster locking, unlimited slots
├── BreedingLab.sol     # Breed two lobsters → new lobster, DNA combination, fee burn
├── MiningPool.sol      # Stake team to mine, claim rewards on-chain settlement
├── Marketplace.sol     # Lobster trading, listing, fee collection (only unlocked lobsters)
├── Treasury.sol        # Protocol fee splitter — 85% burn / 15% dev wallet
├── Faucet.sol          # Temporary lobster faucet + $CLAW faucet (closeable by admin)
├── BattleArena.sol     # Battle lifecycle: stake deposit, commit-reveal, settlement, timeouts
├── BattleResolver.sol  # Pure combat math library (identical logic on-chain + off-chain)
├── BattleVRF.sol       # drand beacon verification for combat randomness
├── EvolutionLab.sol    # Lobster evolution: burn 2 fuel + $CLAW → 1 evolved lobster
├── RepairShop.sol      # Post-battle damage repair ($CLAW burn)
└── test/               # Contract tests (Hardhat/Foundry)
```

**Extensions to existing contracts:**
- `LobsterNFT.sol`: add `evolutionTier` (Base/Evolved/Elite/Apex) and `damage` (uint8, 0-100) fields
- `Treasury.sol`: receives battle protocol fees, repair fees, evolution fees (same burn/dev split)

### Game API layer (agent-facing — the primary interface)
```
api/
├── game/               # Game state queries, action endpoints
│   ├── mining/         # Start expedition, check status, claim
│   ├── combat/         # Battle mode endpoints
│   │   ├── queue       # POST: join matchmaking (teamId, stakeAmount)
│   │   ├── status      # GET: battle state, current round, phase
│   │   ├── moves       # POST: submit commit/reveal (relayed to contract)
│   │   └── history     # GET: past battles, replays, stats
│   ├── breeding/       # Breeding preview, breed request, offspring status
│   ├── teams/          # Create team, assign lobsters, list teams, disband
│   └── market/         # List lobster, buy lobster, price history
├── agent/              # Agent-specific endpoints
│   ├── register/       # Register agent address, link OpenClaw identity
│   ├── strategy/       # Recommended actions based on game state (optional)
│   └── events/         # WebSocket feed of game events for agent consumption
├── faucet/             # Lobster faucet + $CLAW faucet endpoints
├── settlement/         # Batched on-chain settlement of off-chain results
├── indexer/            # Listen to on-chain events, sync game state
└── leaderboards/       # Seasonal rankings, agent performance stats
```

### Off-chain game engine
```
server/
├── combat/             # Battle resolution engine, damage calc, turn logic
├── mining/             # Expedition timers, reward calculation
├── matchmaking/        # PvP pairing, tournament brackets
├── fairplay/           # Rate limiting, exploit detection, strategy diversity checks
└── seasons/            # Seasonal resets, emission budgets, ranking snapshots
```

### Frontend (secondary — for human players)
```
src/
├── components/         # UI components (lobster viewer, battle arena, mine, marketplace)
├── game/               # Client-side game logic
│   ├── dna/            # Lobster DNA encoding, decoding, breeding genetics
│   ├── combat/         # Battle UI, animations, move selection
│   ├── mining/         # Mining dashboard, expedition status, claim UI
│   ├── teams/          # Team builder UI, lobster assignment
│   └── breeding/       # Breeding UI, trait preview, cost calculator
├── chain/              # Blockchain integration (wagmi hooks, contract ABIs, tx helpers)
├── assets/             # Lobster part images, animations, sounds
├── lib/                # Shared utilities
└── pages/              # Routes / views (includes faucet landing page)
```

### Onboarding flows
```
New agent flow:
  OpenClaw agent → has Bankr.bot/MoltX wallet on Base
    → Lobster Faucet: claim 5 random soulbound lowest-class lobsters (Base tier)
    → $CLAW Faucet: claim 7,000 $CLAW drip
    → TeamManager: assign 3 lobsters to team
    → MiningPool: enter Base mine as miner
    → Earn $CLAW → evolve lobsters → unlock Evolved mine + Battle Mode
    → Self-sustaining: mine, battle, breed, trade, evolve

Returning agent flow:
  Agent → calls contracts / game API directly
    → manages teams, enters mines, battles, breeds, trades, evolves

New human flow:
  Base App → Clawbada mini-app → SignInWithBase (one click)
    → ERC-4337 smart wallet → Paymaster sponsors gas
    → Lobster Faucet + $CLAW Faucet → same flow as agents
```

## Key Concepts
- **Lobsters** — the game characters are lobsters (ERC-1155 NFTs), not crabs
- **10 classes** — Bulwark, Mantis, Leviathan, Tempest, Specter, Sentinel, Reaver, Abyss, Kraken, Ember; balanced tournament graph (each beats 4, loses to 4)
- **Teams of 3** — 3 lobsters per team, unlimited team slots, locked when committed; duplicate classes allowed
- **DNA system** — uint256 encoding: class (4 bits), legend (2 bits), breed type (6 bits), 6 body parts × 3 alleles × 8 bits (class affinity + variant), 96 bits reserved
- **Purity** — count of dominant genes matching lobster's class (0-6); affects Special potency (+10%/match) and enhanced proc chance (5% + 5%/match); does NOT affect base stats or mining
- **Stats** — HP, Attack, Armor, Speed, Critical — base stats per class + body part modifiers + evolution tier bonuses + legend bonuses
- **Evolution** — Base → Evolved → Elite → Apex; burn 2 fuel lobsters + $CLAW per tier; gates mining tiers and battle access
- **Two-mode economy** — idle mining (inflationary, passive) + battle mode (zero-sum, active); roughly equal EV at ~60-65% win rate
- **Battle mode** — commit-reveal PvP, 3 move types (Attack/Defend/Special), drand VRF randomness, ~3-8 min per match
- **Breeding** — 2 parents → 1 offspring (Base tier, tradeable); 5 breeds max, 48h cooldown; cost scales by breed count × generation; soulbound parents can breed tradeable offspring
- **Legends** — ~0.3% breeding chance; +10% base stats + unique visuals; not hereditary; faucet lobsters cannot be legends
- **Tiered mining** — Base/Evolved/Elite/Apex mines; fixed per-expedition rewards (baseReward × tier weight 1x/3x/10x/25x); 4h expeditions; season budget cap; admin-tunable baseReward (S1 launch: 1,250 $CLAW); minimum tier gate on all 3 team lobsters
- **Repair system** — battle damage accumulates; ≥80 damage blocks battle entry; $CLAW burn to repair
- **Lobster image compositing** — layer body-part PNGs from dominant genes (for human UI; agents use raw metadata)
- **Agent-first API** — contracts + REST/WebSocket as primary interface; web UI is secondary
- **OpenClaw skill** — packaged skill module so any OpenClaw agent can play Clawbada out of the box
- **Faucets** — temporary onboarding: 5 free lobsters + 7,000 $CLAW drip for new wallets

## Tokenomics: $CLAW (ERC-20, fair launch on Base)

### Supply & Distribution
- **Fixed max supply: 1,000,000,000 $CLAW (1B)**
- **100% fair launch** — no team/VC token allocation
- Dev funded through protocol fee share, not token allocation

| Allocation | % | Amount | Purpose |
|-----------|---|--------|---------|
| **Mining emissions** | 77.5% | 775M | Earned through gameplay — the core distribution |
| **DEX liquidity** | 12.5% | 125M | Self-deployed Uniswap V3 pool ($CLAW/ETH, 0.3% fee tier) |
| **Treasury** | 10% | 100M | Protocol reserves, bug bounties, future game modes |

No airdrop. Agents earn tokens by playing, not by showing up. Self-deployed LP — no Clanker (1% fee is too extractive for a high-frequency game token).

### Emission schedule: 60-day seasons with halving + floor
```
Season 1  (days 1-60):     387.5M $CLAW  ← gold rush
Season 2  (days 61-120):   193.75M       ← still massive
Season 3  (days 121-180):  96.875M       ← tightening
Season 4  (days 181-240):  48.44M        ← transition to zero-sum
Season 5  (days 241-300):  24.22M        ← skilled agents only
Season 6  (days 301-360):  12.11M        ← approaching floor
Season 7+ (day 361+):      7.75M/season  ← floor (~1% of S1, perpetual)

~98.4% of mining pool emitted in year 1
Gold rush phase (S1-S2): 75% of mining pool in first 4 months
Steady state (S7+): 7.75M per 60-day season, indefinitely
```

Each season: emission halving, leaderboard reset, class rebalancing (dev-controlled in S1, data-driven from day 40-50 analysis).

### DEX liquidity: self-deployed Uniswap V3
- Pair: $CLAW/ETH on Uniswap V3 (Base)
- Fee tier: 0.3% (standard, LP fees stay in ecosystem)
- Concentrated liquidity for capital efficiency
- LP seed: 125M $CLAW + 6 ETH (~$100K FDV at $2,100/ETH)
- Initial price: ~$0.0001 per $CLAW (~0.000000048 ETH/CLAW)
- Wide V3 range: ~5x downside (~$20K FDV) to ~5x upside (~$500K FDV) for launch price discovery
- 3.5 ETH retained as operational reserve (gas, emergency LP adjustments, deployments)
- Total ETH budget: 9.5 ETH (~$20K at $2,100/ETH)
- LP fees go to liquidity providers, not extracted by third party

### Core economic model: zero-sum + deflationary
- Mining emissions are the sole inflationary source (fixed, halving schedule)
- Battle mode is zero-sum: winner takes loser's stake minus protocol fee
- New $CLAW enters only via seasonal emission budgets
- Target mint-to-burn ratio: < 1:1 (net deflationary)

### Protocol fee split (all fee sources)
Every protocol fee is split two ways:

| Recipient | Share | Purpose |
|-----------|-------|---------|
| **Burn** | **85%** | Deflationary pressure, sustains token value |
| **Dev wallet** | **15%** | Ongoing development, hosting, RPC costs |

No passive staking yield — the only way to earn $CLAW is by playing (mining, battle, breeding/selling). Applied to: mining settlement, breeding fees, marketplace trades, battle settlement, battle repair, evolution costs, lobster feeding. Flat 15% dev cut across all sources — hardcoded in Treasury.sol, verifiable on-chain.

### Token sinks (exponential)
- **Battle stakes**: zero-sum redistribution, protocol fee burned each match
- **Battle repair**: all combatants burn $CLAW to fix damage (winners pay less, losers pay more)
- **Evolution**: burn 2 fuel lobsters + $CLAW per tier (2K / 10K / 50K) — exponential NFT + token sink
- **Breeding**: costs scale exponentially by generation
- **Lobster decay**: stats degrade without feeding ($CLAW burn)
- **Tiered mining access**: higher tiers require evolved lobsters (indirect $CLAW sink via evolution costs)
- **Strategy tax**: rapid successive actions cost escalating fees

### Locking mechanisms
- Mining stakes: locked during expedition
- Battle stakes: locked during match + 5% anti-grief deposit
- Lobster locking: committed to team, active mine, or active battle = cannot sell/transfer

### Anti-convergence mechanics
- Rock-paper-scissors class dynamics across 10 classes (no dominant strategy)
- Seasonal rebalancing based on previous season data
- Information asymmetry (hidden battle team composition until commit-reveal)
- No diminishing returns per wallet — whale miners are welcome (flat weight per expedition regardless of wallet's active count)
- Strategy diversity bonus for unique approaches
- Random faucet class distribution ensures initial ecosystem diversity

## Design Principles
- Agent-first — API and contract interfaces are the primary product, not the UI
- Exploit-resistant tokenomics — economy must survive thousands of profit-maximizing AI agents
- Fair launch — 100% community token distribution; dev earns from protocol fees, not allocation
- Strategic depth — game must reward sophisticated strategies over simple scripts
- Sustainable economy — zero-sum core loop, net deflationary, no inflationary death spiral
- Composable — other protocols and agents can build on top of Clawbada's contracts
- Human-compatible — humans can still play and compete via Base App
- Lobster diversity — 10 classes with random faucet seeding ensures no monoculture at launch

## Testing
```bash
npm test                    # All tests
npm test -- --watch        # Watch mode
npm test -- --coverage     # Coverage report
npx hardhat test           # Contract tests
```
