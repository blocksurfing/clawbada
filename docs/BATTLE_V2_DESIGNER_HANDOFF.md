# Clawbada Battle System V2 — Designer Handoff

> ## STATUS: SUPERSEDED BY V3 (2026-05)
>
> This document describes the **V2 battle system** (two-phase commit-reveal per round, 7-round cap, simultaneous resolution). The battle system has since been redesigned to **V3**: LOKR-style ATB initiative-bar combat with full information during play, server-authoritative trust model with on-chain dispute resolution.
>
> **For current spec, see**:
> - Project memory: `~/.claude/projects/-Users-alepore-Clawbada/memory/project_battle_v2_redesign.md`
> - Project context: `.claude/CLAUDE.md` → Battle Mode section
> - Design rationale: `docs/GAME_DESIGN_RATIONALE.md` → Section 5 (Why ATB / Trust Model / V3 Anti-Griefing) and Section 13 (Two-Phase Commit-Reveal Rounds — Replaced in V3 Redesign)
>
> **What changed V2 → V3**:
> - Two-phase commit-reveal rounds → ATB initiative bar (LOKR-style time-tick turn order, full info during battle)
> - Hidden in-round moves → full information during battle (only team comp is commit-reveal)
> - 7-round cap → team wipeout (or 100-turn hard cap with HP% tiebreak)
> - 60s commit windows × 2 phases → 60s per-turn shot clock
> - Speed = turn order tiebreaker → Speed = ATB tempo (frequency on the bar), clamped to [0.5×, 1.5×] of base
> - Trust model: pure server-authoritative → hybrid with on-chain dispute window + bonded disputes (10% bracket stake) + 5/24h rate limit
>
> **What's still accurate in this doc**: hex grid (6×5 pointy-top offset, ~20% blocked, tier-specific arenas), 4 action types (Attack/Defend/Move/Special), movement ranges by class (1/2/3 hexes), distance-scaled damage (100/75/50/miss), 10-class tournament graph, repair system, stake brackets, protocol fee. **The visual / asset / animation guidance for designers remains valid.**
>
> **What's no longer accurate**: Phase 1 / Phase 2 round structure, "round 4+" Special timing, 7-round cap, simultaneous resolution descriptions, in-round commit/reveal timing.
>
> **Use this doc for** art/animation references and asset specs. **Use the V3 docs above for** mechanics, timing, server, and contract design.

---

## What Changed and Why

The battle system has been significantly redesigned. The original design was a static commit-reveal system where lobsters stood in fixed positions and took turns attacking, defending, or using specials. While functional, it lacked the strategic depth our game needs — especially for AI agents who could trivially optimize a 3-option system.

**The core change: battles now take place on a hex grid with movement as a 4th action type.** This transforms combat from a damage-trading card game into a tactical positioning battle.

---

## The Hex Grid Arena

**Grid: 6 columns x 5 rows, pointy-top offset hexes.**

- 30 total hexes per board
- ~20% blocked/impassable (~6 hexes), leaving ~24 playable spaces
- Teams spawn on opposite sides (left vs right)
- Blocked hexes create chokepoints and force strategic pathing

**Why this size:** We tested 12x8 (96 hexes) and it was far too large — characters became tiny, slow classes were irrelevant for half the match, and it felt like a top-down tactics game rather than a 3v3 RPG brawl. At 6x5, every hex matters. Tanks are always in the fight. Assassins can reposition but can't endlessly kite. The characters stay large and visible.

**Arena variety:** Each evolution tier (Evolved, Elite, Apex) gets unique arena layouts with different blocked hex configurations. The blocked hexes aren't random — they're hand-designed per board to create distinct strategic profiles. Some boards have a central chokepoint, others have flanking corridors, others have isolated pockets. This opens the door for Season 2-3 procedural board generation with obstacle asset pools (coral reefs, rock formations, lava flows, sunken ships, treasure chests, etc.).

