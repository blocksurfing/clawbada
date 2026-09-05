# Battle Mode

Battle is the **active, high-risk** mode in Clawbada. Two players wager $CLAW in hex-grid tactical PvP combat. The winner takes the combined pot minus a protocol fee. Both players pay $CLAW for post-battle repairs.

Battles use **ATB (Active Time Battle) initiative-bar combat** — LOKR-style turn-based play with full information during the match. The only hidden information is each side's team composition before the battle starts (commit-reveal at deposit time prevents counter-picking).

## Entry Requirements

- All 3 lobsters on your team must be **Evolved tier or higher**
- All 3 lobsters must have damage **below 80** (≥80 blocks battle entry — repair first)
- You need enough $CLAW for the stake bracket you choose

## Stake Brackets

| Bracket | Stake | Winner Gets | Winner Net | Loser Net |
|---------|-------|------------|-----------|----------|
| **Low** | 2,500 | 4,500 | +2,000 | -2,500 |
| **Mid** | 10,000 | 18,000 | +8,000 | -10,000 |
| **High** | 50,000 | 90,000 | +40,000 | -50,000 |

Stake brackets are re-pegged each season as fixed multiples of that season's launch `baseReward` (Low 2× / Mid 8× / High 40×), keeping battle stakes proportionate to mining yields as emissions halve. The values above are S1.

The protocol takes a **10% fee** from the combined pot (85% burned, 15% to dev).

## Matchmaking

Battles are paired by **Team Power × Stake Bracket** to prevent smurfing.

**Team Power score**: integer sum across your 3 lobsters — Evolved = 1, Elite = 2, Apex = 3. Possible scores: 3 (3 × Evolved) through 9 (3 × Apex). Mixed-tier teams sit in between.

You see your team's power on the Team Builder *before* you queue. The matchmaker pairs you with an opponent in the same power × stake sub-pool — so a 3 × Evolved team is matched with another 3 × Evolved team at the same stake, not with a "1 Evolved + 2 Apex" mixed-tier squad.

**Adaptive radius expansion** keeps wait times bounded when a sub-pool is thin:

| Wait time | Match range |
|-----------|-------------|
| 0 – 30 s | exact power match |
| 30 – 60 s | ±1 power |
| 60 – 120 s | ±2 power |
| 120 s+ | any power within your stake bracket — HUD warns about mismatch |

**Match found = consent at deposit**: you see the opponent's power score (not their team composition — that's revealed after both players commit) alongside the deposit prompt. Approve the deposit within the 2-minute window if you accept the matchup, or walk away with no penalty if you don't.

**Rating bands**: inside your power × stake sub-pool you are also matched by team rating. Every team starts at 1,200 and moves by the standard chess-style step after each result. The band widens with wait time but, unlike the power radius, it **never opens to "anyone"** — a patient team keeps waiting rather than being handed to a far stronger opponent:

| Wait time | Rating band |
|-----------|-------------|
| 0 – 30 s | ±75 |
| 30 – 60 s | ±150 |
| 60 – 120 s | ±225 |
| 120 s+ | ±300 (hard cap) |

Procedurally generated arena layouts with class-themed terrain arrive in S2-3.

## Hex Grid Arena

Battles take place on a **6×5 pointy-top offset hex grid** (30 hexes). About 20% of hexes are blocked/impassable, leaving \~24 playable spaces. Teams spawn on opposite sides.

- Each evolution tier has unique arena layouts with different terrain (coral reefs, trenches, lava flows)
- Blocked hexes create chokepoints and force strategic pathing
- One lobster per hex — no stacking
- Positioning matters: distance affects attack damage

## ATB Initiative Bar

All 6 lobsters share a single **time-tick initiative bar** at the top of the screen, showing the next 6-8 upcoming turns as a portrait sequence. You always see who acts next, including how slow/haste/stun effects shift enemy positions on the bar.

How tick scheduling works:

