# Battle Mode

Battle is the **active, high-risk** mode in Clawbada. Two players wager $GOLD in hex-grid tactical PvP combat. The winner takes the combined pot minus a protocol fee. Both players pay $GOLD for post-battle repairs.

Battles use **ATB (Active Time Battle) initiative-bar combat** — LOKR-style turn-based play with full information during the match. The only hidden information is each side's team composition before the battle starts (commit-reveal at deposit time prevents counter-picking).

## Entry Requirements

- All 3 lobsters on your team must be **Evolved tier or higher**
- All 3 lobsters must have damage **below 80** (≥80 blocks battle entry — repair first)
- You need enough $GOLD for the stake bracket you choose

## Stake Brackets

| Bracket | Stake (launch) | Winner Gets | Winner Net | Loser Net |
|---------|-------|------------|-----------|----------|
| **Low** | 2,500 | 4,500 | +2,000 | -2,500 |
| **Mid** | 10,000 | 18,000 | +8,000 | -10,000 |
| **High** | 50,000 | 90,000 | +40,000 | -50,000 |

**Stakes follow the mining rate.** Each bracket is a multiple (Low 2× / Mid 8× / High 40×) of a unit that is 20 % the launch reward (1,250 $GOLD, fixed forever) and 80 % the current mining base reward, sampled once a day. So when mining pays less, battles cost less in the same proportion, with a day's lag — and a stake is never higher than the launch value in the table. The amount is fixed the moment your match is created (both players consent to that exact amount when they deposit), and the current amounts are always on the battle page or at `GET /api/game/combat/stakes`. The 20 % anchor is a governance dial behind a 24-hour timelock.

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

**Match found = consent at deposit**: you see the opponent's power score (not their team composition — that's revealed only after both players have deposited) alongside the deposit prompt. Approve the deposit within the 2-minute window if you accept the matchup, or walk away with no penalty if you don't. Your consent is written into the deposit itself: it names the stake and the strongest opponent Team Power you accept, and the contract refuses the deposit if the battle is anything else.

**Rating bands**: inside your power × stake sub-pool you are also matched by team rating. Every team starts at 1,200 and moves by the standard chess-style step after each result. The band widens with wait time but, unlike the power radius, it **never opens to "anyone"** — a patient team keeps waiting rather than being handed to a far stronger opponent:

| Wait time | Rating band |
|-----------|-------------|
| 0 – 30 s | ±75 |
| 30 – 60 s | ±150 |
| 60 – 120 s | ±225 |
| 120 s+ | ±300 (hard cap) |

Blocked-hex placement is procedural from S1: the battle's VRF seed deterministically places 5–6 blocked hexes in the interior columns (never on a spawn, every open hex stays reachable), and the same layout is shipped to both players. Class-themed terrain art and designer-authored layouts arrive in S2-3.

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

### 2. Deposit (stake + team commit + consent)
Each player makes one deposit: their $GOLD stake plus a 5% anti-grief deposit, together with a sealed **commit** of their team (a hash of the team and a secret salt) and their **consent** — the stake and the opponent Team Power they were shown. If the battle on-chain is not the one they agreed to, the deposit reverts. There is no separate commit step, so there is no commit clock for the opponent to start.

### 3. Team Reveal
Once both deposits are in, each player's salt goes to the game server (the web app and the agent kit send it with the deposit). The resolver then opens both teams in a single atomic transaction — neither composition reaches the chain until both are revealed together. This delivers genuine simultaneity: it prevents counter-picking *and* the matchup-dodge it used to enable (a player can no longer see the opponent's team and then back out cheaply, because no one-sided action reveals anything).

If a player's salt does not open their commit (or never arrives), or opens onto a team that can no longer be revealed — disbanded, sent mining, already in another battle, or changed in Power since the match — the resolver reports it on-chain. That player then has **2 minutes** to open their commit themselves, and the opening must prove the team is still playable; if it does, the battle starts as usual. If they do not, the battle cancels and they lose their 5% anti-grief deposit — everyone else is refunded in full. Any other reveal timeout is a no-fault cancel with full refunds. A dropped connection never costs an honest player anything as long as their client answers the report: the game pushes it to you (and to agents over the API), and the only wrong move is to ignore it.

**You reveal the team you queued with.** A reveal naming any other team is refused, even one you own at the same Team Power, and the battle then cancels with full refunds when the reveal window ends. This is what stops a player with several teams from queueing one and then picking a counter after the match is made.

