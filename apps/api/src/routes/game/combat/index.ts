/**
 * Combat routes — thin router that assembles the three sub-modules:
 *
 *   - queue.ts          — V3 S1 Power Matchmaker endpoints
 *   - battle-reads.ts   — chain reads + DB enrichment
 *   - battle-writes.ts  — calldata builders for battle actions
 *   - session.ts        — V3 live battle sessions (practice + turn submission + state)
 *
 * The split keeps the queue-lifecycle (off-chain, time-sensitive) cleanly
 * separated from the calldata-building (transactional, per-battle) and
 * battle-state reads (idempotent, cacheable).
 */

import { Hono } from 'hono';
import { queueRoutes } from './queue';
import { battleReadRoutes } from './battle-reads';
import { battleWriteRoutes } from './battle-writes';
import { sessionRoutes } from './session';

export const combatRoutes = new Hono();

// Order matters for path-param routes: mount the queue (specific paths first),
// then the static-prefix battle reads/writes (they share `/:battleId/*`).
combatRoutes.route('/', queueRoutes);
// V3 live sessions: /practice + /:battleId/{turn,state,turns,legal}. Mounted before the
// generic reads so its static suffixes win.
combatRoutes.route('/', sessionRoutes);
combatRoutes.route('/', battleReadRoutes);
combatRoutes.route('/', battleWriteRoutes);
