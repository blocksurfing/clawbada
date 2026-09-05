/**
 * V3 live battle session endpoints (REST twins of the WebSocket protocol; the
 * agent path).
 *
 * POST /api/game/combat/practice          — start an off-chain practice battle vs a bot
 * POST /api/game/combat/:battleId/turn    — submit the current turn { turn, command }
 * GET  /api/game/combat/:battleId/state   — battle_snapshot (live or persisted)
 * GET  /api/game/combat/:battleId/turns   — applied turns (replaces V2 /rounds)
 * GET  /api/game/combat/:battleId/legal   — legal commands for the caller's current actor
 *
 * Practice battles are private to their owner; real battles are public reads.
 */
import { Hono } from 'hono';
import { v3, EvolutionTier, LobsterClass } from '@clawbada/game-logic';
import { walletAuth, verifyWalletSignature } from '../../../middleware/auth';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readLobster, readTeam, serializeBigInts } from '../../../lib/chain';
import {
  battleSessions,
  isPracticeId,
  CHAIN_ID_RE,
  PracticeConflictError,
  type BattleSnapshot,
  type PracticeLobster,
  type RosterEntry,
} from '../../../lib/battle-session';

export const sessionRoutes = new Hono();

const PRESETS: Record<string, { tier: EvolutionTier; classes: LobsterClass[] }> = {
  evolved_mix: { tier: EvolutionTier.Evolved, classes: [LobsterClass.Bulwark, LobsterClass.Mantis, LobsterClass.Sentinel] },
  elite_mix: { tier: EvolutionTier.Elite, classes: [LobsterClass.Kraken, LobsterClass.Reaver, LobsterClass.Tempest] },
  apex_mix: { tier: EvolutionTier.Apex, classes: [LobsterClass.Leviathan, LobsterClass.Ember, LobsterClass.Abyss] },
};

