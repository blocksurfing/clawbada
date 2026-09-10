import { PlayerAgent } from '../lib/agent';
import { KEYS } from '../lib/env';
import { WEI } from '../lib/chain';
import { sleep } from '../lib/wait';
import type { Checks } from '../lib/checks';
import type { Stack } from './00-infra';

export interface Player { agent: PlayerAgent; teamId: bigint; teamLobsters: bigint[]; faucetLobsters: bigint[] }
export interface Players { a: Player; b: Player }

/** Faucet claims for real, then fuel + CLAW from the deployer, three evolutions via the API, a team. */
export async function onboardingPhase(stack: Stack, checks: Checks): Promise<Players> {
  const { chain } = stack;
  const mk = (key: string, label: string, xff: string) => new PlayerAgent({ key, api: stack.apiUrl, ws: stack.wsUrl, chain, forwardedFor: xff, label });
  const a = mk(KEYS.playerA.key, 'A', '10.0.0.11');
  const b = mk(KEYS.playerB.key, 'B', '10.0.0.12');

  // Eligibility is an on-chain allowlist held by the deployer after Configure.
  await chain.setEligible(KEYS.deployer.key, [a.address, b.address]);
  checks.check(true, 'faucet eligibility granted to both players');

  const setup = async (p: PlayerAgent): Promise<Player> => {
    const { lobsterIds } = await p.claimFaucet();
    const claw = await chain.balance(p.address);
    checks.eq(claw, 7_000n * WEI, `${p.o.label}: 7,000 CLAW from the faucet`);
    checks.eq(lobsterIds.length, 5, `${p.o.label}: 5 faucet lobsters`);

    // Fuel: 6 plain Base lobsters from the deployer; top-up so 3 evolutions (6,000) + a Low
    // deposit (2,625) fit. The faucet's 5 soulbound lobsters are the evolution targets.
    const fuel = await chain.mintBaseLobsters(KEYS.deployer.key, p.address, 6);
    await chain.transferClaw(KEYS.deployer.key, p.address, 10_000n * WEI);
    const targets = lobsterIds.slice(0, 3);
    for (let i = 0; i < 3; i++) await p.evolve(targets[i], fuel[2 * i], fuel[2 * i + 1]);
    for (const id of targets) {
      const lob = await chain.getLobster(id);
      checks.eq(Number(lob.evolutionTier), 1, `${p.o.label}: lobster #${id} is Evolved`);
    }
    const teamId = await p.createTeam(targets);
    const team = await chain.getTeam(teamId);
    checks.eq(String(team.owner).toLowerCase(), p.address.toLowerCase(), `${p.o.label}: team #${teamId} owned`);
    return { agent: p, teamId, teamLobsters: targets, faucetLobsters: lobsterIds };
  };

  const pa = await setup(a);
  await sleep(500);
  const pb = await setup(b);
  return { a: pa, b: pb };
}
