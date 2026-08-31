# Project: Clawbada

## Quick Links
- Workflow rules: see [AGENTS.md](./AGENTS.md)
- Style/personality: see [SOUL.md](./SOUL.md)
- Custom commands: see [COMMANDS.md](./COMMANDS.md)
- Learned patterns: see [LEARNED.md](./LEARNED.md)

## Development Rules
- **Missing packages**: When a typecheck or build fails because a package is not installed, STOP and install it first (`bun add <package>` in the right workspace). Do NOT try to work around missing dependencies by restructuring imports or re-exporting from other packages. Fix the dependency, then re-run the check.

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
| **Battle Mode** | ~3-5 min | Zero-sum/deflationary | High | Winner takes pot minus protocol fee |

Roughly equal EV at ~60-65% battle win rate. Mining is safer and passive; battle rewards skill, positioning, and active play. Both modes require teams of 3 lobsters. As emissions halve each season, battle becomes the dominant $CLAW source for skilled agents.

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
Active PvP where two players wager $CLAW in hex-grid tactical combat. Zero-sum: winner takes the combined pot minus protocol fee. Both players burn additional $CLAW for post-battle repair. Battles use **ATB (Active Time Battle) initiative-bar combat** (LOKR-style) with full information during play — only team composition is hidden via on-chain commit-reveal at battle start. Trust model is server-authoritative during play with on-chain dispute resolution as a backstop (bonded disputes + rate limit; see Trust Model section).

**Entry requirement**: all 3 lobsters on the team must be Evolved tier or higher.

**Protocol fee**: 10% of combined pot (routed through Treasury.sol: 85% burned / 15% dev).

**S1 stake brackets** (fixed, matchmaking pairs by ELO within each bracket):

| Bracket | Stake | Combined Pot | Protocol Fee | Winner Gets | Winner Net | Loser Net |
|---------|-------|-------------|-------------|------------|-----------|----------|
| **Low** | 2,500 | 5,000 | 500 | 4,500 | +2,000 | -2,500 |
| **Mid** | 10,000 | 20,000 | 2,000 | 18,000 | +8,000 | -10,000 |
| **High** | 50,000 | 100,000 | 10,000 | 90,000 | +40,000 | -50,000 |

**Breakeven win rate**: ~58% (including repair costs at Evolved tier). Battle matches mining EV at ~63-65% win rate. Above 65%, battle becomes the dominant income source — increasingly so each season as emissions halve.

**Player identity badges**: Players are tagged as **Human** or **Agent** in the battle HUD, leaderboard, and marketplace. Detected by wallet type (SignInWithBase = human, agent register endpoint = agent).

#### Hex Grid Arena
Battles take place on a **6×5 pointy-top offset hex grid** (30 total hexes). Movement and positioning are core to combat.

- **~20% blocked/impassable** hexes per board (~6 blocked, ~24 playable)
- **Unique arena layouts per tier** — Evolved (coral reefs, sand banks), Elite (deep-sea trenches, crystal formations), Apex (lava flows, volcanic rock)
- **Teams spawn on opposite sides** (Team A left, Team B right)
- Blocked hexes create chokepoints and force strategic pathing
- **One lobster per hex** (no stacking), lobsters do not block movement (can path around)
- **S2-3**: procedural board generation with obstacle asset pools (rocks, crates, treasure chests, sunken ships, fire pits, lava flows)

#### Movement Ranges by Class

| Move Range | Classes | Role |
|-----------|---------|------|
| **1 hex** | Bulwark, Leviathan | Slow tanks/bruisers — hold the frontline |
| **2 hexes** | Sentinel, Abyss, Kraken, Reaver | Mid-range — flexible positioning |
| **3 hexes** | Mantis, Tempest, Specter, Ember | Fast/agile — dart in, strike, retreat |

#### Attack Distance Scaling
Attacks have range up to 3 hexes with damage falloff:

