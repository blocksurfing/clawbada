/**
 * Deploy + configure the contracts on the run's Anvil with the repo's Foundry scripts.
 * `DeployHelpers._networkName()` maps chain id 84532 to "base-sepolia", so the scripts
 * write `deployments/base-sepolia.json` at the repo root; we back up any pre-existing
 * file (a real testnet deployment) and restore it on teardown.
 */
import { spawn } from 'bun';
import { existsSync, copyFileSync, renameSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  contracts: Record<'ClawToken' | 'LobsterNFT' | 'Treasury' | 'BattleVRF' | 'TeamManager' | 'Faucet' | 'MiningPool' | 'BreedingLab' | 'EvolutionLab' | 'RepairShop' | 'Marketplace' | 'BattleArena', `0x${string}`>;
}

export interface ForgeOpts { repoRoot: string; rpcUrl: string; deployerKey: string; devWallet: string; logDir: string }

export async function deployContracts(o: ForgeOpts): Promise<{ deployment: Deployment; restore(): void }> {
  const depPath = join(o.repoRoot, 'deployments', 'base-sepolia.json');
  const backup = depPath + '.e2e-backup';
  if (existsSync(depPath)) copyFileSync(depPath, backup);

  const env = { ...process.env, DEPLOYER_PRIVATE_KEY: o.deployerKey, DEV_WALLET: o.devWallet };
  for (const script of ['Deploy', 'Configure']) {
    const proc = spawn(['forge', 'script', `contracts/script/${script}.s.sol`, '--rpc-url', o.rpcUrl, '--broadcast', '--slow'], { cwd: o.repoRoot, env, stdout: 'pipe', stderr: 'pipe' });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    await Bun.write(join(o.logDir, `forge-${script.toLowerCase()}.log`), out + '\n' + err);
    if (code !== 0) throw new Error(`forge script ${script}.s.sol failed (exit ${code}) — see ${o.logDir}/forge-${script.toLowerCase()}.log`);
  }
  const deployment = JSON.parse(readFileSync(depPath, 'utf8')) as Deployment;
  if (deployment.chainId !== 84532) throw new Error(`unexpected chainId in deployment json: ${deployment.chainId}`);

  return {
    deployment,
    restore() {
      rmSync(join(o.repoRoot, 'broadcast'), { recursive: true, force: true });
      if (existsSync(backup)) renameSync(backup, depPath);
      else rmSync(depPath, { force: true });
    },
  };
}
