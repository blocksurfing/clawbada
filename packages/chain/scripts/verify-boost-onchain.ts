/**
 * On-chain verification of the boost operator path against a LOCAL Anvil node
 * (`anvil --chain-id 84532`, contracts deployed + configured with the anvil dev key).
 *
 * Exercises, through the REAL engine handlers and the checked-in ABIs:
 *   grant roles -> mint + evolve 3 lobsters -> createTeam
 *   set_team_boosts handler (simulate -> write -> recordTxHash -> receipt)
 *   activate_boost_epoch handler; re-activation classified as already done
 *   InvalidBoostEpoch / BoostTooHigh classified as dead (no retry)
 *   startExpedition pays base x 1.5 x tierWeight and emits boostBps; glide demand is bps-scaled
 *
 * Run (see docs/runbooks/boost-epoch.md):
 *   CHAIN_ENV=testnet BASE_SEPOLIA_RPC_URL=http://127.0.0.1:8545 OPERATOR_PRIVATE_KEY=<anvil key 0> \
 *   MINING_POOL_ADDRESS=... LOBSTER_NFT_ADDRESS=... TEAM_MANAGER_ADDRESS=... CLAW_TOKEN_ADDRESS=... \
 *   bun run verify:boost-onchain
 */
import { createPublicClient, createWalletClient, http, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { LobsterNFTAbi, TeamManagerAbi, MiningPoolAbi } from '../src/abis';
import { setTeamBoostsHandler } from '../../../apps/engine/src/operator/jobs/set-team-boosts';
import { activateBoostEpochHandler } from '../../../apps/engine/src/operator/jobs/activate-boost-epoch';
import type { JobContext, JobResult } from '../../../apps/engine/src/operator/types';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) : ''}`);
  }
}

const rpc = process.env.BASE_SEPOLIA_RPC_URL!;
const key = process.env.OPERATOR_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
const nft = process.env.LOBSTER_NFT_ADDRESS as `0x${string}`;
const tm = process.env.TEAM_MANAGER_ADDRESS as `0x${string}`;
const pool = process.env.MINING_POOL_ADDRESS as `0x${string}`;

async function tx(address: `0x${string}`, abi: any, functionName: string, args: any[]) {
  const { request, result } = await pub.simulateContract({ address, abi, functionName, args, account });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, receipt, result };
}
const read = (address: `0x${string}`, abi: any, functionName: string, args: any[] = []) =>
  pub.readContract({ address, abi, functionName, args });

/** Valid DNA: class 3, breed type 5, all 18 alleles = 0x37 (affinity 3, variant 7). */
function dna(): bigint {
  let v = (3n << 252n) | (5n << 244n);
  for (let i = 0n; i < 18n; i++) v |= 0x37n << (96n + 8n * i);
  return v;
}

function ctx(jobType: string, recorded: string[]): JobContext {
  return {
    jobId: 1n,
    jobType,
    attempts: 1,
    priorTxHash: null,
    recordTxHash: async (hash: string) => {
      recorded.push(hash);
    },
  };
}

async function main() {
  console.log(`chain ${await pub.getChainId()} signer ${account.address}`);
  console.log('\n[1] roles, lobsters, team');
  const minterRole = (await read(nft, LobsterNFTAbi, 'MINTER_ROLE')) as `0x${string}`;
  const evolverRole = (await read(nft, LobsterNFTAbi, 'EVOLVER_ROLE')) as `0x${string}`;
  await tx(nft, LobsterNFTAbi, 'grantRole', [minterRole, account.address]);
  await tx(nft, LobsterNFTAbi, 'grantRole', [evolverRole, account.address]);
  const ids: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    const { result } = await tx(nft, LobsterNFTAbi, 'mint', [account.address, dna(), false]);
    ids.push(result as bigint);
    await tx(nft, LobsterNFTAbi, 'setEvolutionTier', [result, 1]);
  }
  check('minted 3 Evolved lobsters', ids.length === 3 && (await read(nft, LobsterNFTAbi, 'getEvolutionTier', [ids[0]])) === 1, ids);
  const { result: teamId } = await tx(tm, TeamManagerAbi, 'createTeam', [[ids[0], ids[1], ids[2]]]);
  check('team created', typeof teamId === 'bigint' && teamId > 0n, teamId);

  console.log('\n[2] operator handlers against the contract');
  const epoch0 = Number(await read(pool, MiningPoolAbi, 'currentBoostEpoch'));
  check('currentBoostEpoch starts at 0', epoch0 === 0, epoch0);

  const recordedSet: string[] = [];
  const r1: JobResult = await setTeamBoostsHandler(
    { epoch: 1, entries: [{ teamId: String(teamId), bps: 5000, power: 3 }] },
    ctx('set_team_boosts', recordedSet),
  );
  check('set_team_boosts ok with txHash, recordTxHash called once', r1.ok && !!(r1 as any).txHash && recordedSet.length === 1 && recordedSet[0] === (r1 as any).txHash, r1);
  const staged = (await read(pool, MiningPoolAbi, 'getTeamBoost', [teamId])) as any;
  check('entry staged for epoch 1 (not live yet: teamBoostBps == 0)', Number(staged.epoch ?? staged[0]) === 1 && Number(await read(pool, MiningPoolAbi, 'teamBoostBps', [teamId, 3])) === 0, staged);

  const recordedAct: string[] = [];
  const r2 = await activateBoostEpochHandler({ epoch: 1 }, ctx('activate_boost_epoch', recordedAct));
  check('activate_boost_epoch ok', r2.ok && recordedAct.length === 1, r2);
  check('currentBoostEpoch == 1', Number(await read(pool, MiningPoolAbi, 'currentBoostEpoch')) === 1);
  check('teamBoostBps(team, 3) == 5000', Number(await read(pool, MiningPoolAbi, 'teamBoostBps', [teamId, 3])) === 5000);
  check('teamBoostBps(team, 4) == 0 (power-bound)', Number(await read(pool, MiningPoolAbi, 'teamBoostBps', [teamId, 4])) === 0);

  const r3 = await activateBoostEpochHandler({ epoch: 1 }, ctx('activate_boost_epoch', []));
  check('re-activating epoch 1 is classified as already done (ok, no tx)', r3.ok === true, r3);
  const r4 = await setTeamBoostsHandler({ epoch: 3, entries: [{ teamId: String(teamId), bps: 1000, power: 3 }] }, ctx('set_team_boosts', []));
  check('set for epoch 3 (not current/next) -> dead, no retry', !r4.ok && (r4 as any).retry === 'dead', r4);
  const r5 = await setTeamBoostsHandler({ epoch: 1, entries: [{ teamId: String(teamId), bps: 6000, power: 3 }] }, ctx('set_team_boosts', []));
  check('bps 6000 -> dead (BoostTooHigh)', !r5.ok && (r5 as any).retry === 'dead', r5);
  const r6 = await setTeamBoostsHandler({ epoch: 1, entries: [{ teamId: String(teamId), bps: 4000, power: 3 }] }, ctx('set_team_boosts', []));
  check('amending the live epoch works (bps 5000 -> 4000)', r6.ok && Number(await read(pool, MiningPoolAbi, 'teamBoostBps', [teamId, 3])) === 4000, r6);

  console.log('\n[3] boosted expedition');
  const base = (await read(pool, MiningPoolAbi, 'currentBaseReward')) as bigint;
  const { receipt } = await tx(pool, MiningPoolAbi, 'startExpedition', [teamId, 1]);
  const logs = parseEventLogs({ abi: MiningPoolAbi as any, logs: receipt.logs, eventName: 'ExpeditionStarted' }) as any[];
  const ev = logs[0]?.args;
  const expected = ((base * 14_000n) / 10_000n) * 3n;
  check('ExpeditionStarted reward == base x 1.4 x 3 and boostBps == 4000', ev && ev.reward === expected && Number(ev.boostBps) === 4000, { reward: ev?.reward, expected, boostBps: ev?.boostBps });
  const cfg = (await read(pool, MiningPoolAbi, 'getSeasonConfig', [1n])) as any;
  const served = cfg.epochWeightServed ?? cfg[6];
  check('glide demand credited bps-scaled: epochWeightServed == 3 x 14000', served === 3n * 14_000n, served);
  const exp = (await read(pool, MiningPoolAbi, 'getExpedition', [1n])) as any;
  check('stored expedition reward matches', (exp.reward ?? exp[5]) === expected, exp.reward ?? exp[5]);

  console.log(`\n${failures === 0 ? 'ALL ON-CHAIN CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('on-chain verification crashed:', err);
  process.exit(2);
});
