'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type PoolDepthAll, type PoolDepthSingle } from '@/lib/api';

/** How long pool-depth results stay fresh in the React Query cache. The
 *  matchmaker ticks every 5s; staleness up to 30s is fine for UX hints. */
const POOL_DEPTH_STALE_MS = 30_000;

/** Single-bucket pool depth (used inline by the radius bar / Team Builder). */
export function usePoolDepth(bracket: number | null, power: number | null) {
  return useQuery({
    queryKey: ['poolDepth', bracket, power],
    queryFn: () => api.combat.poolDepth(bracket!, power!) as Promise<PoolDepthSingle>,
    enabled: bracket !== null && power !== null,
    staleTime: POOL_DEPTH_STALE_MS,
    refetchInterval: POOL_DEPTH_STALE_MS,
  });
}

/** Full pool-depth snapshot (used by the Team Builder to render expected-wait
 *  hints across all stake brackets at the player's current team power). */
export function useAllPoolDepths() {
  return useQuery({
    queryKey: ['poolDepth', 'all'],
    queryFn: () => api.combat.poolDepth() as Promise<PoolDepthAll>,
    staleTime: POOL_DEPTH_STALE_MS,
    refetchInterval: POOL_DEPTH_STALE_MS,
  });
}

/** Convenience: the depth of the (bracket, power) bucket from a full snapshot. */
export function poolDepthFor(
  all: PoolDepthAll | undefined,
  bracket: number,
  power: number,
): number {
  if (!all) return 0;
  const row = all.pools.find((p) => p.bracket === bracket && p.power === power);
  return row?.depth ?? 0;
}