| Distance | Damage Modifier | Description |
|----------|----------------|-------------|
| **Adjacent (1 hex)** | 100% | Full melee damage |
| **2 hexes** | 75% | Ranged, reduced |
| **3 hexes** | 50% | Maximum range, half damage |
| **4 hexes (Specter only)** | 40% | Specter's extended poke; all other classes miss |
| **4+ hexes** | Miss | Out of range entirely |

#### ATB Initiative Bar
All 6 lobsters share a single time-tick initiative tracker (LOKR-style). Each lobster's next-turn tick = `prev_tick + (1000 / effective_speed)` — higher Speed means shorter gap between turns and more turns per battle. Battle UI shows the next 6-8 upcoming turns as a portrait sequence in a top HUD; both players see the full turn order in real time, including the effects of slow/haste/stun on enemy positions.

**Speed clamps + stun immunity** prevent ATB exploits:
- Effective Speed clamped to **[0.5×, 1.5×] of base** — buffs/debuffs (Tempest haste, Specter slow, Maelstrom-enhanced) cannot compound past that range
- **Stun immunity for 2 turns** after a stun expires — prevents Kraken Bind chains from perma-locking a lobster off the bar
- Both values are server-side resolver constants, tunable from telemetry without contract redeploy

**Initial bar order**: lobsters seeded in descending base Speed; ties broken by VRF beacon. No per-battle "who goes first" coin flip.

#### Battle Flow (8 phases)
```
1. MATCHMAKING (off-chain)
   Player POSTs to /api/game/combat/queue with teamId + stakeAmount
   ELO-based matchmaking pairs players at similar stake tiers
   Match found → both players notified via WebSocket

2. STAKE DEPOSIT (on-chain)
   Both players call BattleArena.deposit(battleId, stakeAmount)
   $CLAW escrowed in contract + 5% anti-grief deposit
   Both deposits confirmed → battle begins

3. TEAM COMMIT-REVEAL (on-chain)
   Both players commit team composition hash
   After both commits: both reveal lobster assignments
   Prevents counter-picking — neither side sees the other's team first

4. VRF BEACON (on-chain)
   One drand beacon rolled at TEAM_REVEAL seeds all battle randomness
   Deterministic RNG stream powers damage variance, crits, enhanced procs
   Critical for replay/dispute reproducibility

5. BATTLE (off-chain via WebSocket, server-authoritative)
   ATB initiative bar runs; each lobster takes its turn in order:
     - Controlling player has 60s shot clock to commit Move + Action
     - Auto-Defend on timeout
     - Server resolves the action, animates, advances bar, places next tick
   Battle ends on team wipeout (or 100-turn hard cap with HP% tiebreak)
   Full turn log persisted server-side for replay/dispute
   ~3-5 minutes typical match duration

6. SETTLEMENT (on-chain)
   Server submits (battleId, winner, finalStateHash, turnLogHash, signature) to BattleArena.settle()
   Winner's payout escrowed pending dispute window
   Protocol fee → Treasury.sol (85% burn / 15% dev split)

7. DISPUTE WINDOW (on-chain, optional)
   Loser may challenge by calling BattleArena.disputeBattle(battleId, evidence) with a bond
   Window per bracket: 5 min (Low) / 30 min (Mid) / 1 hour (High), configurable
   Disputer posts 10% bracket bond (250 / 1,000 / 5,000 $CLAW); rate limit 5/24h per address
   S1 resolution: adminResolveDispute() — DEFAULT_ADMIN_ROLE (multisig) judges within 24h SLA
   S2 evolution: BattleResolver.replay() — deterministic on-chain re-execution from VRF beacon + turn log
   Disputer wins → bond returned + penalty paid; disputer loses → bond slashed → Treasury (burn/dev split)
   99% of battles never enter dispute path; mechanism is deterrent + insurance

8. REPAIR (on-chain)
   Both players call RepairShop.repair(lobsterId) for damaged lobsters
   $CLAW burned for repairs (scales with tier + damage severity)
   Lobsters with ≥80 damage points cannot enter battle until repaired
```

#### Turn Structure
A lobster's turn = optional **Move** (within class movement range) followed by one **Action** (Attack / Defend / Special). Combinations allowed: Move only, Action only, or Move-then-Action. **No "act-then-move"** in S1 — reserved for class-specific traits in later seasons (e.g., Mantis "Strike & Vanish").

