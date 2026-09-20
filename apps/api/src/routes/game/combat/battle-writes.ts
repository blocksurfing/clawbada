/**
 * POST endpoints for battle actions — calldata builders. The API never sends
 * tx itself; it returns calldata for the agent (or wallet) to sign and broadcast.
 *
 * POST /api/game/combat/:battleId/deposit       — approve + deposit stake
 * POST /api/game/combat/:battleId/commit-team   — submit team commit hash
 * POST /api/game/combat/:battleId/reveal-team   — submit team-reveal salt (F5-01:
 *                                                   server-verified, engine submits the
 *                                                   atomic revealTeams — no calldata)
 * POST /api/game/combat/:battleId/handle-timeout — permissionless timeout calldata
 * POST /api/game/combat/:battleId/dispute        — approve bond + disputeBattle (D-06)
 *
 * V3: battle turns are played off-chain over WebSocket (the battle-session
 * manager); the V2 per-round `commit-moves` / `reveal-moves` calldata routes are
 * gone with the on-chain round loop.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import {
  BattleArenaAbi,
  ClawTokenAbi,
  addresses,
  teamCommitHash,
} from '@clawbada/chain';
import { ANTI_GRIEF_DEPOSIT_BPS, BattlePhase, STAKE_BRACKETS } from '@clawbada/game-logic';
import { db, battles } from '@clawbada/db';
import { log as baseLog } from '../../../logger';
import { walletAuth } from '../../../middleware/auth';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readBattle, readChainTime, readDisputeBond, serializeBigInts } from '../../../lib/chain';
import { buildCalldata, singleStep, multiStep } from '../../../lib/calldata';

const log = baseLog.child({ module: 'combat:writes' });

export const battleWriteRoutes = new Hono();

/** D-08: null when the on-chain battle is exactly the match this server made for `address`;
 *  otherwise what differs. Pure, so every branch is unit-tested. */
export function depositConsentMismatch(
  address: string,
  onChain: { playerA: string; playerB: string; stakeAmount: bigint; powerA?: number | bigint; powerB?: number | bigint },
  row: { playerA: string; playerB: string; stakeBracket: number; powerA: number | null; powerB: number | null; fromMatchmaker?: boolean | null } | undefined,
): string | null {
  if (!row) return 'no match on record';
  if (row.fromMatchmaker === false) return 'the battle was not created by this matchmaker';
  const a = onChain.playerA.toLowerCase();
  const b = onChain.playerB.toLowerCase();
  if (address !== a && address !== b) return 'you are not a participant';
  if (row.playerA.toLowerCase() !== a || row.playerB.toLowerCase() !== b) return 'the players differ from the match on record';
  const expectedStake = STAKE_BRACKETS[row.stakeBracket];
  if (expectedStake === undefined || onChain.stakeAmount !== expectedStake * 10n ** 18n) {
    return `the stake differs from the bracket you queued for (on-chain ${onChain.stakeAmount / 10n ** 18n} CLAW)`;
  }
  if (row.powerA !== null && onChain.powerA !== undefined && Number(onChain.powerA) !== row.powerA) return 'Team Power A differs from the match on record';
  if (row.powerB !== null && onChain.powerB !== undefined && Number(onChain.powerB) !== row.powerB) return 'Team Power B differs from the match on record';
  return null;
}

