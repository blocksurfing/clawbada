const TIER_LABELS = ['Base', 'Evolved', 'Elite', 'Apex'] as const;

const CLAW_DECIMALS = 18n;
const CLAW_WEI_PER_TOKEN = 10n ** CLAW_DECIMALS;

/**
 * Format a $CLAW amount that's already in display units (e.g. `2500` →
 * `"2,500 $CLAW"`).
 *
 * **Unit contract**: `value` must be in display units, NOT wei. Pass `2500`
 * for 2,500 $CLAW; do NOT pass `2_500e18` (the on-chain wei form).
 *
 * **Source semantics (post-F-12)**: `battles.stakeAmount`, `battles.winnerPayout`,
 * and `expedition.reward` columns store DISPLAY values now — the matchmaker
 * writes display directly and the indexer divides chain-emitted wei by 1e18
 * before storing. So `formatClaw(battle.stakeAmount)` is correct from the DB.
 *
 * For values read DIRECTLY from chain via wagmi/viem (e.g. `chain.stakeAmount`
 * on a getBattle result), the value is wei — use {@link formatClawWei}.
 */
export function formatClaw(value: string | number | bigint): string {
  const num = typeof value === 'bigint' ? Number(value) : Number(value);
  return `${num.toLocaleString('en-US')} $CLAW`;
}

/**
 * Format a $CLAW amount stored in wei (1e18 = 1 token). Use this for any
 * value that originated from a chain read or a DB column that mirrors the
 * chain — it divides by `CLAW_WEI_PER_TOKEN` before formatting.
 *
 * Loses precision below 1 wei when converting to JS number, but $CLAW is
 * always integer wei amounts so that doesn't matter in practice. We use
 * BigInt arithmetic for the divide to avoid Number-precision loss on
 * values above 2^53.
 */
export function formatClawWei(value: string | bigint): string {
  const wei = typeof value === 'bigint' ? value : BigInt(value);
  // Whole-token portion (truncates fractional wei — fine for $CLAW since
  // amounts are always whole-token multiples in practice).
  const whole = wei / CLAW_WEI_PER_TOKEN;
  return `${Number(whole).toLocaleString('en-US')} $CLAW`;
}

export function formatAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatCountdown(endTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = endTimestamp - now;
  if (remaining <= 0) return 'Complete';
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? 'Unknown';
}
