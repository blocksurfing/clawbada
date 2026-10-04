/**
 * POST endpoints for battle actions — calldata builders. The API never sends
 * tx itself; it returns calldata for the agent (or wallet) to sign and broadcast.
 *
 * POST /api/game/combat/:battleId/deposit       — approve + deposit(stake consent, team commit)
 * POST /api/game/combat/:battleId/reveal-team   — submit team-reveal salt (F5-01:
 *                                                   server-verified, engine submits the
 *                                                   atomic revealTeams — no calldata)
 * POST /api/game/combat/:battleId/open-commit   — openOwnCommit calldata, only after the
 *                                                   resolver reported your commit unopenable (D-14)
 * POST /api/game/combat/:battleId/handle-timeout — permissionless timeout calldata
 *
 * There is no dispute route: player disputes were removed (owner decision 2026-10-01). The
 * engine's watchdog replays every result during its review window and freezes any it cannot
 * reproduce; the Safe resolves frozen battles, or after 72 h anyone expires them.
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
import { ANTI_GRIEF_DEPOSIT_BPS, BattlePhase, LAUNCH_STAKES, STAKE_BRACKET_LABELS } from '@clawbada/game-logic';
import { db, battles } from '@clawbada/db';
import { log as baseLog } from '../../../logger';
import { walletAuth } from '../../../middleware/auth';
import { catchErrors, ApiError } from '../../../lib/errors';
import { readBattle, serializeBigInts } from '../../../lib/chain';
import { buildCalldata, singleStep, multiStep } from '../../../lib/calldata';

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

const log = baseLog.child({ module: 'combat:writes' });

export const battleWriteRoutes = new Hono();

/** D-08 / D-E: null when the on-chain battle is exactly the match this server made for `address`;
 *  otherwise what differs. The stake is a damped peg the contract computes at createBattle, so
 *  the check is on the BRACKET the player queued for (the matchmaker key names it and cannot
 *  inflate it) plus a ceiling: no bracket's stake ever exceeds its launch value. Pure, so every
 *  branch is unit-tested. */
export function depositConsentMismatch(
  address: string,
  onChain: { playerA: string; playerB: string; stakeAmount: bigint; bracket?: number | bigint; powerA?: number | bigint; powerB?: number | bigint },
  row: { playerA: string; playerB: string; stakeBracket: number; powerA: number | null; powerB: number | null; fromMatchmaker?: boolean | null } | undefined,
): string | null {
  if (!row) return 'no match on record';
  if (row.fromMatchmaker === false) return 'the battle was not created by this matchmaker';
  const a = onChain.playerA.toLowerCase();
  const b = onChain.playerB.toLowerCase();
  if (address !== a && address !== b) return 'you are not a participant';
  if (row.playerA.toLowerCase() !== a || row.playerB.toLowerCase() !== b) return 'the players differ from the match on record';
  const launch = LAUNCH_STAKES[row.stakeBracket];
  if (launch === undefined) return 'the match record names no valid bracket';
  const label = STAKE_BRACKET_LABELS[row.stakeBracket];
  if (onChain.bracket !== undefined && Number(onChain.bracket) !== row.stakeBracket) {
    return `the bracket differs from the one you queued for (on-chain bracket ${Number(onChain.bracket)} at ${onChain.stakeAmount / 10n ** 18n} CLAW, you queued ${label})`;
  }
  if (onChain.stakeAmount > launch * 10n ** 18n) {
    return `the stake differs from the bracket you queued for (on-chain ${onChain.stakeAmount / 10n ** 18n} CLAW, above the ${label} bracket's launch value of ${launch} CLAW)`;
  }
  if (onChain.stakeAmount <= 0n) return 'the stake on-chain is zero';
  if (row.powerA !== null && onChain.powerA !== undefined && Number(onChain.powerA) !== row.powerA) return 'Team Power A differs from the match on record';
  if (row.powerB !== null && onChain.powerB !== undefined && Number(onChain.powerB) !== row.powerB) return 'Team Power B differs from the match on record';
  return null;
}

