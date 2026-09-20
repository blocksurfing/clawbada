import { BreedingLabAbi, LobsterNFTAbi } from '@clawbada/chain';
import { waitFor } from '../lib/wait';
import type { Checks } from '../lib/checks';
import type { Stack } from './00-infra';
import type { Players, Player } from './10-onboarding';

/** What the breed cost and who paid, so the battle money math can set it aside. The fee goes
 *  through Treasury like every other: 85 % burned, 15 % to the dev wallet. */
export interface BreedingOutcome { player: Player; cost: bigint }

/**
 * A breed, end to end, through the public API — the path that was broken (the API encoded a
 * contract function that does not exist) and the keeper that did not exist (audit D-21).
 *
 * The player only sends `requestBreed`. The offspring must then appear WITHOUT the player doing
 * anything else: the engine's BreedFinalizeWatcher has to notice the request on a live chain and
 * mint it inside the 256-block window.
 */
export async function breedingPhase(stack: Stack, players: Players, checks: Checks): Promise<BreedingOutcome> {
  const { chain, anvil } = stack;
  const player = players.a;
  const lab = stack.deployment.contracts.BreedingLab as `0x${string}`;
  const [parentA, parentB] = player.faucetLobsters.slice(3, 5); // the two faucet lobsters not on the team

  const requestId = await chain.read<bigint>(lab, BreedingLabAbi, 'nextRequestId');
  const balanceBefore = await chain.balance(player.agent.address);
  const res = await player.agent.post('/api/game/breeding/breed', { parentA: parentA.toString(), parentB: parentB.toString() });
  checks.eq(res.steps.length, 2, 'breed: the API returns approve + requestBreed');
  checks.eq(String(res.finalize?.by), 'keeper', 'breed: the API says a keeper finalizes');
  await player.agent.executeSteps(res.steps);
  const cost = balanceBefore - (await chain.balance(player.agent.address));
  checks.eq(cost, 1_000n * 10n ** 18n, 'breed: two fresh gen-0 parents cost 500 + 500 CLAW');
  const outcome: BreedingOutcome = { player, cost };

  const req = await chain.read<{ requester: string; finalized: boolean; targetBlock: bigint }>(lab, BreedingLabAbi, 'getBreedRequest', [requestId]);
  checks.eq(String(req.requester).toLowerCase(), player.agent.address.toLowerCase(), `breed request #${requestId} recorded on-chain`);
  checks.eq(Boolean(req.finalized), false, 'breed request starts unfinalized — the player sends nothing further');

  // Anvil only mines when a transaction arrives; the target block is two blocks ahead.
  for (let i = 0; i < 4; i++) await anvil.mine();

  const finalized = await waitFor(
    async () => (await chain.read<{ finalized: boolean }>(lab, BreedingLabAbi, 'getBreedRequest', [requestId])).finalized === true,
    { timeoutMs: 60_000, label: 'keeper finalizes the breed' },
  ).then(() => true, () => false);
  checks.check(finalized, 'the engine keeper finalized the breed on its own (D-21)');
  if (!finalized) return outcome;

  const nft = stack.deployment.contracts.LobsterNFT as `0x${string}`;
  const offspringId = (await chain.read<bigint>(nft, LobsterNFTAbi, 'nextTokenId')) - 1n;
  const owner = await chain.read<string>(nft, LobsterNFTAbi, 'ownerOf', [offspringId]);
  checks.eq(owner.toLowerCase(), player.agent.address.toLowerCase(), `offspring #${offspringId} minted to the breeder, not the keeper`);
  const offspring = await chain.getLobster(offspringId);
  checks.eq(Number(offspring.evolutionTier), 0, 'offspring is Base tier');
  checks.eq(Number(offspring.generation), 1, 'offspring is generation 1');
  checks.eq(Boolean(offspring.soulbound), false, 'offspring of soulbound parents is tradeable');
  return outcome;
}