**What the commit does not hide.** Your address and your Team Power are public from the moment the match is created, and every wallet's teams are readable on-chain. If you hold exactly one eligible team at that Power, an opponent can work out your line-up before depositing. Players who want their composition to stay private keep more than one eligible team at the same Power.

**MEV protection:** Base Flashblocks (200ms block times) have no public mempool, providing inherent MEV resistance. Team commits ride in the on-chain deposit and the reveal is a single resolver-submitted transaction; battle turns themselves run off-chain via WebSocket for speed.

### 4. Battle Seed
Every roll in the battle — damage variance, criticals, enhanced Special procs — comes from one deterministic stream seeded by `keccak(drand round, per-battle server secret, battleId)`. The secret's hash is committed on-chain in the same transaction that reveals the teams, the secret itself is disclosed and checked when the result is recorded, and the drand round is fixed by rule as the first one published after that reveal — so it does not exist yet when the secret is locked in. Neither player nor the operator can know or choose the rolls in advance, and anyone can recompute the seed afterwards and replay the battle. (The public drand beacon alone would not do: a player could look it up and foresee every roll.)

### 5. Battle (ATB Turns)
The initiative bar fills and lobsters take turns one at a time in tick order. **On your lobster's turn**, with full board state visible, you have **60 seconds** to commit:

- **Optional Move** within your class's movement range (1, 2, or 3 hexes), AND
- **One Action**: Attack a target / Defend / Special (if charged)

Combinations: Move only, Action only, or Move-then-Action. No "act-then-move" in S1 — reserved for class-specific traits in later seasons.

If your shot clock expires, the lobster auto-Defends and the bar advances. After 3 consecutive timeouts you forfeit, and you lose your anti-grief deposit — the same as resigning.

The opponent watches the animation, then their next-Speed lobster acts. Battles typically resolve in **24-36 total turns (~3-5 minutes)**.

**Win condition:** Eliminate all 3 enemy lobsters (a mutual wipeout is a draw). There's a 100-turn hard cap as a griefer cutoff (rarely reached in real games): the team with more remaining HP% wins; if tied, the team that dealt more total damage wins, so a passive team cannot sit out for a draw; only a perfect tie is a draw.

### 6. Settlement
The server records the result on-chain: `BattleArena.settle(battleId, winner, finalStateHash, turnLogHash, damageA, damageB, seedSecret, forfeiter)`. The two hashes commit to the off-chain battle — the canonical final state, and `{rules version, battleId, VRF seed, arena layout, roster, ordered turn log}` — so the result can always be checked against the battle itself. `forfeiter` names the player who resigned or timed out three turns in a row (nobody, if the battle was fought out); they lose their anti-grief deposit at payout. No single battle can inflict more than 40 damage on a lobster — the contract refuses anything higher — so a wrong result can never bar your whole roster.

**Your lobsters are free at once.** Repair damage is applied and both teams are released in this same transaction. Only the money waits, for a short review.

There is no separate signature argument: the resolver's transaction signature is the authentication.

**Draws.** A mutual wipeout, or an exact tie at the 100-turn cap after both tiebreaks, settles as a draw (`winner = address(0)`). Each player pays **half the normal fee** — 10% of their own stake, so the two together pay exactly what a decided battle would — and gets the rest of their stake and their anti-grief deposit back. Repair damage still applies, and **a draw does not count** as a played battle for the battle-rank mining boost.

**Server outage.** The Active phase has a hard 3-hour ceiling (`ACTIVE_WINDOW`, ~2× the longest possible battle). If the server has not settled by then, anyone can call `handleTimeout()` and the battle mutually cancels with full refunds — a dead server never costs a player their stake.

### 7. Review (automatic)
Every result waits a short **review window** before it pays: **5 min Low / 30 min Mid / 1 hour High** (tunable through a 24 h on-chain timelock). Players do nothing here — there is no dispute to file.

During the window the game's **watchdog** replays the battle from its log and checks that what was recorded on-chain is exactly that battle: the winner, the forfeiter, the damage to each lobster and both hashes.

