import { pgTable, text, bigint, integer, smallint, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const battles = pgTable('battles', {
  battleId: bigint('battle_id', { mode: 'bigint' }).primaryKey(),
  playerA: text('player_a').notNull(),
  playerB: text('player_b').notNull(),
  teamA: bigint('team_a', { mode: 'bigint' }).notNull(),
  teamB: bigint('team_b', { mode: 'bigint' }).notNull(),
  stakeBracket: smallint('stake_bracket').notNull(), // 0=Low, 1=Mid, 2=High
  stakeAmount: text('stake_amount').notNull(), // $CLAW
  phase: smallint('phase').notNull().default(0), // BattlePhase enum
  winner: text('winner'),
  protocolFee: text('protocol_fee'),
  winnerPayout: text('winner_payout'),
  totalRounds: smallint('total_rounds'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  settledAt: timestamp('settled_at'),
});

export const battleRounds = pgTable('battle_rounds', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  battleId: bigint('battle_id', { mode: 'bigint' }).notNull(),
  round: smallint('round').notNull(),
  // JSON array of round actions (moves, damage, crits, etc.)
  actions: jsonb('actions').notNull(),
  teamAHp: jsonb('team_a_hp').notNull(), // [bigint, bigint, bigint] as strings
  teamBHp: jsonb('team_b_hp').notNull(),
  vrfSeed: text('vrf_seed'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