### Reference: Hex grid style direction

The hexes should be semi-transparent, beveled, and integrated into the scene art — not sitting on top of it. Characters stand ON the hexes, not next to them. The grid is part of the underwater world.

![Hex grid reference — grid integrated into scene with characters on hexes](battle-v2-images/ref-hex-grid-1.jpeg)

![Hex grid reference — blocked hexes as terrain features, subtle grid overlay](battle-v2-images/ref-hex-grid-2.jpeg)

### Reference: Our board mockup tool (6x5 grid)

![Clawbada 6x5 hex board mockup with blocked hexes and team spawn positions](battle-v2-images/ref-clawbada-board.png)

---

## The 4 Action Types

Previously there were 3 actions (Attack, Defend, Special). Now there are 4:

| Action | What It Does | Grants Charge? |
|--------|-------------|----------------|
| **Attack** | Deal damage to a target within 3 hex range. Damage scales with distance. | Yes (+1) |
| **Defend** | Halve incoming damage, small counter-damage to attackers. | Yes (+1) |
| **Move** | Reposition to an open hex within your movement range. | Yes (+1) |
| **Special** | Class-specific ability. Requires 3 charge. Consumes all charge. | No (consumes) |

**Why Move was added:** Without movement, all classes are effectively at the same "range." A tank and an assassin have the same reach. Adding spatial positioning means class roles finally have physical meaning — tanks hold chokepoints, assassins flank, glass cannons stay at distance.

---

## Movement Ranges by Class

Each class has a fixed movement range based on their role:

| Range | Classes | Role |
|-------|---------|------|
| **1 hex** | Bulwark, Leviathan | Slow but durable/powerful. Hold the frontline. |
| **2 hexes** | Sentinel, Abyss, Kraken, Reaver | Flexible. Can reposition and engage. |
| **3 hexes** | Mantis, Tempest, Specter, Ember | Fast and agile. Dart in, strike, retreat. Fragile. |

**Design implication for art:** Fast classes (3-hex) should feel light and agile in their movement animations. Slow classes (1-hex) should feel heavy and deliberate. The movement animation itself communicates the class identity.

---

## Attack Range and Distance Scaling

Attacks now have range. You don't need to be adjacent to hit — but being far away reduces your damage significantly.

| Distance | Damage | Description |
|----------|--------|-------------|
| **Adjacent (1 hex)** | 100% | Full melee damage |
| **2 hexes apart** | 75% | Ranged, reduced |
| **3 hexes apart** | 50% | Maximum range, half damage |
| **4+ hexes** | Miss | Out of range entirely |

**Why this matters for design:** When a lobster attacks from distance, the visual should communicate the reduced power — a thrown projectile vs a direct claw strike, a fading energy bolt vs a full-contact hit. The VFX intensity should scale with the damage modifier.

---

## Two-Phase Rounds

This is the biggest structural change. Each round now has **two phases** instead of one:

### Phase 1: Positioning (Blind)

Both players simultaneously choose where each of their 3 lobsters will move. Neither side can see what the other is doing. Both lock in, movements are revealed, and all lobsters animate to their new positions.

**This is the "Battleship" moment** — you're predicting where your opponent will go. Will they advance or retreat? Will they flank left or push center?

### Phase 2: Combat (Fully Informed)

After positions are revealed and updated, both players can see exactly where everyone is. Now they choose Attack, Defend, or Special for each lobster with full board knowledge. Both lock in, actions are revealed and resolved.

**This is the tactical moment** — no guessing. You see the distances, you know the ranges, you make informed combat decisions.

### Why Two Phases?

A single-phase system (commit everything blind) felt too much like gambling — you'd commit an attack on a hex and the enemy might not be there. Frustrating for humans, less skill-based than we wanted. The two-phase approach separates the prediction game (movement) from the tactical game (combat). Movement requires reading your opponent. Combat requires tactical skill. Both matter.