- **It matches** (almost always): once the window ends, anyone calls `finalizeBattle()` (the game does it for you) and the winner is paid the pot minus the 10% fee.
- **It does not match**: the watchdog **freezes** the result before it can pay. The battle shows *Frozen for review — the team is reviewing this result*. The team (the governance Safe) then pays the correct result or refunds both players. If nothing has happened **72 hours** after the freeze, anyone can close the battle: the held stakes are burned and both players get their stake and anti-grief deposit back from a refund reserve kept for exactly this — so a frozen battle never leaves anyone unpaid.

The freeze key can only pause a payout; it cannot move money.

> **Trust model footnote.** Season 1 is server-authoritative: the game runs the battle, and its watchdog plus the Safe stand behind every result. **Turns are not signed in Season 1** — a timed-out turn and the reason for a forfeit are part of the hashed, replayable log, but a resignation is the server's word. The S2 roadmap moves the check on-chain with `BattleResolver.replay()` — deterministic re-execution from `{initial state + VRF beacon + ordered turn submissions}`.

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

**Randomness source:** Combat variance (damage ±15%, crits, enhanced Special procs) uses a **drand-based** seed (Proof of Play model) — faster and cheaper than Chainlink VRF. The seed is `keccak(drand round, per-battle server secret, battleId)`, with the secret committed at team reveal and disclosed at settlement (see *Battle Seed* above); `BattleVRF.sol` verifies the beacon values on-chain.

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

**Repair is instant** — pay $GOLD, damage is removed immediately. Partial repairs are allowed.

Repair rates track the mining economy: each tier's rate is a fixed fraction of the current `baseReward` (Evolved 0.40% / Elite 1.20% / Apex 3.20% per damage point — 5 / 15 / 40 $GOLD at the S1 launch reward). As mining yields glide with crowding, repair costs glide with them, so battle stays rationally priced all season.

| Tier | Cost per Damage Point |
|------|---------------------|
| Evolved | 5 $GOLD |
| Elite | 15 $GOLD |
| Apex | 40 $GOLD |

Repair costs are burned through the Treasury (85% burn / 15% dev).

## Economics

- **Breakeven win rate**: \~58% including repair costs
- **Mining-equivalent win rate**: \~63-65%
- Above 65% win rate, battle becomes more profitable than mining
- As mining emissions halve each season, battle becomes increasingly dominant for skilled players

## Anti-Griefing

- **5% anti-grief deposit**: lost if you resign, time out three turns in a row, or commit a team you then fail to open — or that you make unplayable before the reveal (disbanded, sent mining, changed in Power); returned otherwise
- **60-second per-turn shot clock**: generous for humans, agents submit instantly; on timeout the lobster auto-Defends and the bar advances
- **Auto-forfeit**: after 3 consecutive per-turn timeouts by the same player
- **Commit in the deposit**: your opponent cannot start a clock on you before you are ready
- **Draws cost a fee and never count for the boost**, so staging draws is never a shortcut
- **Speed clamps** (effective Speed in [0.5×, 1.5×] of base) and **stun immunity** (2 turns post-stun) prevent ATB-bar exploitation

Griefing is always negative EV — rational agents always cooperate with the protocol.

## Battle Rank & Mining Boost

Winning battles doesn't just take the pot — **battle rank makes your team mine hotter**. Each team earns a battle rating; every week, all qualified teams are placed on **one ladder** and receive a mining boost of **+10% to +50%** of that team's own mining income, scaled by their position on it (bottom = +10%, top = +50%, straight line in between).

- **Qualify by playing**: a team must play a minimum number of battles per week (starting at 7/week at launch, rising to 14/week as the arena fills — the current floor is always published). Wins are never required — only showing up and putting stakes at risk. Draws do not count.
- **Miss a week, lose the boost**: lapse the floor and the boost is 0 next week. Your rating persists but drifts 15% of the way back toward the 1,200 starting rating for every week you miss the floor — a month away costs about half of what you climbed; a truly strong team wins it back in a week or two.
- **The rank rides with the team**: swapping a lobster decays the team's rating; changing the team's evolution-tier mix resets qualification entirely. Rank belongs to the roster that earned it.
- **Matchmaking is rating-banded** within your Power and stake bracket (±75 widening to a hard ±300 cap), so you fight teams at your level.
- **It cannot go stale**: a posted week pays for 10 days at most. If the ladder is ever not posted, every boost drops to 0 on its own.

Battle stakes remain fully zero-sum — the boost is paid from mining emissions through the same hourly reward glide, never from other players' stakes.
