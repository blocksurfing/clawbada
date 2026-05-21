/**
 * Combat routes — thin router that assembles the three sub-modules:
 *
 *   - queue.ts          — V3 S1 Power Matchmaker endpoints
 *   - battle-reads.ts   — chain reads + DB enrichment
 *   - battle-writes.ts  — calldata builders for battle actions
 *
 * The split keeps the queue-lifecycle (off-chain, time-sensitive) cleanly
 * separated from the calldata-building (transactional, per-battle) and
 * battle-state reads (idempotent, cacheable).
 */

import { Hono } from 'hono';
import { queueRoutes } from './queue';
import { battleReadRoutes } from './battle-reads';
import { battleWriteRoutes } from './battle-writes';

export const combatRoutes = new Hono();

// Order matters for path-param routes: mount the queue (specific paths first),
// then the static-prefix battle reads/writes (they share `/:battleId/*`).
combatRoutes.route('/', queueRoutes);
combatRoutes.route('/', battleReadRoutes);
combatRoutes.route('/', battleWriteRoutes);