/** D-08 / D-E: what the player consents to in `deposit(battleId, expectedStake, maxOpponentPower, commit)`:
 *  the stake the contract bound for the bracket they queued for — read from the battle, AFTER
 *  `depositConsentMismatch` has checked that the battle is the match on record (same players,
 *  same bracket, at or below the bracket's launch value) — and the opponent Team Power they were
 *  shown when matched, from THIS server's record. The contract reverts `ConsentMismatch` if the
 *  on-chain battle differs, so a misbehaving matchmaker key cannot spring a bigger stake or a
 *  stronger opponent on a depositor. Null if the record is incomplete. */
export function depositConsent(
  address: string,
  onChain: { stakeAmount: bigint },
  row: { playerA: string; playerB: string; stakeBracket: number; powerA: number | null; powerB: number | null },
): { expectedStake: bigint; maxOpponentPower: number } | null {
  if (LAUNCH_STAKES[row.stakeBracket] === undefined) return null;
  if (onChain.stakeAmount <= 0n) return null;
  const isA = row.playerA.toLowerCase() === address;
  const isB = row.playerB.toLowerCase() === address;
  if (!isA && !isB) return null;
  const opponentPower = isA ? row.powerB : row.powerA;
  if (opponentPower === null || opponentPower === undefined) return null;
  return { expectedStake: onChain.stakeAmount, maxOpponentPower: opponentPower };
}