function presetsEnabled(): boolean {
  if (process.env.PRACTICE_PRESETS === 'true') return true;
  if (process.env.PRACTICE_PRESETS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function assertBattleId(id: string): void {
  if (!isPracticeId(id) && !CHAIN_ID_RE.test(id)) throw new ApiError('INVALID_INPUT', 'Invalid battleId');
}

/** Practice battles are owner-only: require headers and a participant match. */
async function requireParticipantIfPractice(c: { req: { header(name: string): string | undefined } }, battleId: string): Promise<string | null> {
  if (!isPracticeId(battleId)) return null;
  const address = c.req.header('X-Wallet-Address');
  const signature = c.req.header('X-Signature');
  const timestamp = c.req.header('X-Timestamp');
  if (!address || !signature || !timestamp) throw new ApiError('UNAUTHORIZED', 'Practice battles are private: sign the request');
  const { checksumAddress } = await verifyWalletSignature({ address, signature, timestamp: Number(timestamp) });
  const lower = checksumAddress.toLowerCase();
  if (!(await battleSessions.isParticipant(battleId, lower))) throw new ApiError('UNAUTHORIZED', 'Not a participant in this battle');
  return lower;
}

async function persistedSnapshot(battleId: string): Promise<BattleSnapshot | null> {
  const store = battleSessions['deps'].store;
  const row = await store.get(battleId);
  if (!row || !row.stateJson) return null;
  const state = v3.deserializeState(row.stateJson);
  return {
    session: {
      id: row.id,
      kind: row.kind as 'real' | 'practice',
      tier: row.tier as v3.ArenaLayout['tier'],
      playerA: row.playerA,
      playerB: row.playerB,
      bot: row.bot,
      status: row.status as BattleSnapshot['session']['status'],
      winner: (row.winner as 'A' | 'B' | 'draw' | null) ?? state.winner,
      createdAt: row.createdAt.getTime(),
    },
    state: v3.clientView(state),
    current: { turn: 0, lobsterId: null, side: null, controller: null, deadline: null },
    timeouts: (row.timeouts as Record<'A' | 'B', number>) ?? { A: 0, B: 0 },
    roster: row.roster as RosterEntry[],
  };
}

// ──────────── POST /practice ────────────

sessionRoutes.post(
  '/practice',
  walletAuth,
  catchErrors(async (c) => {
    if (process.env.PRACTICE_ENABLED === 'false') throw new ApiError('NOT_FOUND', 'Practice mode is disabled');
    const address = (c.get('address') as string).toLowerCase();
    const body = await c.req.json<{ teamId?: string; lobsterIds?: string[]; bot?: string; opponent?: string; layoutId?: string; preset?: string }>().catch(() => ({} as Record<string, never>));

    const bot = body.bot ?? 'balanced';
    if (!v3.isBotName(bot)) throw new ApiError('INVALID_INPUT', `bot must be one of ${v3.BOT_NAMES.join(', ')}`);
    const opponent = body.opponent ?? 'mirror';
    if (opponent !== 'mirror' && opponent !== 'random') throw new ApiError('INVALID_INPUT', "opponent must be 'mirror' or 'random'");

    let lobsters: PracticeLobster[];
    if (body.preset) {
      if (!presetsEnabled()) throw new ApiError('INVALID_INPUT', 'preset rosters are disabled');
      const p = PRESETS[body.preset];
      if (!p) throw new ApiError('INVALID_INPUT', `preset must be one of ${Object.keys(PRESETS).join(', ')}`);
      lobsters = p.classes.map((cls, i) => ({ input: { id: `preset-${i}`, class: cls, tier: p.tier, purity: 3, legend: false } }));
    } else {
      let tokenIds: bigint[];
      if (body.teamId) {
        if (!/^\d+$/.test(body.teamId)) throw new ApiError('INVALID_INPUT', 'teamId must be a decimal id');
        const team = await readTeam(BigInt(body.teamId));
        if (team.owner.toLowerCase() !== address) throw new ApiError('UNAUTHORIZED', 'You do not own that team');
        tokenIds = [...team.lobsterIds];
      } else if (Array.isArray(body.lobsterIds) && body.lobsterIds.length === 3) {
        if (!body.lobsterIds.every((x) => typeof x === 'string' && /^\d+$/.test(x))) throw new ApiError('INVALID_INPUT', 'lobsterIds must be decimal ids');
        tokenIds = body.lobsterIds.map((x) => BigInt(x));
        if (new Set(tokenIds.map(String)).size !== 3) throw new ApiError('INVALID_INPUT', 'lobsterIds must be distinct');
      } else {
        throw new ApiError('INVALID_INPUT', 'Provide teamId, three lobsterIds, or a preset');
      }
      const chain = await Promise.all(tokenIds.map((t) => readLobster(t)));
      for (const l of chain) if (l.owner.toLowerCase() !== address) throw new ApiError('UNAUTHORIZED', `You do not own lobster #${l.tokenId}`);
      lobsters = chain.map((l) => ({
        input: v3.lobsterInputFromChain({ tokenId: l.tokenId, dna: l.dna, evolutionTier: l.evolutionTier, purity: l.purity }),
        tokenId: l.tokenId.toString(),
        partClassIds: v3.partClassIds(l.dna),
      }));
    }

    try {
      const session = await battleSessions.startPractice({ owner: address, lobsters, bot, opponent, layoutId: body.layoutId });
      return c.json({ battleId: session.record.id, snapshot: session.snapshot() }, 201);
    } catch (err) {
      if (err instanceof PracticeConflictError) throw new ApiError('BATTLE_PHASE_ERROR', `You already have an active practice battle: ${err.existingId}`);
      if (err instanceof Error && /unknown layout/.test(err.message)) throw new ApiError('INVALID_INPUT', err.message);
      throw err;
    }
  }),
);

// ──────────── POST /:battleId/turn ────────────

sessionRoutes.post(
  '/:battleId/turn',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    const address = (c.get('address') as string).toLowerCase();
    const body = await c.req.json<{ turn?: unknown; command?: unknown }>().catch(() => ({} as Record<string, never>));
    if (typeof body.turn !== 'number' || !Number.isInteger(body.turn) || body.turn < 0) throw new ApiError('INVALID_INPUT', 'turn must be a non-negative integer');
    const res = battleSessions.submit(battleId, address, body.turn, body.command);
    if (!res.ok) {
      if (res.code === 'session_not_found') throw new ApiError('NOT_FOUND', res.message);
      if (res.code === 'not_participant') throw new ApiError('UNAUTHORIZED', res.message);
      if (res.code === 'bad_command') throw new ApiError('INVALID_INPUT', res.message);
      return c.json({ error: 'BATTLE_PHASE_ERROR', code: res.code, message: res.message, turn: res.turn }, 409);
    }
    return c.json({ accepted: true, duplicate: res.duplicate, result: res.result });
  }),
);

// ──────────── GET /:battleId/state ────────────

sessionRoutes.get(
  '/:battleId/state',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    await requireParticipantIfPractice(c, battleId);
    const snap = battleSessions.snapshotFor(battleId) ?? (await persistedSnapshot(battleId));
    if (!snap) throw new ApiError('NOT_FOUND', 'No battle session with that id');
    return c.json(snap);
  }),
);

// ──────────── GET /:battleId/turns ────────────

sessionRoutes.get(
  '/:battleId/turns',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    await requireParticipantIfPractice(c, battleId);
    const turns = await battleSessions['deps'].store.listTurns(battleId);
    return c.json(serializeBigInts({ battleId, count: turns.length, turns }));
  }),
);

// ──────────── GET /:battleId/legal ────────────

sessionRoutes.get(
  '/:battleId/legal',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    const address = (c.get('address') as string).toLowerCase();
    const session = battleSessions.get(battleId);
    if (!session) throw new ApiError('NOT_FOUND', 'No live battle with that id');
    const side = session.sideOf(address);
    if (!side) throw new ApiError('UNAUTHORIZED', 'Not a participant in this battle');
    const cur = session.current();
    if (cur.side !== side || !cur.lobsterId) {
      return c.json({ error: 'BATTLE_PHASE_ERROR', code: 'not_your_turn', message: 'It is not your turn', turn: cur.turn }, 409);
    }
    const actor = session.state.lobsters.find((l) => l.id === cur.lobsterId)!;
    return c.json({
      turn: cur.turn,
      lobsterId: cur.lobsterId,
      deadline: cur.deadline,
      commands: v3.legalCommands(session.state, actor),
      summary: v3.legalSummary(session.state, actor),
    });
  }),
);