battleWriteRoutes.post(
  '/:battleId/deposit',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();
    const { battleId } = c.req.param();
    const id = BigInt(battleId);

    const battle = await readBattle(id);

    // D-08 (audit 2026-09): consent on-chain is a bare deposit(battleId) — the player never
    // states the stake, the opponent or the opponent's Power they agreed to. createBattle lets
    // the MATCHMAKER key choose all three, so a stolen key can pair a Power-3 player who
    // queued for Low against the thief's own 3x Apex team at the 50,000 stake; this route then
    // built approve + deposit for 52,500 CLAW from the ON-CHAIN stake, and the reference agent
    // signed it blindly. Until the contract binds consent itself, this is where it is bound:
    // calldata is only built when the battle on-chain IS the match this server made for the
    // caller — same two players, the stake of the bracket they queued for, the Powers the
    // matchmaker recorded. Anything else is refused, loudly.
    const row = await db.query.battles.findFirst({ where: eq(battles.battleId, id) });
    const mismatch = depositConsentMismatch(address, battle, row);
    if (mismatch) {
      log.error({ battleId, address, mismatch }, 'deposit_refused_battle_is_not_the_match_we_made');
      throw new ApiError(
        'BATTLE_PHASE_ERROR',
        `This on-chain battle is not the match this server made for you (${mismatch}). Do not deposit. If you did not expect this, report it.`,
      );
    }

    const antiGrief = (battle.stakeAmount * ANTI_GRIEF_DEPOSIT_BPS) / 10000n;
    const totalDeposit = battle.stakeAmount + antiGrief;

    const approveCalldata = buildCalldata(
      addresses.clawToken,
      ClawTokenAbi as any,
      'approve',
      [addresses.battleArena, totalDeposit],
    );

    const depositCalldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'deposit',
      [id],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${totalDeposit} $CLAW (stake + 5% anti-grief)`, calldata: approveCalldata },
        { description: 'Deposit stake for battle', calldata: depositCalldata },
      ),
      preview: serializeBigInts({
        battleId: id,
        stakeAmount: battle.stakeAmount,
        antiGriefDeposit: antiGrief,
        totalDeposit,
      }),
    });
  }),
);

battleWriteRoutes.post(
  '/:battleId/commit-team',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();
    const body = await c.req.json<{ commitHash: string }>();

    if (!body.commitHash) {
      throw new ApiError('INVALID_INPUT', 'commitHash required');
    }

    const calldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'commitTeam',
      [BigInt(battleId), body.commitHash],
    );

    return c.json(singleStep('Commit team composition hash', calldata));
  }),
);

// F5-01: team reveal is atomic and RESOLVER-submitted. Players NO LONGER reveal on-chain
// themselves (the old per-player revealTeam leaked the first revealer's composition and let
// the second mover dodge). Instead each player POSTs their salt here; the API verifies it
// against the on-chain commit and stores it. Once BOTH salts are in, the engine submits a
// single revealTeams(...) for both teams via the operator key (nothing leaks on-chain until
// both are bound in one tx). No calldata is returned — the player signs nothing to reveal.
battleWriteRoutes.post(
  '/:battleId/reveal-team',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();
    const { battleId } = c.req.param();
    const body = await c.req.json<{ teamId: string; salt: string }>();

    if (!body.teamId || !body.salt) {
      throw new ApiError('INVALID_INPUT', 'teamId and salt required');
    }

    const id = BigInt(battleId);
    const battle = await readBattle(id);

    // Must be a participant, and the battle must be in the TeamReveal phase.
    const isPlayerA = address === battle.playerA.toLowerCase();
    const isPlayerB = address === battle.playerB.toLowerCase();
    if (!isPlayerA && !isPlayerB) {
      throw new ApiError('UNAUTHORIZED', 'Not a participant in this battle');
    }
    if (battle.phase !== BattlePhase.TeamReveal) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'Battle is not in the team-reveal phase');
    }

    // Fail fast: verify the salt+teamId against this player's on-chain commit, so a bad
    // reveal is rejected here instead of reverting the engine's revealTeams tx later. The
    // commit hash binds (battleId, player, teamId, salt), so a match authenticates all three.
    const teamId = BigInt(body.teamId);
    const salt = body.salt as `0x${string}`;
    const expected = teamCommitHash(id, address as `0x${string}`, teamId, salt);
    const onChainCommit = isPlayerA ? battle.teamCommitA : battle.teamCommitB;
    if (expected.toLowerCase() !== String(onChainCommit).toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Salt/teamId do not match the committed team hash');
    }

    // D-17 (audit 2026-09): the revealed team must be the team this player QUEUED with.
    // On-chain, createBattle binds only each side's Power (3-9) and commitTeam takes an
    // opaque hash, so nothing there ties the commit to the queued team. BattleCreated
    // publishes both addresses and Powers before anyone deposits, and a team's Power can
    // never change while it is assembled — so a single-team opponent's exact line-up is
    // usually readable from public chain data. A player holding several equal-Power teams
    // could therefore queue with one, work out the opponent's composition, and commit the
    // best counter instead. Reveals only ever reach the chain through this route (F5-01:
    // resolver-submitted), so refusing here closes it: the counter-picker's commit can
    // never be opened, the reveal window lapses, and the battle mutually cancels with full
    // refunds — they learn nothing and gain nothing.
    // Fail closed when no queued team is on record (the indexer's fallback row for a battle
    // whose matchmaker write never landed): an unverifiable team is not revealed.
    const queuedRow = await db.query.battles.findFirst({ where: eq(battles.battleId, id) });
    const queuedTeam = isPlayerA ? queuedRow?.queuedTeamA : queuedRow?.queuedTeamB;
    if (queuedTeam === null || queuedTeam === undefined) {
      throw new ApiError(
        'BATTLE_PHASE_ERROR',
        'No queued team is on record for this battle, so a reveal cannot be verified. The battle will cancel with full refunds when the reveal window ends.',
      );
    }
    if (BigInt(queuedTeam) !== teamId) {
      throw new ApiError('INVALID_INPUT', 'teamId is not the team you queued with for this battle');
    }

    // Persist the revealed teamId (teamA/teamB are 0 until reveal) plus the salt (transient —
    // cleared once revealTeams confirms). The engine's RevealWatcher reads both to submit.
    await db
      .update(battles)
      .set(isPlayerA ? { teamA: teamId, revealSaltA: salt } : { teamB: teamId, revealSaltB: salt })
      .where(eq(battles.battleId, id));

    const row = await db.query.battles.findFirst({ where: eq(battles.battleId, id) });
    const bothIn = Boolean(row?.revealSaltA) && Boolean(row?.revealSaltB);

    return c.json({
      status: bothIn ? 'both_revealed' : 'waiting_for_opponent',
      message: bothIn
        ? 'Both teams revealed — the battle will begin shortly.'
        : 'Salt received. Waiting for your opponent to reveal.',
    });
  }),
);

// D-06 (audit 2026-09): the dispute — the "bonded veto" the whole trust model rests on — had no
// route. disputeBattle existed only on-chain: the web app had no button and the API built no
// calldata, so a human could not contest a settlement at all and an agent had to hand-roll
// the ABI call. A veto nobody can reach is not a veto.
//
// Any participant may dispute while the battle is AwaitingFinalize and the chain clock is at
// or before payoutDeadline. The bond (10% of the bracket stake) is refunded if the admin
// changes the outcome in ANY respect and slashed if the result stands; 5 disputes per address
// per rolling 24 h.
battleWriteRoutes.post(
  '/:battleId/dispute',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();
    const { battleId } = c.req.param();
    const id = BigInt(battleId);
    const body = (await c.req.json().catch(() => ({}))) as { evidence?: string };

    const battle = await readBattle(id);
    if (address !== battle.playerA.toLowerCase() && address !== battle.playerB.toLowerCase()) {
      throw new ApiError('UNAUTHORIZED', 'Only a participant can dispute a battle');
    }
    if (battle.phase !== BattlePhase.AwaitingFinalize) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'A battle can only be disputed while its result is awaiting finalization');
    }
    if (battle.disputed) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'This battle is already disputed and is waiting for the admin to resolve it');
    }
    const now = await readChainTime();
    if (now > battle.payoutDeadline) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'The dispute window for this battle has closed');
    }

    // Free-text evidence for the admin (what you saw, what is wrong), stored in the
    // BattleDisputed event. Bounded: it is calldata the disputer pays for.
    const note = (body.evidence ?? '').slice(0, 512);
    const evidence = `0x${Buffer.from(note, 'utf8').toString('hex')}`;
    const bond = await readDisputeBond(battle.stakeAmount);

    const approveCalldata = buildCalldata(addresses.clawToken, ClawTokenAbi as any, 'approve', [addresses.battleArena, bond]);
    const disputeCalldata = buildCalldata(addresses.battleArena, BattleArenaAbi as any, 'disputeBattle', [id, evidence]);

    log.warn({ battleId, address, proposedWinner: battle.proposedWinner }, 'dispute_calldata_requested');
    return c.json({
      ...multiStep(
        { description: `Approve the ${bond / 10n ** 18n} $CLAW dispute bond`, calldata: approveCalldata },
        { description: 'Dispute the proposed battle result', calldata: disputeCalldata },
      ),
      preview: serializeBigInts({
        battleId: id,
        bond,
        proposedWinner: battle.proposedWinner,
        payoutDeadline: battle.payoutDeadline,
        secondsLeft: battle.payoutDeadline - now,
        terms:
          'The bond is returned if the admin changes the result in any respect (winner, damage or battle hashes) and is slashed if the result stands. Limit: 5 disputes per address per 24 hours.',
      }),
    });
  }),
);

/** X13: handleTimeout calldata. The contract's `handleTimeout(battleId)` is
 *  permissionless once the phase's deadline has elapsed (BattleArena.sol:727).
 *  It routes to the right cleanup path per phase:
 *    - Deposit / TeamCommit / TeamReveal → cancel + refund stakes.
 *    - Active → past ACTIVE_WINDOW: mutual cancel with full refunds (V3).
 *    - AwaitingFinalize (undisputed) → finalize payout.
 *  The frontend shows a button when chain.phase has elapsed `phaseDeadline`
 *  (or `payoutDeadline` for AwaitingFinalize); auth here is for telemetry +
 *  rate limit, not access control. Anyone can call on chain. */
battleWriteRoutes.post(
  '/:battleId/handle-timeout',
  walletAuth,
  catchErrors(async (c) => {
    const { battleId } = c.req.param();

    const calldata = buildCalldata(
      addresses.battleArena,
      BattleArenaAbi as any,
      'handleTimeout',
      [BigInt(battleId)],
    );

    return c.json(singleStep('Handle timeout (cancel / finalize stuck battle)', calldata));
  }),
);
