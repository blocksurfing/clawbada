const TIER_LABELS = ['Base', 'Evolved', 'Elite', 'Apex'] as const;

export function formatClaw(value: string | number | bigint): string {
  const num = typeof value === 'bigint' ? Number(value) : Number(value);
  return `${num.toLocaleString('en-US')} $CLAW`;
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