---

## Round Timing

- **60 seconds** per phase to lock in moves
- Round proceeds immediately when both players have committed (no waiting for the timer)
- If a player doesn't commit within 60 seconds, their lobsters auto-defend
- Agent-vs-agent matches run at agent speed (~2 seconds per round regardless of timer)

---

## Player Identity Badges

Players are now tagged as **Human** or **Agent** in the battle HUD. This is shown during matchmaking, in-battle, on leaderboards, and on marketplace listings.

**Why:** Knowing you're fighting an AI agent vs another human changes the experience. Beating an agent feels like an achievement. Playing another human feels like a fair duel. It also creates branding for agents in the ecosystem.

---

## Game Engine: Unity WebGL

The battle renderer is moving from hand-coded HTML5 canvas to **Unity**, exported as a WebGL build embedded in the battle page.

**Why Unity over Phaser/other web engines:**
- Designer knows and prefers Unity — higher productivity and quality output
- Reference game (Legends of Kingdom Rush) uses Unity — same engine, same patterns to study
- Industry-leading particle system, Shader Graph, animation tools (Animator, Timeline)
- Built-in hex tilemap support plus extensive Asset Store for grid frameworks
- Superior VFX quality ceiling for 10 class-specific Special effects with enhanced variants
- Future path to native mobile export from the same project

**Architecture:**
- Unity WebGL build loads ONLY on the battle page (`/game/battle`)
- Rest of the app stays pure React/Next.js
- Communication between React and Unity via `react-unity-webgl` package or postMessage bridge
- Data flow: Server (WebSocket) → React (game state) → Unity (render battle)
- User input: Unity (hex clicks, action selection) → React (commit to server)
- Unity project lives in `packages/battle-engine/`, CI builds output to `apps/web/public/unity-build/`

**For the designer:** Full access to Unity's visual editors — Scene view for arena layout, Animator for character movement/attack animations, Particle System for Special VFX, Shader Graph for custom effects (Bloom, Glow, underwater caustics). Battle scene backgrounds, hex overlays, terrain obstacles, character sprites, and all VFX are authored natively in Unity.

---

## What Stays the Same

These elements of the battle system are **unchanged**:

- 10 lobster classes with balanced tournament graph
- Class advantage system (1.25x / 1.0x / 0.80x damage)
- 5 stats: HP, Attack, Armor, Speed, Critical
- Special moves with purity-based potency scaling
- Enhanced Special proc chances tied to purity
- 7 round maximum with HP% tiebreaker
- Commit-reveal protocol with drand VRF randomness
- 3 stake brackets (2,500 / 10,000 / 50,000 $CLAW)
- 10% protocol fee (85% burn / 15% dev)
- Repair system (battle damage, $CLAW burn to fix)
- Anti-grief deposits (5% slashed on timeout/forfeit)

---

## Summary of Design Tasks for the Battle Scenes

1. **Hex grid arena backgrounds** — 6x5 pointy-top hex grid overlaid on underwater scene art. Semi-transparent hexes, beveled edges, integrated into the environment. One layout per tier (Evolved, Elite, Apex) with unique blocked hex positions.

2. **Blocked hex terrain assets** — Visual obstacles that occupy blocked hexes. Coral formations, rock clusters, sunken crates for Evolved. Crystal formations, deep-sea vents for Elite. Lava flows, volcanic rock, fire pits for Apex.

3. **Movement animations** — Per-class movement animations along hex paths. Fast classes (3-hex) = quick/agile. Slow classes (1-hex) = heavy/deliberate.

4. **Range indicators** — Visual overlay showing attack range from a selected lobster. Highlight valid target hexes with distance-based color coding (green = full damage, yellow = 75%, red = 50%).

5. **Battle HUD redesign** — Player identity badges (Human/Agent), phase indicators (Positioning vs Combat), 60-second timer, charge counters, action selection UI. This is a separate design discussion to follow.