- **Per-turn shot clock**: 60 seconds. On expiry, unsubmitted lobster auto-Defends and turn auto-commits.
- **Auto-forfeit**: after 3 consecutive timeouts by the same player, anti-grief deposit slashed and forfeit awarded.
- **Full information during battle**: nothing hidden — both players see board state, HP, charge, status effects, upcoming turn order. Telegraphed enemy intent (LOKR-style) hints at the next enemy lobster's likely target/action for human UX; agents ignore it.
- **Hidden information**: only team composition (commit-reveal at battle start, prevents counter-picking).

**MEV protection**: Base Flashblocks (200ms block times) have no public mempool, providing inherent MEV resistance. In-battle turn commits are off-chain via WebSocket; only stake deposit, team reveal, settlement, and disputes are on-chain.

#### Combat Resolution

**4 action types:**
- **Attack** — deal damage to a target enemy lobster within range. Damage scales with distance.
- **Defend** — reduce incoming damage by 50%, deal small counter-damage on adjacent attackers (no counter vs Specials).
- **Move** — reposition to an open hex within class movement range. No collisions (turn-based, only one lobster moves at a time).
- **Special** — class-specific ability, costs 3 charge, consumes all.

**Charge economy:**
- Each lobster turn taken grants **1 charge** (whether Move+Action, Action only, or Move only)
- **Defend grants +1 bonus charge** (Defend turns yield 2 charges total — preserves the "bank charge by Defending" trade-off)
- Special costs 3 charge, consumes all charge accrued
- Charge cap: 3 (cannot bank past 3)
- Specials available every ~3 turns of active play, every ~2 turns of dedicated Defending

**Stat roles:**

| Stat | Role | Mechanic |
|------|------|----------|
| **HP** | Health pool | Lobster dies at 0. Used as-is (battle HP scale ×1), tuned for 24-36 turn pacing. |
| **Attack** | Offense | Numerator in damage ratio (Attack / Armor) |
| **Armor** | Defense | Denominator in damage ratio (Attack / Armor) |
| **Speed** | Initiative tempo | ATB tick frequency: faster = more turns per battle. Clamped to [0.5×, 1.5×] of base by buffs/debuffs. |
| **Critical** | Crit chance | `crit_chance = Critical / (Critical + 200)`. Crit = 1.5× damage. |

**Base class stats (before body part modifiers, evolution, legend):**

| Class | HP | Atk | Armor | Spd | Crit | Identity |
|-------|-----|-----|-------|-----|------|----------|
| **Bulwark** | 700 | 100 | 120 | 80 | 90 | Tank — holds chokepoints, survives everything |
| **Mantis** | 375 | 100 | 70 | 130 | 125 | Assassin — flanks, strikes first, crits often |
| **Leviathan** | 600 | 130 | 100 | 70 | 80 | Bruiser — hits hardest, slow to reposition |
| **Tempest** | 450 | 110 | 80 | 105 | 115 | Nuker — AoE from range, fragile up close |
| **Specter** | 425 | 85 | 85 | 125 | 120 | Debuffer — kites and cripples from distance |
| **Sentinel** | 650 | 70 | 110 | 90 | 100 | Support — positions near allies to heal |
| **Reaver** | 475 | 120 | 80 | 110 | 95 | DPS — closes distance, bleeds targets |
| **Abyss** | 525 | 110 | 90 | 95 | 100 | Lifesteal — self-sustaining in melee |
| **Kraken** | 550 | 90 | 100 | 105 | 95 | Controller — mid-range stuns decide rounds |
| **Ember** | 350 | 140 | 60 | 100 | 130 | Glass cannon — nukes from max range, dies up close |

Stats scale with evolution (+20/40/60%) and legend (+10%). Body part modifiers add further variation.

