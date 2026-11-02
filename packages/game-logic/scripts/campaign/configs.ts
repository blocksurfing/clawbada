/**
 * Named rule packages for the strong-play balance campaign (2026-11-02). A config is a Partial<BattleRules> on top
 * of DEFAULT_RULES; `statMult` / `focusOnWait` are the campaign's optional instruments (absent = today's game).
 * Add candidates here; `bun scripts/strong-balance.ts --config a,b` runs them.
 */
import type { v3 } from '../../src/index';

export const CONFIGS: Record<string, Partial<v3.BattleRules>> = {
  baseline: {},
  focus40: { focusOnWait: { bonusBps: 4000n, bonusCharge: 1 } },
  focus50: { focusOnWait: { bonusBps: 5000n, bonusCharge: 1 } },
};