battleWriteRoutes.post(
  '/:battleId/deposit',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();
    const { battleId } = c.req.param();
    const id = BigInt(battleId);
    // D-13: the team commit rides in the deposit. Either send the hash you built yourself
    // (keccak256(abi.encodePacked(battleId, you, teamId, salt)) — keep the salt for /reveal-team),
    // or send teamId + salt and the server builds it (and keeps the salt for the reveal, so you
    // do not have to race the 20 s reveal window).
    const body = (await c.req.json().catch(() => ({}))) as { commitHash?: string; teamId?: string; salt?: string };

    const battle = await readBattle(id);
    if (battle.phase !== BattlePhase.Deposit) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'Battle is not in the deposit phase');
    }

    // D-08 (audit 2026-09): calldata is only built when the battle on-chain IS the match this
    // server made for the caller — same two players, the bracket they queued for (D-E: the
    // amount is the peg's, bound by the contract), the Powers the matchmaker recorded. The contract now also binds consent itself (the
    // expected stake + max opponent Power ride in the deposit), so this is defence in depth and
    // a clear error message instead of a ConsentMismatch revert.
    const row = await db.query.battles.findFirst({ where: eq(battles.battleId, id) });
    const mismatch = depositConsentMismatch(address, battle, row);
    if (mismatch) {
      log.error({ battleId, address, mismatch }, 'deposit_refused_battle_is_not_the_match_we_made');
      throw new ApiError(
        'BATTLE_PHASE_ERROR',
        `This on-chain battle is not the match this server made for you (${mismatch}). Do not deposit. If you did not expect this, report it.`,
      );
    }
    const consent = depositConsent(address, battle, row!);
    if (!consent) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'The match record is missing the stake or opponent Power you agreed to, so no deposit can be built.');
    }

    let commitHash: `0x${string}`;
    let preparedReveal: { teamId: bigint; salt: `0x${string}` } | null = null;
    if (body.teamId !== undefined || body.salt !== undefined) {
      if (!body.teamId || !body.salt || !/^\d+$/.test(body.teamId) || !BYTES32_RE.test(body.salt)) {
        throw new ApiError('INVALID_INPUT', 'teamId (decimal) and salt (bytes32 hex) are both required to build the commit');
      }
      const teamId = BigInt(body.teamId);
      // D-17: commit only the team you queued with — it is the only one the reveal will open.
      const queued = address === row!.playerA.toLowerCase() ? row!.queuedTeamA : row!.queuedTeamB;
      if (queued === null || queued === undefined || BigInt(queued) !== teamId) {
        throw new ApiError('INVALID_INPUT', 'teamId is not the team you queued with for this battle');
      }
      preparedReveal = { teamId, salt: body.salt as `0x${string}` };
      commitHash = teamCommitHash(id, address as `0x${string}`, teamId, preparedReveal.salt);
      if (body.commitHash && body.commitHash.toLowerCase() !== commitHash.toLowerCase()) {
        throw new ApiError('INVALID_INPUT', 'commitHash does not match teamId + salt');
      }
    } else if (body.commitHash && BYTES32_RE.test(body.commitHash) && body.commitHash.toLowerCase() !== ZERO_BYTES32) {
      commitHash = body.commitHash as `0x${string}`;
    } else {
      throw new ApiError('INVALID_INPUT', 'commitHash (non-zero bytes32) or teamId + salt required: the team commit is part of the deposit');
    }

    let revealNote: string | null = null;
    if (preparedReveal) {
      // The engine's reveal watcher checks the stored salt against the commit that actually
      // lands on-chain before it uses it. A stale or wrong one is NOT free: the watcher reports
      // it (D-14) and the player forfeits 5% unless they open the commit themselves within the
      // grace. So once this player's deposit has landed — the commit on-chain is final — a new
      // salt replaces the stored one only if it opens that commit (an idempotent re-send); a
      // retry that minted a fresh salt used to overwrite the good one and get the player reported.
      const isA = address === row!.playerA.toLowerCase();
      const landed = isA ? battle.depositA : battle.depositB;
      const onChainCommit = String(isA ? battle.teamCommitA : battle.teamCommitB).toLowerCase();
      if (landed && commitHash.toLowerCase() !== onChainCommit) {
        revealNote = 'Your deposit is already on-chain and this salt does not open the commit it carries, so the salt already on record was kept. Reveal with the salt you deposited with.';
        log.warn({ battleId, address }, 'deposit_salt_kept_new_one_does_not_open_commit');
        preparedReveal = null;
      } else {
        await db
          .update(battles)
          .set(isA ? { teamA: preparedReveal.teamId, revealSaltA: preparedReveal.salt } : { teamB: preparedReveal.teamId, revealSaltB: preparedReveal.salt })
          .where(eq(battles.battleId, id));
      }
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
      [id, consent.expectedStake, consent.maxOpponentPower, commitHash],
    );

    return c.json({
      ...multiStep(
        { description: `Approve ${totalDeposit} $CLAW (stake + 5% anti-grief)`, calldata: approveCalldata },
        { description: 'Deposit stake and commit your team', calldata: depositCalldata },
      ),
      preview: serializeBigInts({
        battleId: id,
        stakeAmount: battle.stakeAmount,
        antiGriefDeposit: antiGrief,
        totalDeposit,
        commitHash,
        consent: { expectedStake: consent.expectedStake, maxOpponentPower: consent.maxOpponentPower },
        revealPrepared: preparedReveal !== null,
        ...(revealNote ? { revealNote } : {}),
      }),
    });
  }),
);

/** Review 2026-10-03: a reveal the SERVER refuses leaves the player with no usable salt on
 *  record through no failure of their own client. Note why on the battle row so the engine's
 *  reveal watcher does not report them (an accusation costs 5% if they never open the commit):
 *  the window lapses into the no-fault mutual cancel instead. A reveal the server accepts
 *  clears it. */
