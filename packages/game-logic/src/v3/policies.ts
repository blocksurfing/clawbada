/**
 * Named bot registry for the practice mode. Kept out of bots.ts / styles.ts
 * (styles imports bots) so nothing cycles.
 */
import { BOTS } from './bots';
import { greedyPolicy, type Policy } from './sim';
import { STYLE_BOTS } from './styles';

export const BOT_NAMES = ['greedy', 'aggressive', 'balanced', 'cautious', 'charger', 'focus', 'roles', 'deep'] as const;
export type BotName = (typeof BOT_NAMES)[number];

export function isBotName(x: unknown): x is BotName {
  return typeof x === 'string' && (BOT_NAMES as readonly string[]).includes(x);
}

/** Resolve a bot by name. Throws on an unknown name — validate with `isBotName` first for user input. */
export function botPolicy(name: BotName): Policy {
  if (name === 'greedy') return greedyPolicy;
  const p = BOTS[name] ?? STYLE_BOTS[name];
  if (!p) throw new Error(`Unknown bot ${name}`);
  return p;
}
