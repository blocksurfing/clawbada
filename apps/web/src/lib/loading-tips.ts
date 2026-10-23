/**
 * The gameplay tips shown on the battle loading screen (the Unity training scene's `GameplayTip` text; handed over
 * with `ShowLoading {tip}`). Thirty one-liners, each under 90 characters so one fits on two lines, every one stating
 * a rule as it stands in the book today — when a rule changes, its tip changes here, with no Unity build needed.
 * Source of truth for the wording: the "Battle Entry Sequence" spec (2026-10-21), section "The tips pool".
 */
export const LOADING_TIPS: readonly string[] = [
  'Defend halves incoming damage and banks 2 charge instead of 1.',
  'A Special costs 3 charge and spends all of it. Defend twice to reach it fastest.',
  'Attacks weaken with distance: full at 1 hex, 75% at 2, half at 3. Further is a miss.',
  'Only a Specter can hit from 4 hexes, at 40% power.',
  'A ranged attack loses 20% while an enemy stands next to the attacker. Engage the archers.',
  'Each hit a lobster takes before its next turn softens the next one by 10%.',
  'A Specter shrugs off 30% of the first hit it takes between its turns.',
  "Fortify cuts your team's incoming damage 40% and makes adjacent enemies hit the Bulwark.",
  'Class advantage: 1.25× one way, 0.8× the other. Each class beats four and loses to four.',
  'Critical chance is Critical ÷ (Critical + 200). A crit deals 1.5×.',
  'Speed decides how often you act. A Mantis takes nearly twice as many turns as a Leviathan.',
  'Buffs and debuffs clamp Speed between half and one and a half times its base.',
  'A stunned lobster is immune to stuns for two turns afterwards. Bind chains do not work.',
  'Bulwark and Leviathan move 1 hex; Sentinel, Abyss, Kraken and Reaver 2; the rest 3.',
  'Each matching gene adds 10% Special power and 5% enhanced chance. Stats stay the same.',
  'A pure lobster fires its enhanced Special about one cast in three.',
  "Mantis's Ambush ignores half the target's Armor. Leviathan's Crush is the hardest hit.",
  "Tempest's Maelstrom hits every enemy within 3 hexes. Stay spread out against one.",
  "Reaver's Rend bleeds for six of the target's turns. Sentinel's Rally cleanses it.",
  "Ember's Inferno reaches 4 hexes and hits hardest of all, but the caster eats 25% of it.",
  'Abyss heals itself by the damage Devour deals.',
  "Specter's Haunt cuts the target's Attack and Armor by 20% for four of its turns.",
  'The shot clock is 60 s; an unanswered turn Defends by itself. Three in a row forfeits.',
  'The 100-turn cap breaks ties by remaining HP, then damage dealt. Turtling does not draw.',
  'A win costs 5–15 damage, a loss 20–40. At 80 a lobster must be repaired before it fights.',
  'Repairs are instant and partial repairs are allowed. Stay under 80 and keep fighting.',
  'Only Evolved lobsters and above enter the arena. Base lobsters mine.',
  'A damaged lobster can still mine. Damage only closes the arena door.',
  'Team rating starts at 1,200; matchmaking pairs within ±75 and widens to ±300 as you wait.',
  'Practice has no stakes, rating or repair. Try the bot that defends and banks charge.',
];

const LAST_KEY = 'clawbada.loading.lastTip';

/** A tip at random, never the one this tab showed last (remembered in sessionStorage; absent in tests and SSR). */
export function pickLoadingTip(random: () => number = Math.random): string {
  let last = -1;
  try { last = Number(window.sessionStorage.getItem(LAST_KEY) ?? -1); } catch { /* SSR, private mode */ }
  let i = Math.floor(random() * LOADING_TIPS.length);
  if (i === last && LOADING_TIPS.length > 1) i = (i + 1) % LOADING_TIPS.length;
  try { window.sessionStorage.setItem(LAST_KEY, String(i)); } catch { /* ignore */ }
  return LOADING_TIPS[i];
}