async function recordRevealRefusal(id: bigint, isPlayerA: boolean, reason: string): Promise<void> {
  await db
    .update(battles)
    .set(isPlayerA ? { revealRefusedA: reason } : { revealRefusedB: reason })
    .where(eq(battles.battleId, id));
}

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
    // On-chain, createBattle binds only each side's Power (3-9) and the deposit's team commit is an
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
      if (queuedRow) await recordRevealRefusal(id, isPlayerA, 'no queued team on record');
      throw new ApiError(
        'BATTLE_PHASE_ERROR',
        'No queued team is on record for this battle, so a reveal cannot be verified. The battle will cancel with full refunds when the reveal window ends.',
      );
    }
    if (BigInt(queuedTeam) !== teamId) {
      await recordRevealRefusal(id, isPlayerA, `teamId ${teamId} is not the queued team`);
      throw new ApiError('INVALID_INPUT', 'teamId is not the team you queued with for this battle');
    }

    // Persist the revealed teamId (teamA/teamB are 0 until reveal) plus the salt (transient —
    // cleared once revealTeams confirms). The engine's RevealWatcher reads both to submit. An
    // accepted reveal supersedes any refusal noted for this side.
    await db
      .update(battles)
      .set(isPlayerA ? { teamA: teamId, revealSaltA: salt, revealRefusedA: null } : { teamB: teamId, revealSaltB: salt, revealRefusedB: null })
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

// D-14: the resolver reported that your commit does not open with the salt it holds (or it
// never got your salt). You have REVEAL_GRACE (2 min) to open it yourself, or you forfeit your
// 5% anti-grief deposit when the reveal window lapses. Opening only binds what you already
// committed; the resolver then reveals both teams together as usual.
battleWriteRoutes.post(
  '/:battleId/open-commit',
  walletAuth,
  catchErrors(async (c) => {
    const address = (c.get('address') as string).toLowerCase();
    const { battleId } = c.req.param();
    const id = BigInt(battleId);
    const body = (await c.req.json().catch(() => ({}))) as { teamId?: string; salt?: string };
    if (!body.teamId || !body.salt || !/^\d+$/.test(body.teamId) || !BYTES32_RE.test(body.salt)) {
      throw new ApiError('INVALID_INPUT', 'teamId (decimal) and salt (bytes32 hex) required');
    }
    const battle = await readBattle(id);
    const isA = address === battle.playerA.toLowerCase();
    const isB = address === battle.playerB.toLowerCase();
    if (!isA && !isB) throw new ApiError('UNAUTHORIZED', 'Not a participant in this battle');
    if (battle.phase !== BattlePhase.TeamReveal) throw new ApiError('BATTLE_PHASE_ERROR', 'Battle is not in the team-reveal phase');
    if (!(isA ? battle.accusedA : battle.accusedB)) {
      throw new ApiError('BATTLE_PHASE_ERROR', 'Your commit has not been reported unopenable; POST /reveal-team instead');
    }
    const teamId = BigInt(body.teamId);
    const salt = body.salt as `0x${string}`;
    const onChainCommit = isA ? battle.teamCommitA : battle.teamCommitB;
    if (teamCommitHash(id, address as `0x${string}`, teamId, salt).toLowerCase() !== String(onChainCommit).toLowerCase()) {
      throw new ApiError('INVALID_INPUT', 'Salt/teamId do not match your committed team hash');
    }
    const calldata = buildCalldata(addresses.battleArena, BattleArenaAbi as any, 'openOwnCommit', [id, teamId, salt]);
    return c.json(singleStep('Open your own team commit (clears the reveal-failure report)', calldata));
  }),
);

/** X13: handleTimeout calldata. The contract's `handleTimeout(battleId)` is
 *  permissionless once the phase's deadline has elapsed (BattleArena.sol:727).
 *  It routes to the right cleanup path per phase:
 *    - Deposit → cancel + refund stakes.
 *    - TeamReveal → mutual cancel; a player reported for an unopenable commit who did not
 *      open it forfeits their 5% (D-14).
 *    - Active → past ACTIVE_WINDOW: mutual cancel with full refunds (V3).
 *    - AwaitingFinalize (in review) → past the review window: pay out.
 *    - Frozen → past frozenAt + 72 h: expire (stakes burned, both players paid back from the
 *      refund reserve; returned directly if the reserve is short).
 *  The frontend shows a button when the relevant deadline has passed; auth here is for
 *  telemetry + rate limit, not access control. Anyone can call on chain. */
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

    return c.json(singleStep('Handle timeout (cancel / pay out / expire a stuck battle)', calldata));
  }),
);
