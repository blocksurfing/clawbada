import { pgTable, text, jsonb, integer, timestamp, index, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * V3 live battle sessions — the server-authoritative ATB turn loop's durable
 * state. One row per battle the API's BattleSessionManager runs:
 *
 *   - `kind = 'real'`    → id is the on-chain battle id (decimal string); the
 *                          session starts when the indexer mirrors phase 4 (Active)
 *                          and ends by enqueueing a `settle_battle` operator job.
 *   - `kind = 'practice'` → id is `p_<uuid>`; off-chain only, one human vs a bot,
 *                          never touches battles / ratings / participation.
 *
 * `state_json` is the full `v3.serializeState` snapshot after the latest turn so a
 * restarted API resumes every active battle exactly where it stopped (the engine's
 * randomness is stateless keccak from the seed, so nothing else is needed).
 */
export const battleSessions = pgTable(
  'battle_sessions',
  {
    /** Decimal chain battle id, or `p_<uuid>` for practice. */
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    /** Lowercase wallet for A; B is a wallet for real battles or `bot:<name>` for practice. */
    playerA: text('player_a').notNull(),
    playerB: text('player_b').notNull(),
    /** Practice only: the bot policy name (BOT_NAMES). */
    bot: text('bot'),
    /** Arena tier ('evolved' | 'elite' | 'apex') = min evolution tier across the six lobsters. */
    tier: text('tier').notNull(),
    /** drand round the VRF seed came from (real battles); null for practice (random seed). */
    vrfRound: integer('vrf_round'),
    /** Both rosters as shipped to clients (ids, classes, tiers, purity, owners, part class ids). */
    roster: jsonb('roster').notNull(),
    /** `v3.serializeState(state)` after the latest applied turn. */
    stateJson: text('state_json').notNull(),
    /** Mirrors state.turn for cheap queries / totalRounds. */
    turn: integer('turn').notNull().default(0),
    /** Shot-clock deadline of the pending human turn; null while a bot thinks or when finished. */
    deadline: timestamp('deadline'),
    /** Consecutive-timeout counters per side, mirrored from the session clock. */
    timeouts: jsonb('timeouts').notNull().default(sql`'{"A":0,"B":0}'::jsonb`),
    status: text('status').notNull().default('active'),
    /** 'A' | 'B' | 'draw' once finished. */
    winner: text('winner'),
    finalStateHash: text('final_state_hash'),
    turnLogHash: text('turn_log_hash'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('battle_sessions_status_idx').on(t.status),
    ownerIdx: index('battle_sessions_kind_player_a_idx').on(t.kind, t.playerA),
    kindCk: check('battle_sessions_kind_ck', sql`${t.kind} IN ('real', 'practice')`),
    statusCk: check('battle_sessions_status_ck', sql`${t.status} IN ('active', 'finished', 'settling', 'settled', 'abandoned')`),
  }),
);

/** One row per applied turn: the command, the resolved result, and the post-state hash chain. */
export const battleTurns = pgTable(
  'battle_turns',
  {
    sessionId: text('session_id').notNull(),
    turn: integer('turn').notNull(),
    /** Empty string for a forfeit entry. */
    lobsterId: text('lobster_id').notNull(),
    /** The TurnCommand as submitted (null for stun skips and forfeits). */
    command: jsonb('command'),
    /** The wire-safe TurnResult (bigints as strings). */
    result: jsonb('result').notNull(),
    postStateHash: text('post_state_hash').notNull(),
    /** 'player' | 'bot' | 'timeout' | 'stun' | 'forfeit'. */
    submittedBy: text('submitted_by').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.turn] }),
    submittedByCk: check('battle_turns_submitted_by_ck', sql`${t.submittedBy} IN ('player', 'bot', 'timeout', 'stun', 'forfeit')`),
  }),
);