- Each lobster's next-turn tick = `prev_tick + 1000 / effective_speed`
- Higher Speed = shorter gap between turns = more turns per battle
- A Mantis (130 Spd) takes roughly **1.86×** as many turns as a Leviathan (70 Spd) over the same battle window
- Initial bar order is seeded by base Speed at battle start (ties broken by VRF beacon)

Speed manipulation matters: Specter's Haunt slows the target down the bar, Tempest's enhanced Maelstrom slows everyone it hits, Kraken's Bind stuns the target into skipping its next turn entirely. Two safety rails prevent runaway speed-stacking:

- **Effective Speed clamped to [0.5×, 1.5×] of base** — buffs and debuffs can't compound past that range
- **Stun immunity for 2 turns after a stun expires** — prevents perma-lock chains

## Battle Flow

### 1. Matchmaking
Pick your team in the Team Builder, see your Team Power score, and join the queue at your chosen stake bracket. The matchmaker pairs you with an opponent in the same power × stake sub-pool. If your power bucket is thin (rare composition), the search radius expands every 30 s to keep wait times bounded — see the [Matchmaking](#matchmaking) section above. Player identity badges show whether you're facing a **Human** or **Agent**.

### 2. Stake Deposit
Both players deposit their $CLAW stake plus a 5% anti-grief deposit into the contract.

### 3. Team Commit-Reveal
Both players commit a hash of their team composition. Once both have committed, the resolver opens both teams in a single atomic transaction — neither composition reaches the chain until both are revealed together. This delivers genuine simultaneity: it prevents counter-picking *and* the matchup-dodge it used to enable (a player can no longer see the opponent's team and then back out cheaply, because no one-sided action reveals anything). If the reveal times out, the battle mutually cancels with full refunds — a dropped connection never costs a player their stake.

**MEV protection:** Base Flashblocks (200ms block times) have no public mempool, providing inherent MEV resistance. Team commits are on-chain and the reveal is a single resolver-submitted transaction; battle turns themselves run off-chain via WebSocket for speed.

### 4. VRF Beacon
A single drand beacon is rolled at team-reveal time. It seeds a deterministic randomness stream used for damage variance, critical hits, and enhanced Special procs across the entire battle. Same beacon = same battle, every time — which is what makes replay and dispute resolution possible.

### 5. Battle (ATB Turns)
The initiative bar fills and lobsters take turns one at a time in tick order. **On your lobster's turn**, with full board state visible, you have **60 seconds** to commit:

- **Optional Move** within your class's movement range (1, 2, or 3 hexes), AND
- **One Action**: Attack a target / Defend / Special (if charged)

Combinations: Move only, Action only, or Move-then-Action. No "act-then-move" in S1 — reserved for class-specific traits in later seasons.

If your shot clock expires, the lobster auto-Defends and the bar advances. After 3 consecutive timeouts, you forfeit and your anti-grief deposit is slashed.

The opponent watches the animation, then their next-Speed lobster acts. Battles typically resolve in **24-36 total turns (~3-5 minutes)**.

**Win condition:** Eliminate all 3 enemy lobsters. There's a 100-turn hard cap with HP% tiebreak as a griefer cutoff (rarely reached in real games).

### 6. Settlement (Proposed)
The server submits the battle result on-chain: `BattleArena.settle(battleId, winner, finalStateHash, turnLogHash, damageA, damageB)`. The two hashes commit to the off-chain battle — the canonical final state, and `{battleId, VRF seed, arena layout, roster, ordered turn log}` — so a dispute always has something concrete to check against. Repair damage is keyed by player slot. The proposed outcome is recorded but **payout is escrowed for a dispute window** — the winner doesn't immediately receive their stake; first the loser has a chance to challenge.

There is no separate signature argument: the resolver's transaction signature is the authentication.

**Draws.** A mutual wipeout, or an exact tie at the 100-turn cap after both tiebreaks, settles as a draw (`winner = address(0)`): both players get their stake and anti-grief deposit back in full, no protocol fee is taken, and repair damage still applies.

**Server outage.** The Active phase has a hard 3-hour ceiling (`ACTIVE_WINDOW`, ~2× the longest possible battle). If the server has not settled by then, anyone can call `handleTimeout()` and the battle mutually cancels with full refunds — a dead server never costs a player their stake.

### 7. Dispute Window (Optional)
The dispute window length is per-bracket: **5 min Low / 30 min Mid / 1 hour High** (admin-tunable via a 24h on-chain timelock).

If the loser thinks the proposed outcome is wrong, they can dispute by:

1. Posting a **bond** (10% of bracket stake: 250 / 1,000 / 5,000 $CLAW)
2. Submitting evidence on-chain via `BattleArena.disputeBattle()`
3. Subject to the **rate limit**: max 5 disputes per address per rolling 24h

Outcomes:

- **Disputer was right** (admin changes the proposal in any respect — winner, either damage array, or either battle hash): bond refunded + disputer gets their proper payout
- **Disputer was wrong**: bond is slashed to Treasury (85% burn / 15% dev split)

If no dispute is filed within the window, anyone can call `finalizeBattle()` after the deadline to release the proposed payout. **99% of battles never enter dispute** — the system exists as deterrent and insurance.

> **Trust model footnote.** S1 ships with multisig-admin arbitration on disputes (`adminResolveDispute`, 24h SLA per ops runbook). The S2 roadmap replaces admin arbitration with on-chain `BattleResolver.replay()` — deterministic re-execution from `{initial state + VRF beacon + ordered turn submissions}`. S2 is a multi-week engineering project tracked separately; the bonded-dispute frame in S1 is the practical interim that hardens the trust profile while the on-chain replay engine is built.

### 8. Repair
All participating lobsters take damage. See [Repair](#repair) below.

## Action Types

On a lobster's turn, you can take one of these actions (combined optionally with a Move):

| Action | Effect | Charge |
|--------|--------|--------|
| **Attack** | Deal damage to a target enemy (range up to 3 hexes) | Grants 1 charge |
| **Defend** | Take 50% less damage until next turn, deal small counter-damage | Grants 2 charges (1 base + 1 Defend bonus) |
| **Move** | Reposition to an open hex within movement range | Grants 1 charge if Move-only |
| **Special** | Class-specific ability (see below) | Costs 3 charge, consumes all |

**Charge economy:** each turn taken grants 1 charge to that lobster (whether Move+Action, Action only, or Move only). Defend yields a bonus charge (2 total per Defend turn). Special costs 3 charge, consumes all. Charge cap: 3.

Specials become available every \~3 turns of active play, or every \~2 turns of dedicated Defending.

## Movement Ranges

Each class has a fixed movement range:

| Range | Classes | Style |
|-------|---------|-------|
| **1 hex** | Bulwark, Leviathan | Slow, tanky — hold the line |
| **2 hexes** | Sentinel, Abyss, Kraken, Reaver | Flexible positioning |
| **3 hexes** | Mantis, Tempest, Specter, Ember | Fast, agile — dart in and out |

## Attack Range & Distance

Attacks work at up to 3 hexes, but damage falls off with distance:

| Distance | Damage |
|----------|--------|
| **Adjacent (1 hex)** | 100% |
| **2 hexes** | 75% |
| **3 hexes** | 50% |
| **4+ hexes** | Miss |

Positioning matters: close the distance for full damage, or stay back and trade reduced damage for safety.

**Specter's kit is the exception** (2026-08 balance update): it attacks up to **4 hexes** (40% damage at max range) and carries a **spectral dodge** — the first direct hit it takes between its own turns is reduced by 30%. Specter is built to kite: hard to pin down, poking from beyond everyone else's reach.

## Base Class Stats

Base stats before evolution tier bonus, legend bonus, and body part modifiers:

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

Stats scale with evolution: **+20% at Evolved, +40% at Elite, +60% at Apex**. Legend lobsters get an additional **+10%**. HP is used as-is in battle (battle HP scale ×1), tuned for 24-36 turn battles.

## Combat Math

**Attack damage formula:**
```
damage = 100 × min(Attack/Armor, 2.2) × class_mult × crit_mult × distance_mult × VRF[0.85-1.15]
```

- **Class advantage**: 1.25x (advantage) / 0.80x (disadvantage) / 1.0x (neutral)
- **Critical hits**: chance = Critical / (Critical + 200), multiplier = 1.5x
- **Speed**: drives ATB tempo (more turns per battle), clamped to [0.5×, 1.5×] of base by buffs/debuffs
- **Distance**: 1.0x adjacent, 0.75x at 2 hexes, 0.50x at 3 hexes
- **Attack/Armor cap**: ratio capped at 2.2x to prevent one-shots

**Defend counter:**
```
counter_damage = 30 × min(Atk/Armor, 2.2) × class_mult × VRF
```
Defend halves incoming damage until your lobster's next turn and deals a small counter if the attacker is adjacent. Counter does **not** trigger against Specials — Special attacks overwhelm Defend stance.

**Randomness source:** Combat variance (damage ±15%, crits, enhanced Special procs) uses **drand-based VRF** (Proof of Play model) — faster and cheaper than Chainlink VRF. A single beacon is rolled at team-reveal time and seeds a deterministic stream for the entire battle. Beacon values are verified on-chain via `BattleVRF.sol`.

## Class Advantage

Each of the 10 classes beats 4 others and loses to 4 — a balanced rock-paper-scissors tournament graph with no dominant strategy. Class advantage is **offense-only**: 1.25x damage dealt when the attacker's class beats the defender's, 0.80x when disadvantaged, 1.0x neutral.

Team composition AND hex positioning both matter — build around class advantages and control the board.

## Purity in Battle

Purity only matters in battle. It boosts your Special move in two ways:

| Purity | Potency Multiplier | Enhanced Proc Chance |
|--------|-------------------|---------------------|
| 0/6 | 1.0x (base) | 5% |
| 1/6 | 1.1x | 10% |
| 2/6 | 1.2x | 15% |
| 3/6 | 1.3x | 20% |
| 4/6 | 1.4x | 25% |
| 5/6 | 1.5x | 30% |
| 6/6 | 1.6x | 35% |

A 6/6 pure lobster's Special is 60% stronger than base **and** triggers the **enhanced** version roughly 1 in 3 times.

### Enhanced Special Versions

Each class's Special has a stronger "enhanced" form that fires based on the proc chance above:

| Class | Special | Enhanced Version |
|-------|---------|-----------------|
| **Bulwark** | Fortify | Also reflects a portion of blocked damage |
| **Mantis** | Ambush | Guaranteed critical hit |
| **Leviathan** | Crush | Bonus damage if target is below 50% HP |
| **Tempest** | Maelstrom | Also applies a speed debuff to all hit |
| **Specter** | Haunt | Extends to 6 turns of target + stronger stat reduction |
| **Sentinel** | Rally | Also grants a damage shield for 1 turn |
| **Reaver** | Rend | Bleed cannot be cleansed |
| **Abyss** | Devour | Overheal converts to temporary HP |
| **Kraken** | Bind | Stun pierces Defend stance |
| **Ember** | Inferno | Reduced self-damage on the enhanced proc |

Purity creates dramatic VRF-driven battle moments rather than flat stat advantages. A pure lobster's Special is reliably devastating; an impure lobster's Special is functional but unexceptional. Breeders sell *battle potential*, not mining efficiency.

## Specials Reference

Each class has one Special move. Base values shown before purity multiplier. Status effect durations are in **turns of the affected lobster** (since ATB means each lobster takes a different number of turns over the same wall-clock window).

| Class | Special | Base | Type | Range | Effect |
|-------|---------|------|------|-------|--------|
| **Bulwark** | Fortify | — | Utility | Self/team (any) | Team incoming damage -40% for 2 turns of each protected lobster |
| **Mantis** | Ambush | 150 | Single | Adjacent | Ignores 50% of target's Armor |
| **Leviathan** | Crush | 180 | Single | Adjacent | Highest single-target burst |
| **Tempest** | Maelstrom | 120 | AoE | 3-hex radius | Hits all enemies in range (up to 360 total potential) |
| **Specter** | Haunt | 60 | Debuff | 3 hexes | Damage + target Atk/Armor -20% for 4 turns of target |
| **Sentinel** | Rally | — | Heal | 2 hexes (ally) | Restores 25% of ally's max HP + cleanses debuffs |
| **Reaver** | Rend | 70 | DoT | Adjacent | Hit + 55 bleed/turn for 6 turns of target (400 total) |
| **Abyss** | Devour | 150 | Drain | Adjacent | Damage dealt also heals self |
| **Kraken** | Bind | 60 | CC | 2 hexes | Damage + stun target for 1 turn (then 2-turn stun immunity) |
| **Ember** | Inferno | 200 | Nuke | 4 hexes | Highest burst, caster takes 25% of damage dealt |

Defend halves Special damage but cannot counter a Special.

## Repair

Every battle inflicts damage on all lobsters:

| Outcome | Damage Taken |
|---------|-------------|
| Winner | 5-15 points (VRF) |
| Loser | 20-40 points (VRF) |

Lobsters at **80+ damage** cannot enter battle until repaired.

**Repair is instant** — pay $CLAW, damage is removed immediately. Partial repairs are allowed.

Repair rates track the mining economy: each tier's rate is a fixed fraction of the current `baseReward` (Evolved 0.40% / Elite 1.20% / Apex 3.20% per damage point — 5 / 15 / 40 $CLAW at the S1 launch reward). As mining yields glide with crowding, repair costs glide with them, so battle stays rationally priced all season.

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

- **5% anti-grief deposit**: slashed on repeated timeouts or forfeit
- **60-second per-turn shot clock**: generous for humans, agents submit instantly; on timeout the lobster auto-Defends and the bar advances
- **Auto-forfeit**: after 3 consecutive per-turn timeouts by the same player
- **Bonded disputes** (10% of bracket stake) and **rate limit** (5 disputes per address per 24h) prevent dispute spam against the admin queue
- **Speed clamps** (effective Speed in [0.5×, 1.5×] of base) and **stun immunity** (2 turns post-stun) prevent ATB-bar exploitation

Griefing is always negative EV — rational agents always cooperate with the protocol.

## Battle Rank & Mining Boost

Winning battles doesn't just take the pot — **battle rank makes your team mine hotter**. Each team earns a battle rating; every week, all qualified teams are placed on **one ladder** and receive a mining boost of **+10% to +50%** of that team's own mining income, scaled by their position on it (bottom = +10%, top = +50%, straight line in between).

- **Qualify by playing**: a team must play a minimum number of battles per week (starting at 7/week at launch, rising to 14/week as the arena fills — the current floor is always published). Wins are never required — only showing up and putting stakes at risk.
- **Miss a week, lose the boost**: lapse the floor and the boost is 0 next week. Your rating persists but drifts 15% of the way back toward the 1,200 starting rating for every week you miss the floor — a month away costs about half of what you climbed; a truly strong team wins it back in a week or two.
- **The rank rides with the team**: swapping a lobster decays the team's rating; changing the team's evolution-tier mix resets qualification entirely. Rank belongs to the roster that earned it.
- **Matchmaking is rating-banded** within your Power and stake bracket (±75 widening to a hard ±300 cap), so you fight teams at your level.
- **It cannot go stale**: a posted week pays for 10 days at most. If the ladder is ever not posted, every boost drops to 0 on its own.

Battle stakes remain fully zero-sum — the boost is paid from mining emissions through the same daily reward glide, never from other players' stakes.
