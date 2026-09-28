/**
 * The practice bots, in ONE place for the Dojo and the Practice tab: easiest first, each with the
 * way it plays and what fighting it teaches. The names are the API's (`v3.BOT_NAMES`).
 *
 * Order and difficulty are MEASURED, not guessed: `bun run styles -- --n 150 --tier elite`
 * (packages/game-logic, 300 mirrored battles per pairing, 2026-09-28 — after `deep` learned focus fire
 * and cover; docs/_generated/balance/2026-09-28-bot-ladder.md). `score` is the bot's
 * average win % against the other seven. Re-run it after any rules change and re-order.
 */
import type { v3 } from '@clawbada/game-logic';

export type BotName = v3.BotName;
export type BotDifficulty = 'Easy' | 'Medium' | 'Hard';

export interface BotInfo {
  name: BotName;
  label: string;
  difficulty: BotDifficulty;
  /** Average win % vs the other bots (see file header). */
  score: number;
  /** How it plays, then what beating it teaches. One line each, plain words. */
  plays: string;
  teaches: string;
}

export const BOT_CATALOG: readonly BotInfo[] = [
  { name: 'charger', label: 'Charger', difficulty: 'Easy', score: 24,
    plays: 'Defends to bank charge, then unloads its Specials.',
    teaches: 'Hit it hard while it turtles, before the Specials come.' },
  { name: 'greedy', label: 'Greedy', difficulty: 'Easy', score: 30,
    plays: 'Walks straight at you and hits the weakest lobster it can reach.',
    teaches: 'A first opponent: learn the controls and the board.' },
  { name: 'cautious', label: 'Cautious', difficulty: 'Easy', score: 35,
    plays: 'Keeps its distance and avoids getting hit.',
    teaches: 'Close the gap and pin down a kiter.' },
  { name: 'balanced', label: 'Balanced', difficulty: 'Medium', score: 53,
    plays: 'Weighs damage against risk every turn.',
    teaches: 'The standard sparring partner.' },
  { name: 'aggressive', label: 'Aggressive', difficulty: 'Medium', score: 54,
    plays: 'Goes for the most damage and the kill, even at a risk.',
    teaches: 'Punish it when it overextends.' },
  { name: 'roles', label: 'Roles', difficulty: 'Medium', score: 59,
    plays: 'Plays each class to its job: ranged kite at two hexes, melee brawls, tanks body-block, Sentinel shadows the wounded.',
    teaches: 'Positioning, and what each class is for.' },
  { name: 'focus', label: 'Focus', difficulty: 'Hard', score: 67,
    plays: 'All three pile onto one of your lobsters until it drops.',
    teaches: 'Protect the target (Defend it, Fortify, heal it with Rally) and punish the pile-on.' },
  { name: 'deep', label: 'Deep', difficulty: 'Hard', score: 77,
    plays: 'Looks two moves ahead, gangs up on one of your lobsters and covers its own weakest. The strongest bot.',
    teaches: 'Everything at once: think a turn ahead, focus your damage, protect your weak link.' },
] as const;

export const DEFAULT_BOT: BotName = 'balanced';

export function botInfo(name: string): BotInfo | undefined {
  return BOT_CATALOG.find((b) => b.name === name);
}