**Damage formula (Attack action):**
```
damage = 100 × min(Attack / Armor, 2.2) × class_mult × crit_mult × distance_mult × VRF

Where:
  100             = Attack base power
  Attack/Armor    = stat ratio, capped at 2.2× to prevent one-shots
  class_mult      = 1.25 (advantage) | 1.0 (neutral) | 0.80 (disadvantage)
  crit_mult       = 1.5 (on crit) | 1.0 (normal hit)
  distance_mult   = 1.0 (adjacent) | 0.75 (2 hex) | 0.50 (3 hex) | miss (4+)
  VRF             = drand variance, uniform [0.85, 1.15]
```

**Defend action:**
```
incoming_damage = incoming_damage × 0.50    (halves all incoming damage until lobster's next turn)
counter_damage  = 30 × min(Attack / Armor, 2.2) × class_mult × VRF
                  (no counter against Specials — Special overwhelms Defend)
                  (counter only triggers if attacker is adjacent)
charge_gained   = 2 (1 base + 1 Defend bonus)
```

**Move action:**
```
Reposition to any open hex within class movement range (1/2/3 hexes)
No damage dealt or received from moving
No collisions: turn-based, only one lobster moves at a time
charge_gained   = 1 if Move-only; 1 if Move-then-Action; 2 if Move-then-Defend
```

**Special action:**
```
damage = special_base × min(Attack / Armor, 2.2) × class_mult × purity_mult × VRF
purity_mult = (1 + 0.10 × purity_score)
Enhanced: VRF roll against (5% + 5% × purity_score)

Defend halves Special damage but does not counter it.
Range: class-specific (see Special Ranges table below)
charge_consumed = 3 (all charge cleared)
```

**Special base power and range by class:**

| Class | Special | Base | Type | Range | Effect |
|-------|---------|------|------|-------|--------|
| **Bulwark** | Fortify | — | Utility | Self/team (any) | Team incoming damage -40% for 2 turns of each protected lobster |
| **Mantis** | Ambush | 150 | Single | Adjacent | Ignores 50% of target's Armor |
| **Leviathan** | Crush | 180 | Single | Adjacent | Highest single-target burst |
| **Tempest** | Maelstrom | 120 | AoE | 3-hex radius | Hits all enemies in range (360 total potential) |
| **Specter** | Haunt | 60 | Debuff | 3 hexes | Damage + target Atk/Armor -20% for 4 turns of target |
| **Sentinel** | Rally | — | Heal | 2 hexes (ally) | Restores 25% of ally's max HP + cleanses debuffs |
| **Reaver** | Rend | 70 | DoT | Adjacent | Hit + 55 bleed/turn for 6 turns of target (400 total) |
| **Abyss** | Devour | 150 | Drain | Adjacent | Damage dealt also heals self |
| **Kraken** | Bind | 60 | CC | 2 hexes | Damage + stun target for 1 turn (then 2-turn stun immunity) |
| **Ember** | Inferno | 200 | Nuke | 4 hexes | Highest burst, caster takes 25% of damage dealt |

Note: status effect durations are in **turns of the affected lobster** (since ATB means different lobsters take different numbers of turns over the same wall-clock window).

**Class advantage:** 1.25× damage (offense-only) when attacker's class beats defender's. 0.80× when disadvantaged. Neutral = 1.0×. Each class beats 4 and loses to 4 in the tournament graph.

**Resolution per turn:**
1. Selected lobster's player commits Move + Action within 60s shot clock
2. Move resolves (if any) — repositions on hex grid
3. Action resolves — damage dealt, target's Defend halves incoming, status effects applied
4. Counter-attacks (if defender was Defending and adjacent attacker) resolve
5. Charges granted; ATB bar updated with current lobster's next-tick
6. Animation plays, control passes to next lobster's player

**Win condition:** Eliminate all 3 enemy lobsters. Hard cap: 100 total turns with HP% tiebreak as a griefer cutoff (rarely reached in real games).

**Battle pacing:** Turns 1-6 typically establish positioning; Specials become available from each lobster's 3rd turn (or 2nd if Defending). Fast classes get more turns on the bar — a Mantis (130 Spd) takes ~1.86× as many turns as a Leviathan (70 Spd) over the same battle window. Most battles resolve in 24-36 total turns (~3-5 minutes).

