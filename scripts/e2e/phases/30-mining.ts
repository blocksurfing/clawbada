import { waitFor } from '../lib/wait';
import type { Checks } from '../lib/checks';
import type { Stack } from './00-infra';
import type { Players, Player } from './10-onboarding';
import type { BattleOutcome } from './20-battle';

export interface MiningOutcome { player: Player; expeditionId: bigint; reward: bigint; balanceBefore: bigint }

const FOUR_HOURS = 4 * 60 * 60;

/** The winner's (released) team mines the Evolved tier; a 4 h warp, then the claim via the API. */
export async function miningPhase(stack: Stack, players: Players, battle: BattleOutcome, checks: Checks): Promise<MiningOutcome> {
  const { chain, anvil, db } = stack;
  const winnerIsA = battle.winner.toLowerCase() === players.a.agent.address.toLowerCase();
  const player = winnerIsA ? players.a : players.b;

  const team = await chain.getTeam(player.teamId);
  checks.eq(Boolean(team.active), false, `team #${player.teamId} released after the battle`);

  const balanceBefore = await chain.balance(player.agent.address);
  const { expeditionId, reward } = await player.agent.startExpedition(player.teamId, 1);
  checks.check(reward > 0n, `expedition #${expeditionId} reward locked at start`, `${reward / 10n ** 18n} CLAW`);

  // Not claimable yet (API reads chain time).
  let early = false;
  try { await player.agent.claimExpedition(expeditionId); } catch { early = true; }
  checks.check(early, 'claim before 4 h is refused');

  await anvil.increaseTime(FOUR_HOURS + 60);
  await player.agent.claimExpedition(expeditionId);
  const exp = await chain.getExpedition(expeditionId);
  checks.eq(Boolean(exp.claimed), true, 'expedition claimed after the 4 h warp');
  const balanceAfter = await chain.balance(player.agent.address);
  checks.eq(balanceAfter - balanceBefore, reward, 'CLAW reward minted to the miner');
  await waitFor(async () => (await db.sql`select claimed from expeditions where expedition_id = ${expeditionId.toString()}`)[0]?.claimed === true, { timeoutMs: 30_000, label: 'indexer mirrors the claim' }).then(() => checks.check(true, 'indexer mirrors the claimed expedition')).catch((e) => checks.check(false, 'indexer mirrors the claimed expedition', String(e.message)));

  return { player, expeditionId, reward, balanceBefore };
}
