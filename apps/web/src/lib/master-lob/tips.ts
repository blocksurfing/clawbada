/**
 * Master Lob's tips (owner 2026-10-31: teach the game "in depth" from beginner basics to advanced tactics).
 *
 * Every fact follows the battle engine (packages/game-logic/src/v3) — not the older design notes. Drafted from the code
 * (each tip's source file:line is in the review log), then checked against it by Codex (gpt-6-astra, review round 5:
 * 51 of 96 correct as written, 45 corrected, near-duplicates merged, one trigger dropped because the snapshot has no
 * intended target). Situational tips carry `when`; the rest form the Beginner → Intermediate → Advanced curriculum,
 * shown in this order. Class tips appear only with one of their classes on the player's team.
 */
import { getClassAdvantage, v3 } from '@clawbada/game-logic';
import { classOf as cls, type CoachContext, type CoachTip } from './coach';

/** getClassAdvantage's "beats it" multiplier (×1000, a bigint): 1250n. */
const ADVANTAGE = 1250n;
const dist = (a: v3.AtbLobster, b: v3.AtbLobster) => v3.hexDistance(a.pos, b.pos);
const has = (l: v3.AtbLobster, type: v3.StatusType) => l.statuses.some((s) => s.type === type);
/** How far the actor's Special can land this turn: its move plus the Special's range. */
const specialReach = (c: CoachContext) => (v3.MOVE_RANGE[c.actor.class] ?? 0) + (v3.SPECIAL_RANGE[c.actor.class] ?? 0);
/** The nearest living enemy to the acting lobster. */
const nearest = (c: CoachContext): v3.AtbLobster | null =>
  c.enemies.reduce<v3.AtbLobster | null>((best, e) => (best === null || dist(c.actor, e) < dist(c.actor, best) ? e : best), null);
/** True when `enemy` is projected to act before the actor's NEXT turn (the actor's second slot on the bar: it acts now). */
const actsBefore = (c: CoachContext, enemy: v3.AtbLobster): boolean => {
  const bar = v3.projectBar(c.state, 12);
  const mineAt = bar.map((b, i) => (b.lobsterId === c.actor.id ? i : -1)).filter((i) => i >= 0);
  const next = mineAt.length > 1 ? mineAt[1] : bar.length;
  const theirs = bar.findIndex((b) => b.lobsterId === enemy.id);
  return theirs >= 0 && theirs < next;
};