**Randomness:** drand-based VRF (Proof of Play model). Single beacon rolled at TEAM_REVEAL seeds a deterministic RNG stream for the entire battle: damage variance (±15%), critical hits, enhanced Special procs. Beacon verified on-chain via BattleVRF.sol; same beacon reproduces the battle for replay/dispute.

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
| **Specter** | Haunt | Extends to 6 turns of target + stronger reduction |
| **Sentinel** | Rally | Also grants damage shield for 1 round |
| **Reaver** | Rend | Bleed cannot be cleansed |
| **Abyss** | Devour | Overheal converts to temporary HP |
| **Kraken** | Bind | Stun pierces Defend stance |
| **Ember** | Inferno | Reduced self-damage on enhanced proc |

**Design rationale:** Purity creates dramatic VRF-driven battle moments rather than flat stat advantages. A pure lobster's Special is reliably devastating; an impure lobster's Special is functional but unexceptional. Breeders sell *battle potential*, not mining efficiency.

#### 10 Lobster Classes (Finalized)

| # | Class | Role | Move Range | Special Move | Description |
|---|-------|------|-----------|-------------|-------------|
| 1 | **Bulwark** | Tank | 1 hex | Fortify | AoE damage reduction for entire team |
| 2 | **Mantis** | Assassin | 3 hexes | Ambush | Flank and ignore armor, bonus crit |
| 3 | **Leviathan** | Bruiser | 1 hex | Crush | Massive single-target melee damage |
| 4 | **Tempest** | Nuker | 3 hexes | Maelstrom | AoE damage from range |
| 5 | **Specter** | Debuffer | 3 hexes | Haunt | Kite and reduce target stats |
| 6 | **Sentinel** | Support | 2 hexes | Rally | Position near allies to heal + cleanse |
| 7 | **Reaver** | DPS | 2 hexes | Rend | Close distance, apply bleed |
| 8 | **Abyss** | Lifesteal | 2 hexes | Devour | Melee lifesteal, self-sustaining |
| 9 | **Kraken** | Controller | 2 hexes | Bind | Mid-range stun control |
| 10 | **Ember** | Glass Cannon | 3 hexes | Inferno | Max range nuke, dies up close |

**Balanced tournament graph** — each class beats 4 and loses to 4 (no dominant strategy). Class advantage gives a damage multiplier in combat. The 10-class cycle creates deep team composition AND positioning strategy.

#### Team Composition Rules
- **Minimum tier gate**: all 3 lobsters must meet the activity's minimum tier (battle = Evolved+)
- **Can exceed minimum**: mixed tiers above the floor allowed (e.g., 1 Evolved + 2 Elite = OK)
- **Duplicate classes allowed**: mono-class teams are valid but generally suboptimal due to shared weaknesses and movement limitations

#### Battle Brackets & Matchmaking
**Three stake brackets** (Low 2,500 / Mid 10,000 / High 50,000 $CLAW) define the economic tier. **Team Power buckets** (3–9, integer sum of tier weights: Evolved=1 / Elite=2 / Apex=3) define the competitive tier. Players are matched within (power × stake) sub-pools — up to 21 sub-pools total.

**Adaptive radius expansion** prevents thin-pool starvation at launch:
- 0–30 s: exact power match
- 30–60 s: ±1 power
- 60–120 s: ±2 power
- 120 s+: any power within stake bracket (HUD warns of mismatch)

**Why Power Matchmaking**: closes the tier-mixing smurfing vector. A team of 1 Evolved + 2 Apex (Power 7) at Low stake would otherwise dominate genuine 3 × Evolved teams (Power 3); under Power Matchmaking these teams are in different sub-pools and never paired. Mixed-tier compositions sit in thin pools, so wait time becomes the smurfing disincentive — no need to "ban" anything.

