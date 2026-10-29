/**
 * V3 live battle session endpoints (REST twins of the WebSocket protocol; the
 * agent path).
 *
 * POST /api/game/combat/practice          — start an off-chain practice battle vs a bot
 * POST /api/game/combat/:battleId/turn    — submit the current turn { turn, command }
 * POST /api/game/combat/:battleId/forfeit — resign: the caller's side forfeits
 * GET  /api/game/combat/:battleId/state   — battle_snapshot (live or persisted)
 * GET  /api/game/combat/:battleId/turns   — applied turns (replaces V2 /rounds)
 * GET  /api/game/combat/:battleId/legal   — legal commands for the caller's current actor
 *
 * Practice battles are private to their owner — a wallet, or a guest session (POST /api/auth/guest), which is
 * why these routes take `playerAuth` instead of `walletAuth`; real battles are public reads.
 */
import { Hono } from 'hono';
import { v3, EvolutionTier, LobsterClass } from '@clawbada/game-logic';
import { rollRandomRoster, rollTrioRoster, rollSpecialsRoster, rollTeamRoster, RANDOM_PRESET_RE, TRIO_PRESET_RE, SPECIALS_PRESET_RE, TEAM_PRESET_RE } from '../../../lib/battle-session/random-roster';
import { playerAuth, resolveCaller, assertGuestScope } from '../../../middleware/auth';
import { catchErrors, ApiError } from '../../../lib/errors';
import { evidenceBundle } from '../../../lib/battle-session/evidence';
import { readLobster, readTeam, serializeBigInts } from '../../../lib/chain';
import {
  battleSessions,
  isOffChainId,
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

export { rollRandomRoster, rollTrioRoster, rollSpecialsRoster, rollTeamRoster, RANDOM_PRESET_RE, TRIO_PRESET_RE, SPECIALS_PRESET_RE, TEAM_PRESET_RE, VFX_READY_CLASSES } from '../../../lib/battle-session/random-roster';

function presetsEnabled(): boolean {
  if (process.env.PRACTICE_PRESETS === 'true') return true;
  if (process.env.PRACTICE_PRESETS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/** The Dojo's ceiling on live practice battles (PRACTICE_MAX_LIVE, default 500). A guest session makes a battle
 *  free to start, so the server's memory and bot time get a hard bound: past it POST /practice answers 429 until
 *  battles end — an abandoned one ends itself in about four minutes. */
function practiceMaxLive(): number {
  const n = Number(process.env.PRACTICE_MAX_LIVE);
  return Number.isInteger(n) && n > 0 ? n : 500;
}

function assertBattleId(id: string): void {
  if (!isOffChainId(id) && !CHAIN_ID_RE.test(id)) throw new ApiError('INVALID_INPUT', 'Invalid battleId');
}

/** Off-chain battles (practice, friend) are private to their players: require headers and a participant match.
 *  A guest is a fine player here. */
async function requireParticipantIfPractice(c: { req: { header(name: string): string | undefined } }, battleId: string): Promise<string | null> {
  if (!isOffChainId(battleId)) return null;
  // Either proof is fine here (session token or signature) — resolveCaller throws if neither holds.
  const lower = (await resolveCaller(c.req)).checksumAddress.toLowerCase();
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
      kind: row.kind as 'real' | 'practice' | 'friend',
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
  playerAuth,
  catchErrors(async (c) => {
    if (process.env.PRACTICE_ENABLED === 'false') throw new ApiError('NOT_FOUND', 'Practice mode is disabled');
    if (battleSessions.livePracticeCount() >= practiceMaxLive()) {
      throw new ApiError('RATE_LIMITED', 'The Dojo is full right now — try again in a minute');
    }
    const address = (c.get('address') as string).toLowerCase();
    const guest = c.get('guest') === true;
    const body = await c.req.json<{ teamId?: string; lobsterIds?: string[]; bot?: string; opponent?: string; layoutId?: string; preset?: string; arena?: string; purity?: number }>().catch(() => ({} as Record<string, never>));

    const bot = body.bot ?? 'balanced';
    if (!v3.isBotName(bot)) throw new ApiError('INVALID_INPUT', `bot must be one of ${v3.BOT_NAMES.join(', ')}`);
    const randomPreset = body.preset ? RANDOM_PRESET_RE.exec(body.preset) : null;
    const trioPreset = body.preset ? TRIO_PRESET_RE.exec(body.preset) : null;
    const specialsPreset = body.preset ? SPECIALS_PRESET_RE.exec(body.preset) : null;
    const teamPreset = body.preset ? TEAM_PRESET_RE.exec(body.preset) : null;
    // A random roster defaults to a random opponent too (a mirror of a random team is less interesting).
    const opponent = body.opponent ?? (randomPreset ? 'random' : 'mirror');
    if (opponent !== 'mirror' && opponent !== 'random') throw new ApiError('INVALID_INPUT', "opponent must be 'mirror' or 'random'");
    // The board is a free choice for practice: the tier only sets the layout, art and music. The Dojo (the
    // website's default since 2026-10-21) exists only here — a staked battle's board always follows its lobsters.
    const arena = body.arena === undefined ? undefined : body.arena;
    if (arena !== undefined && arena !== 'evolved' && arena !== 'elite' && arena !== 'apex' && arena !== 'dojo') throw new ApiError('INVALID_INPUT', "arena must be 'evolved', 'elite', 'apex' or 'dojo'");

    // Purity only shapes preset rosters: a real lobster's purity is in its on-chain DNA.
    const purity = body.purity;
    if (purity !== undefined && (!Number.isInteger(purity) || purity < 0 || purity > 6)) throw new ApiError('INVALID_INPUT', 'purity must be an integer 0-6');
    if (purity !== undefined && !body.preset) throw new ApiError('INVALID_INPUT', 'purity applies to preset rosters only');

    let lobsters: PracticeLobster[];
    if (body.preset) {
      // The dojo's team builder speaks `team_*`, so that one family stays open when dev presets
      // are switched off: an off-chain battle with no stakes cannot touch the economy.
      if (!presetsEnabled() && !teamPreset) throw new ApiError('INVALID_INPUT', 'preset rosters are disabled');
      if (randomPreset || trioPreset || specialsPreset || teamPreset) {
        const r = randomPreset ? rollRandomRoster(randomPreset[1], Math.random, purity)
          : specialsPreset ? rollSpecialsRoster(specialsPreset[1] ?? 'elite', Math.random, purity)
          : teamPreset ? rollTeamRoster([teamPreset[1], teamPreset[2], teamPreset[3]], teamPreset[4] ?? 'elite', Math.random, purity)
          : rollTrioRoster(trioPreset![1], trioPreset![2] ?? 'elite', Math.random, purity);
        lobsters = r.classes.map((cls, i) => ({ input: { id: `preset-${i}`, class: cls, tier: r.tier, purity: r.purity[i], legend: false }, partClassIds: r.partClassIds[i] }));
      } else {
        const p = PRESETS[body.preset];
        if (!p) throw new ApiError('INVALID_INPUT', `preset must be one of random_<tier>, trio_<class>[_<tier>], team_<class>_<class>_<class>[_<tier>], specials[_<tier>], ${Object.keys(PRESETS).join(', ')}`);
        lobsters = p.classes.map((cls, i) => ({ input: { id: `preset-${i}`, class: cls, tier: p.tier, purity: purity ?? 3, legend: false } }));
      }
    } else {
      // A guest owns nothing on-chain; the ownership reads below would only say so more slowly.
      if (guest) {
        throw new ApiError('INVALID_INPUT', 'Guest sessions play preset rosters only — connect a wallet to train with your own lobsters (teamId / lobsterIds)');
      }
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
      const session = await battleSessions.startPractice({ owner: address, lobsters, bot, opponent, layoutId: body.layoutId, arena, purity });
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
  playerAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    assertGuestScope(c.get('guest') === true, battleId);
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

// ──────────── POST /:battleId/forfeit ────────────

sessionRoutes.post(
  '/:battleId/forfeit',
  playerAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    assertGuestScope(c.get('guest') === true, battleId);
    const address = (c.get('address') as string).toLowerCase();
    const res = battleSessions.forfeit(battleId, address);
    if (!res.ok) {
      if (res.code === 'session_not_found') throw new ApiError('NOT_FOUND', res.message);
      if (res.code === 'not_participant') throw new ApiError('UNAUTHORIZED', res.message);
      return c.json({ error: 'BATTLE_PHASE_ERROR', code: res.code, message: res.message }, 409);
    }
    return c.json({ ok: true, winner: res.winner });
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

// ──────────── GET /:battleId/events?after=<turn>&wait=<s> ────────────
// Long-poll for agents without a socket (2026-10-29). Answers as soon as the battle has resolved a turn past `after`,
// started, ended, or sent any other event; otherwise after `wait` seconds (default 20, at most 25 — under the load
// balancer's 30 s). The answer is the same snapshot as /state plus `changed` and, once over, `ended`. Loop:
//   events(after = snapshot.state.turn) → if current.side is yours: legal → turn → events(...) again.
// Turn-by-turn results are on /turns. Same auth as /state (off-chain battles: their players only).
const EVENTS_MAX_WAIT_S = 25;
sessionRoutes.get(
  '/:battleId/events',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    await requireParticipantIfPractice(c, battleId);
    const afterRaw = c.req.query('after');
    const after = afterRaw === undefined ? -1 : Number(afterRaw);
    if (!Number.isInteger(after) || after < -1) throw new ApiError('INVALID_INPUT', 'after must be a turn number (-1 for "anything")');
    const waitRaw = Number(c.req.query('wait') ?? 20);
    const waitS = Number.isFinite(waitRaw) ? Math.min(EVENTS_MAX_WAIT_S, Math.max(0, waitRaw)) : 20;
    const result = after < 0 ? 'changed' : await battleSessions.waitForChange(battleId, after, waitS * 1000);
    const snap = battleSessions.snapshotFor(battleId) ?? (await persistedSnapshot(battleId));
    if (!snap) throw new ApiError('NOT_FOUND', 'No battle session with that id');
    const over = snap.session.status !== 'active' || snap.state.finished;
    return c.json({
      changed: result === 'changed' || (result === 'gone' && over),
      // 'busy': too many open polls — poll again after a short pause. 'gone' while not over: the battle is moving
      // between instances (a deploy) — poll again in a second.
      retry: result === 'busy' || (result === 'gone' && !over) ? 1 : undefined,
      turn: snap.state.turn,
      status: snap.session.status,
      ended: over ? { winner: snap.session.winner ?? snap.state.winner ?? null } : undefined,
      snapshot: snap,
    });
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

// ──────────── GET /:battleId/log ────────────
//
// D-12 (audit 2026-09): everything needed to check a finished battle WITHOUT trusting this
// server. The on-chain `turnLogHash` commits to {rules version, battle id, seed, arena, roster,
// ordered log}; until now a player could not rebuild it — the API never returned the seed or
// the drand round, and the only copy of the evidence sat in the server's own database. The
// engine's watchdog runs the same check on every result during its review window. With this
// bundle anyone can:
//   1. check the seed themselves: keccak(drand randomness of `vrfRound`, the seed secret
//      `settle` disclosed on-chain, battleId);
//   2. `v3.verifyLog(cfg, log)` — re-execute every turn and compare every per-turn hash;
//   3. `v3.turnLogHash(state, roster)` and compare it with BattleArena.getBattle().turnLogHash.
// Only once the battle has ENDED: during play the seed decides every future roll.
sessionRoutes.get(
  '/:battleId/log',
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    await requireParticipantIfPractice(c, battleId);
    const row = await battleSessions['deps'].store.get(battleId);
    if (!row || !row.stateJson) throw new ApiError('NOT_FOUND', 'No battle session with that id');
    if (row.status === 'active') {
      throw new ApiError('BATTLE_PHASE_ERROR', 'The battle log and seed are published when the battle ends');
    }
    return c.json(serializeBigInts(evidenceBundle(row)));
  }),
);

// ──────────── GET /:battleId/legal ────────────

sessionRoutes.get(
  '/:battleId/legal',
  playerAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    assertBattleId(battleId);
    assertGuestScope(c.get('guest') === true, battleId);
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