export const TIPS: readonly CoachTip[] = [
  { id: "b-turn-shape", tier: 'beginner', text: "Each turn, your lobster may move first, then take one action: Attack, Special, Defend or Wait. You cannot act first and move after." },
  { id: "b-moves-final", tier: 'beginner', text: "Tap a hex to pick it, tap it again to move there. Moves are final, so decide where you want to end up before you commit." },
  { id: "b-turn-order", tier: 'beginner', text: "The card numbers rank each lobster's next turn, with 1 acting now. Fast lobsters can act again before everyone gets a turn." },
  { id: "b-speed", tier: 'beginner', text: "Speed decides how often a lobster acts, not just who goes first. A lobster with twice the Speed takes twice as many turns." },
  { id: "b-first-turn", tier: 'beginner', text: "The fastest lobster acts first. Ties are settled by a random roll fixed at the start of the battle." },
  { id: "b-attack-range", tier: 'beginner', text: "Attack reaches 3 hexes, or 4 for Specter. Distance gives 100%, 75%, 50%, then 40% damage. Other penalties can reduce it further." },
  { id: "b-defend", tier: 'beginner', text: "Defend earns 2 charge and halves most incoming damage until your next turn. Bleed, recoil, reflection and enhanced Bind bypass that cut." },
  { id: "b-defend-counter", tier: 'beginner', text: "A Defending lobster that survives strikes back at anyone who Attacks it from an adjacent hex. Ranged Attacks and Specials get no counter." },
  { id: "b-charge", tier: 'beginner', text: "Attack or Wait earns 1 charge; Defend earns 2, capped at 3. Special spends all 3. Stun skips earn none." },
  { id: "b-special-unlock", tier: 'beginner', text: "Your Special unlocks on your 4th turn at the earliest, or your 3rd if you Defend once along the way." },
  { id: "b-class-wheel", tier: 'beginner', text: "Each class beats 4, loses to 4, and ties itself plus its opposite. Advantage gives 25% more damage; disadvantage gives 20% less." },
  { id: "b-shot-clock", tier: 'beginner', text: "Watch the clock, young claw. At zero you auto-Defend. Normally turns get 60 seconds, with 15 extra on your side's first turn." },
  { id: "b-forfeit", tier: 'beginner', text: "Three timeouts in a row and you forfeit the battle. Any turn you play yourself resets the count." },
  { id: "b-win", tier: 'beginner', text: "Knock out all three enemy lobsters to win. A knocked-out lobster leaves the turn order for good." },
  { id: "b-turn-cap", tier: 'beginner', text: "At 100 total turns, team HP percentage decides. If tied, damage dealt decides; if both tie, the battle is a draw." },
  { id: "b-blocked-hexes", tier: 'beginner', text: "Blocked hexes cannot be crossed or stood on. Path around them; they shape the lanes of every arena." },
  { id: "b-one-per-hex", tier: 'beginner', text: "One lobster per hex. You can walk through hexes other lobsters stand on, but you cannot stop on one." },
  { id: "b-move-ranges", tier: 'beginner', text: "Bulwark and Leviathan move 1 hex. Sentinel, Abyss, Kraken and Reaver move 2. Mantis, Tempest, Specter and Ember move 3." },
  { id: "b-crit", tier: 'beginner', text: "Some Attacks crit for 1.5x damage. More Critical means more crits: a lobster with 100 Critical crits about one hit in three." },
  { id: "b-attack-vs-armor", tier: 'beginner', text: "Damage depends on your Attack against the target's Armor. Tough shells like Bulwark and Sentinel shrug off weak hitters.", classes: ["bulwark", "sentinel"] },
  { id: "i-fortify", tier: 'intermediate', text: "Fortify guards your whole team for 2 turns each, cutting ordinary hits by 40%. Bleed, recoil and reflection slip through.", classes: ["bulwark"] },
  { id: "i-fortify-taunt", tier: 'intermediate', text: "Fortify makes its caster taunt adjacent foes. Their Attacks and enemy-targeted Specials must pick an adjacent taunter.", classes: ["bulwark"] },
  { id: "i-ambush", tier: 'intermediate', text: "Mantis's Ambush strikes an adjacent enemy at 150 power and ignores half its Armor. Save it for thick shells like Bulwark or Sentinel.", classes: ["mantis"] },
  { id: "i-crush", tier: 'intermediate', text: "Leviathan's Crush is a 180-power adjacent smash. Its enhanced version hits 1.5x harder on targets below half HP, so aim it at the wounded.", classes: ["leviathan"] },
  { id: "i-maelstrom", tier: 'intermediate', text: "Tempest's Maelstrom hits every enemy within 3 hexes of the Tempest at 120 power each. Move first to catch two or three of them.", classes: ["tempest"] },
  { id: "i-haunt", tier: 'intermediate', text: "Haunt reaches 3 hexes and cuts Attack and Armor by 20% for 4 target turns. Enhanced, it cuts 30% for 6. Trouble their biggest hitter.", classes: ["specter"] },
  { id: "i-specter-kit", tier: 'intermediate', text: "Specter Attacks reach 4 hexes at 40% damage. Its first enemy Attack or damaging Special between its own turns is cut by 30%.", classes: ["specter"] },
  { id: "i-rally", tier: 'intermediate', text: "Rally heals self or an ally within 2 hexes for up to 25–40% max HP, based on purity. It cleanses debuffs, except enhanced Rend's bleed.", classes: ["sentinel"] },
  { id: "i-rally-timing", tier: 'intermediate', text: "Rally's healing stops at max HP. Save it for wounds, unless cleansing a debuff or gaining an enhanced shield makes it worthwhile.", classes: ["sentinel"] },
  { id: "i-rend", tier: 'intermediate', text: "Rend bites an adjacent foe, then bleeds it for 55–88 HP on each of its next 6 turns, based on purity. Bleed ignores defenses.", classes: ["reaver"] },
  { id: "i-devour", tier: 'intermediate', text: "Devour has 150 power and heals from damage after mitigation, including overkill. Normal healing caps at max HP; enhanced can exceed it.", classes: ["abyss"] },
  { id: "i-bind", tier: 'intermediate', text: "Bind reaches 2 hexes, deals light damage and stuns a surviving foe unless stun-immune. A stun skip earns no charge.", classes: ["kraken"] },
  { id: "i-inferno", tier: 'intermediate', text: "Inferno reaches 4 hexes at 200 power. Raw recoil is 25% of damage after mitigation, or 15% enhanced; overkill counts too. Check your HP.", classes: ["ember"] },
  { id: "i-special-after-move", tier: 'intermediate', text: "Move first, then Special. Adjacent Specials like Crush, Ambush, Rend and Devour can land the same turn you step in.", classes: ["leviathan", "mantis", "reaver", "abyss"] },
  { id: "i-finish-kills", tier: 'intermediate', text: "A lobster at 1 HP still hits with full power. Finish wounded enemies before they act again; every knockout removes turns from their side." },
  { id: "i-bank-charge", tier: 'intermediate', text: "Defend at 0 or 1 charge to bank fast. At 2 charge, Defend only fills you to the cap of 3 and the bonus point is lost." },
  { id: "i-guard-penalty", tier: 'intermediate', text: "Attacking from 2+ hexes while an enemy stands next to you costs 20% damage. When engaged, hit the adjacent enemy or step away first." },
  { id: "i-zone-of-control", tier: 'intermediate', text: "You don't have to out-run a shooter to hurt it. Standing next to an Ember or Tempest cuts its ranged Attacks by 20%.", classes: ["ember", "tempest", "leviathan", "bulwark"] },
  { id: "i-protect-ranged", tier: 'intermediate', text: "Ember and Mantis have the thinnest shells, 350 and 375 base HP. Keep a sturdy ally between them and the enemy front line.", classes: ["ember", "mantis"] },
  { id: "i-read-charge", tier: 'intermediate', text: "Watch enemy charge: 3 readies a Special, unless stun costs its turn. Mind its move plus cast range before choosing your defense." },
  { id: "i-read-defend-charge", tier: 'intermediate', text: "An enemy at 1 charge that Defends will have 3 next time. Expect its Special on that turn and plan ahead." },
  { id: "i-protect-wounded", tier: 'intermediate', text: "Pull a wounded lobster out of reach and Defend for up to 2 charge. It halves most hits, but cannot stop bleed or enhanced Bind's damage." },
  { id: "i-defend-vs-special", tier: 'intermediate', text: "Defend halves most Special damage and never counters Specials. Enhanced Bind pierces it, so don't trust your guard against Kraken." },
  { id: "i-no-stacking", tier: 'intermediate', text: "Same-type statuses don't stack. Reapplying keeps the longer timer and stronger value, and can make bleed uncleansable." },
  { id: "i-sensei-patience", tier: 'intermediate', text: "Patience, young claw. A well-timed Special can turn a fight. Bank charge with Defend while the enemy spends theirs." },
  { id: "a-tempo", tier: 'advanced', text: "Turns come every 1,000,000 / Speed ticks. A 130-Speed Mantis gets about 1.86 turns for every one a 70-Speed Leviathan takes.", classes: ["mantis", "leviathan"] },
  { id: "a-slow-clamp", tier: 'advanced', text: "Enhanced Maelstrom slows enemies 20% for 2 of their turns. Speed can never fall below half its base, and a second slow only refreshes.", classes: ["tempest"] },
  { id: "a-stun-immunity", tier: 'advanced', text: "After a stun, that lobster is stun-immune for its next 2 turns. Bind still deals damage, but the stun won't stick. Time your Binds.", classes: ["kraken"] },
  { id: "a-stun-cost", tier: 'advanced', text: "A stun costs a whole turn: no move, no action, no charge. Bleed still ticks on the skipped turn and status timers still run down.", classes: ["kraken"] },
  { id: "a-purity", tier: 'advanced', text: "Each purity point adds 10% to Special damage, Rally healing and Rend bleed. Enhanced chance is 5% plus 5% per point, up to 35%." },
  { id: "a-purity-heal-bleed", tier: 'advanced', text: "Purity also boosts heals and bleeds: a purity 6 Sentinel's Rally heals 40% of max HP, and a purity 6 Reaver's Rend bleeds 88 a turn.", classes: ["sentinel", "reaver"] },
  { id: "a-enhanced-1", tier: 'advanced', text: "Enhanced: Ambush crits; Fortify reflects 20% blocked; Rally cuts non-raw damage 30% for 1 target turn; Bind damage pierces Defend.", classes: ["mantis", "bulwark", "sentinel", "kraken"] },
  { id: "a-enhanced-2", tier: 'advanced', text: "More procs: Haunt becomes 30% for 6 turns, Rend's bleed can't be cleansed, Devour keeps overheal, Inferno recoil drops to 15%.", classes: ["specter", "reaver", "abyss", "ember"] },
  { id: "a-formula", tier: 'advanced', text: "Before guard and defenses: Attack ≈ 100 × min(Attack/Armor, 2.2) × class × crit × distance × an 85–115% roll. The math rounds down." },
  { id: "a-ratio-cap", tier: 'advanced', text: "The Attack/Armor ratio caps at 2.2. Cutting a low-Armor target's Armor past that is wasted; Haunt or Ambush the thick shells instead.", classes: ["specter", "mantis"] },
  { id: "a-crit-formula", tier: 'advanced', text: "Crit chance = Critical / (Critical + 200), so a base-130 Ember crits about 39%. Only Attacks crit; Specials don't, except enhanced Ambush.", classes: ["ember"] },
  { id: "a-class-wheel", tier: 'advanced', text: "The wheel: Bulwark, Mantis, Leviathan, Tempest, Specter, Sentinel, Reaver, Abyss, Kraken, Ember. Each beats the next 4, ties the 5th." },
  { id: "a-team-coverage", tier: 'advanced', text: "Build teams whose weaknesses don't overlap. If two of your three lose to the same class, an enemy of that class feasts." },
  { id: "a-ember-guard", tier: 'advanced', text: "Ember beats Bulwark, Mantis, Leviathan and Tempest but loses to Sentinel, Reaver, Abyss and Kraken. Guard it from those four.", classes: ["ember"] },
  { id: "a-bait-counter", tier: 'advanced', text: "A Defending foe halves your Attack and counters adjacent hits if it survives. Strike from range, finish it, or choose another target." },
  { id: "a-set-counter", tier: 'advanced', text: "Defend beside a brawler. If you survive its adjacent Attack, you return a 30-power counter. A knockout springs no trap." },
  { id: "a-focus-falloff", tier: 'advanced', text: "Enemy Attacks and damaging Specials build focus falloff: 10 percentage points per prior hit, down to 40%. Your own turn resets it." },
  { id: "a-tempo-trade", tier: 'advanced', text: "Trade HP for tempo: a knockout before the target acts removes all its future turns. That often beats healing or Defending." },
  { id: "a-tiebreak", tier: 'advanced', text: "At turn 100, team HP percent decides. Overheal doesn't count, a fallen lobster counts as zero, and damage dealt breaks a tie." },
  { id: "a-vs-fortify", tier: 'advanced', text: "Enemy Fortify lasts 2 of each enemy lobster's turns. Bleed ignores it, so Rend still bites; otherwise bank charge and strike after.", classes: ["bulwark", "reaver"] },
  { id: "a-vs-taunt", tier: 'advanced', text: "Only a Bulwark that cast Fortify gains its taunt. Move out of adjacency to choose other targets; Maelstrom ignores taunt.", classes: ["bulwark", "tempest"] },
  { id: "a-vs-rally", tier: 'advanced', text: "An enemy Sentinel undoes your bleed, Haunt, stun and slow. Knock it out or keep it out of range; only an enhanced Rend's bleed survives.", classes: ["sentinel", "reaver", "specter", "kraken"] },
  { id: "a-kite-contact", tier: 'advanced', text: "Crush, Ambush, Rend and Devour need contact. Stay more than move range + 1 hexes from a charged brawler: 3 from Leviathan, 5 from Mantis.", classes: ["leviathan", "mantis", "reaver", "abyss"] },
  { id: "a-kite-fast", tier: 'advanced', text: "Fast 3-hex movers can hit and step back out next turn. Adjacent hits deal double what 3-hex hits do, so pick your distance each turn.", classes: ["mantis", "tempest", "specter", "ember"] },
  { id: "a-inferno-draw", tier: 'advanced', text: "Inferno recoil can knock out your own Ember. If that leaves both teams empty at once, the battle ends in a draw.", classes: ["ember"] },
  { id: "a-haunt-team", tier: 'advanced', text: "Haunt cuts Attack and Armor. It can boost your team's hits and weaken enemy strikes, but not heals, bleeds or utility effects.", classes: ["specter"] },
  { id: "a-sensei-wheel", tier: 'advanced', text: "Read the turn order, young claw. Card numbers show each lobster once; a fast foe may squeeze in another turn before yours." },
  { id: "s-full-charge", tier: 'beginner', text: "Your Special is ready. Charge caps at 3, so Defend adds none—but still guards you and counters adjacent Attacks if you survive.", when: (c) => c.actor.charge >= 3 },
  { id: "s-low-hp", tier: 'beginner', text: "This lobster is badly hurt. Step out of reach and Defend, or let your Sentinel Rally it if one is within 2 hexes.", when: (c) => c.actor.hp * 100n < c.actor.maxHp * 30n },
  { id: "s-enemy-stunned", tier: 'beginner', text: "That foe will skip its next turn unless Rally clears the stun. Beware: a stunned foe can still counter while Defending.", when: (c) => c.enemies.some((e) => has(e, 'stun')) },
  { id: "s-enemy-defending", tier: 'beginner', text: "That foe is Defending: most hits are halved, and surviving adjacent Attacks earn a counter. Use range or a finishing blow.", when: (c) => c.enemies.some((e) => e.defending && dist(c.actor, e) <= v3.attackRangeOf(c.state, c.actor.class)) },
  { id: "s-enemy-charged", tier: 'intermediate', text: "That enemy is charged and projected before your next turn. Unless stopped, it can Special. Mind its movement and cast range.", when: (c) => c.enemies.some((e) => e.charge >= 3 && !has(e, 'stun') && actsBefore(c, e)) },
  { id: "s-class-advantage", tier: 'beginner', text: "Your class beats that enemy's: a 25% bonus to direct damage and counters. Bleed does not get that bonus. Fine prey.", when: (c) => nearest(c) !== null && getClassAdvantage(c.actor.class, nearest(c)!.class) === ADVANTAGE },
  { id: "s-class-disadvantage", tier: 'beginner', text: "Careful: that enemy's class beats yours, so you deal 20% less and it hits you 25% harder. Look for a better target.", when: (c) => nearest(c) !== null && getClassAdvantage(nearest(c)!.class, c.actor.class) === ADVANTAGE },
  { id: "s-guard-penalty", tier: 'intermediate', text: "An enemy is right next to you, so your ranged Attacks lose 20%. Hit the adjacent one, step away first, or use your Special.", when: (c) => c.enemies.some((e) => dist(c.actor, e) === 1) && c.enemies.some((e) => { const d = dist(c.actor, e); return d >= 2 && d <= v3.attackRangeOf(c.state, c.actor.class); }) },
  { id: "s-taunted", tier: 'intermediate', text: "You're beside a taunter. Attacks and enemy-targeted Specials must pick an adjacent taunter. Move away to regain your choice.", classes: ["bulwark"], when: (c) => v3.tauntersAdjacent(c.state, c.actor, c.actor.pos).length > 0 },
  { id: "s-enemy-fortify", tier: 'intermediate', text: "That enemy still has Fortify, cutting ordinary hits by 40%. Its teammates may have lost theirs already. Check each shell.", classes: ["bulwark"], when: (c) => c.enemies.some((e) => has(e, 'fortify')) },
  { id: "s-ally-bleeding", tier: 'intermediate', text: "Your lobster is bleeding and loses HP at the start of each of its turns, Defend or not. A Sentinel's Rally can wash it off.", classes: ["sentinel"], when: (c) => c.mine.some((m) => m.statuses.some((s) => s.type === 'bleed' && !s.uncleansable)) },
  { id: "s-ally-haunted", tier: 'intermediate', text: "Haunt has cut this lobster's Attack and Armor. Pick safe trades or Defend until it fades, or have a Sentinel Rally it.", when: (c) => has(c.actor, 'haunt') },
  { id: "s-ember-recoil", tier: 'advanced', text: "Inferno's raw recoil is 25% of damage after mitigation, or 15% enhanced. With so little HP, your Ember could fall. Choose the trade well.", classes: ["ember"], when: (c) => cls(c.actor) === 'ember' && c.actor.charge >= 3 && c.actor.hp * 100n < c.actor.maxHp * 15n },
  { id: "s-turn-cap-near", tier: 'advanced', text: "Turn 100 is close. Team HP percentage decides, then damage dealt, then a draw. Protect your HP and finish weakened enemies.", when: (c) => c.state.turn >= 85 },
  { id: "s-kill-available", tier: 'intermediate', text: "That enemy may fall to your Attack. Damage rolls and defenses can spoil a finish, so weigh the risk before you commit.", when: (c) => c.enemies.some((e) => { const d = dist(c.actor, e); return d <= v3.attackRangeOf(c.state, c.actor.class) && BigInt(Math.floor(v3.expectedAttack(c.actor, e, d, c.state))) >= e.hp; }) },
  { id: "s-maelstrom-multi", tier: 'intermediate', text: "Your Tempest can catch at least two foes with Maelstrom. Step into the right hex first if they aren't already within 3.", classes: ["tempest"], when: (c) => cls(c.actor) === 'tempest' && c.actor.charge >= 3 && c.enemies.filter((e) => dist(c.actor, e) <= v3.SPECIAL_RANGE[c.actor.class]).length >= 2 },
  { id: "s-stun-immune", tier: 'advanced', text: "That enemy shook off a stun recently and is immune for now. Bind will still damage it, but it won't stun.", classes: ["kraken"], when: (c) => cls(c.actor) === 'kraken' && c.actor.charge >= 3 && c.enemies.some((e) => e.stunImmunity > 0 && dist(c.actor, e) <= specialReach(c)) },
  { id: "s-rally-unstun", tier: 'advanced', text: "Your ally is stunned, but your Sentinel acts first. Rally it now to clear the stun before its turn is skipped.", classes: ["sentinel"], when: (c) => cls(c.actor) === 'sentinel' && c.actor.charge >= 3 && c.mine.some((m) => m.id !== c.actor.id && has(m, 'stun') && dist(c.actor, m) <= 2) },
];