**Consent at match found**: opponent power score is shown alongside the deposit prompt. The 2-minute Deposit-phase window is the consent mechanism — accept the matchup by depositing, decline by walking away (no penalty pre-deposit; the un-deposited player's stake never enters escrow). No new on-chain phase required; reuses the audited Deposit window.

**ELO weighting** deferred to S1.5 — random pairing within (power × stake) at launch.
**Cancel-rate throttling** deferred — telemetry-only at launch.
**Procedurally generated arena layouts**: S2-3 enhancement.

#### Trust Model & Dispute System
Battle outcomes are **server-authoritative during play** with **on-chain dispute resolution** as a backstop. The rollout has two stages — see `~/.claude/projects/-Users-alepore-Clawbada/memory/project_battle_v2_redesign.md` for full S1/S2 detail:

- **S1 (ships first)**: extends the H-01 challenge window already shipped on `origin/main` (2026-04-28) with V3 spam defenses — per-bracket windows, bonded disputes, rate limit. Resolution remains `adminResolveDispute()` (`DEFAULT_ADMIN_ROLE` multisig, 24h SLA per `docs/runbooks/admin-roles.md`).
- **S2 (roadmap)**: replaces admin arbitration with on-chain `BattleResolver.replay()` — deterministic re-execution from `{initial state + VRF beacon + ordered turn submissions}`. Trust-minimal end state, no human in the resolution path.

**Common to both stages:**

- **Server runs `BattleResolver`** during play (pure function, identical to on-chain library); clients request actions and animate results, never compute damage. Closes off the client-side cheat surface.
- **Settlement on-chain**: server submits `(battleId, winner, finalStateHash, turnLogHash, signature)` to `BattleArena.settle()` after match ends; transitions to `AwaitingFinalize` (no payout yet).
- **Dispute window** per stake bracket (configurable): 5 min (Low) / 30 min (Mid) / 1 hour (High).
- **Disputer must post a bond** (10% of bracket stake: 250 / 1,000 / 5,000 $CLAW). Bond covers admin/replay overhead + deters frivolous disputes.
- **Outcomes**:
  - **Disputer wins** (server lied / replay disagrees) → bond returned, disputer refunded full stake + penalty
  - **Disputer loses** → bond slashed → Treasury (85% burn / 15% dev)
- **Rate limit**: 5 disputes per address per rolling 24h window, enforced on-chain via `disputeTimestamps[address]`. Reverts with `DisputeRateLimitExceeded` when exceeded.
- 99% of battles never enter dispute path. The system exists as deterrent + insurance.

#### Anti-Griefing
- **5% anti-grief deposit**: slashed if player times out repeatedly or forfeits, returned otherwise
- **Auto-forfeit**: after 3 consecutive per-turn timeouts by the same player, forfeit awarded and anti-grief deposit slashed
- **60-second per-turn shot clock**: generous for humans on hex grid; agents submit in <1s, turn proceeds immediately on commit (auto-Defend on timeout)
- **Bonded disputes + rate limit** (see Trust Model above): disputer posts 10% bracket bond; max 5 disputes per address per rolling 24h
- **Speed clamps + stun immunity**: prevent ATB exploits (effective Speed ∈ [0.5×, 1.5×] of base; 2-turn stun immunity after stun expires)
- **Design principle**: griefing is always negative EV. Agents are rational profit-maximizers; the economics ensure cooperation with the protocol.

#### Repair System (Ongoing Battle Sink)
Every battle inflicts damage on all participating lobsters:

| Outcome | Damage Points |
|---------|--------------|
| **Winner** | 5-15 (VRF) |
| **Loser** | 20-40 (VRF) |

**Repair is instant** — player calls `RepairShop.repair(lobsterId, pointsToRepair)`, pays $CLAW, damage is removed immediately. No time delay or cooldown. Partial repairs allowed (repair just enough to stay under 80 threshold).

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
- Creates exponential demand: evolving to Apex requires burning 26 Base-tier lobsters total (the 27th is the target that transforms)
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
- **Battle Engine**: Unity WebGL (embedded on battle page only; rest of app stays React/Next.js)
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
├── BattleArena.sol     # Battle lifecycle: stake deposit, team commit-reveal, settlement, dispute resolution, anti-grief
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
│   │   ├── status      # GET: battle state, current turn, initiative bar
│   │   ├── moves       # POST: submit lobster turn (Move + Action)
│   │   └── history     # GET: past battles, replays, dispute records
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

### Battle engine (Unity WebGL — embedded in battle page)
```
packages/battle-engine/  # Unity project — hex grid, animations, VFX
  → Builds to apps/web/public/unity-build/
  → Communication: React ↔ Unity via react-unity-webgl / postMessage bridge
  → Data flow: Server (WebSocket) → React (game state) → Unity (render)
  → User input: Unity (hex clicks) → React (commit to server)
```

### Off-chain game engine
```
server/
├── combat/             # Battle resolution engine, damage calc, hex grid logic, turn logic
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
- **Battle mode** — hex-grid tactical PvP on 6×5 board, 4 action types (Attack/Defend/Move/Special), ATB initiative-bar combat with full information (LOKR-style), distance-scaled attacks, 60s per-turn shot clock, server-authoritative with on-chain dispute window (10% bonded + 5/24h rate limit), Unity WebGL rendering, drand VRF randomness, ~3-5 min per match
- **Movement ranges** — 1 hex (Bulwark, Leviathan), 2 hexes (Sentinel, Abyss, Kraken, Reaver), 3 hexes (Mantis, Tempest, Specter, Ember)
- **Player badges** — Human vs Agent identity shown in battle HUD, leaderboard, marketplace
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
| **Mining emissions** | 70.5% | 705M | Earned through gameplay — the core distribution |
| **DEX liquidity** | 12.5% | 125M | Self-deployed Uniswap V3 pool ($CLAW/ETH, 0.3% fee tier) |
| **Treasury** | 10% | 100M | Protocol reserves, bug bounties, future game modes |
| **Faucet pre-mint** | 7% | 70M | Onboarding drip (~10K wallets × 7K $CLAW via Lobster + $CLAW Faucet) |

No airdrop. Agents earn tokens by playing, not by showing up. Self-deployed LP — no Clanker (1% fee is too extractive for a high-frequency game token).

### Emission schedule: 60-day seasons with halving, hard-capped at 705M (TOK-M1)
```
Season 1  (days 1-60):     352.5M $CLAW  ← gold rush
Season 2  (days 61-120):   176.25M       ← still massive
Season 3  (days 121-180):  88.125M       ← tightening
Season 4  (days 181-240):  44.06M        ← transition to zero-sum
Season 5  (days 241-300):  22.03M        ← skilled agents only
Season 6  (days 301-360):  11.02M        ← approaching the cap
Season 7   (days 361-420):  7.05M        ← tail (cumulative 701.0M)
Season 8+ (day 421+):      ≤3.97M then 0 ← 705M cap reached, mining emissions END

Cumulative S1–S6: 693.98M; S7: 701.03M; the 705M allocation is exhausted in S8.
~98.4% of mining pool emitted in year 1.
Gold rush phase (S1-S2): 75% of mining pool in first 4 months.
```

**705M is a HARD lifetime cap, enforced on-chain** (`MiningPool.MINING_ALLOCATION` /
`lifetimeMinted`; reverts `MiningAllocationExhausted`). Mining is a fair-launch
*distribution* of a fixed 70.5% slice — NOT a perpetual emission. Once cumulative
mining issuance reaches 705M (≈S8), mining yields zero forever; from that point the
economy is purely **zero-sum (battle redistribution) + deflationary (fee burns)**,
exactly the "battle becomes the dominant $CLAW source as emissions halve" trajectory.

> Superseded design note (TOK-M1): an earlier draft described a *perpetual* 7.05M/season
> floor "indefinitely." That is incompatible with a fixed 705M allocation (a flat
> perpetual floor sums to infinity and breaches 705M by ~S8) and is intentionally
> dropped. If a perpetual steady-state reward is ever reintroduced, it must be funded
> from a non-inflationary source (treasury/recycled fees), not fresh mint.

Each season: emission halving (until the cap), leaderboard reset, class rebalancing (dev-controlled in S1, data-driven from day 40-50 analysis).

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
