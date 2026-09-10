import { join } from 'node:path';
import { startAnvil, type AnvilHandle } from '../lib/anvil';
import { createRunDb, type RunDb } from '../lib/db';
import { deployContracts, type Deployment } from '../lib/forge';
import { startDrandStub, type DrandStub } from '../lib/drand-stub';
import { spawnService, waitForHttp, waitForLog, type ServiceHandle } from '../lib/procs';
import { apiEnv, engineEnv, indexerEnv, KEYS, type StackConfig } from '../lib/env';
import { Chain } from '../lib/chain';
import type { Checks } from '../lib/checks';
import type { Flags } from '../run';

export interface Stack {
  repoRoot: string; runDir: string; flags: Flags;
  anvil: AnvilHandle; db: RunDb; deployment: Deployment; chain: Chain;
  drand: DrandStub | null;
  api: ServiceHandle; engine: ServiceHandle; indexer: ServiceHandle;
  apiUrl: string; wsUrl: string;
  stop(): Promise<void>;
}

export async function infraPhase(o: { repoRoot: string; runDir: string; flags: Flags; checks: Checks }): Promise<Stack> {
  const { repoRoot, runDir, flags, checks } = o;
  const t0 = Date.now();

  // 1. Chain
  const anvil = await startAnvil(flags.anvilPort, join(runDir, 'anvil.log'));
  checks.check(true, `anvil up on ${anvil.rpcUrl} (chain id 84532)`);

  // 2. Database
  const db = await createRunDb(repoRoot, runDir.split('/').pop()!);
  checks.check(true, `database ${db.name} created + migrated`);

  // 3. Contracts
  const { deployment, restore } = await deployContracts({ repoRoot, rpcUrl: anvil.rpcUrl, deployerKey: KEYS.deployer.key, devWallet: KEYS.devWallet.address, logDir: runDir });
  const chain = new Chain(anvil.rpcUrl, deployment);
  checks.check(true, `contracts deployed + configured (BattleArena ${deployment.contracts.BattleArena.slice(0, 10)}…)`);
  const boostAnchorTs = await chain.seasonStart();
  checks.check(boostAnchorTs > 0n, 'season 1 started by Configure', `startTime ${boostAnchorTs}`);

  // 4. drand
  const drand = flags.liveDrand ? null : startDrandStub(flags.apiPort + 100);
  const drandUrl = drand ? drand.url : 'https://api.drand.sh';

  // 5. Services
  const cfg: StackConfig = { rpcUrl: anvil.rpcUrl, databaseUrl: db.url, drandUrl, apiPort: flags.apiPort, deployment, boostAnchorTs };
  const spawnApp = (name: 'api' | 'engine' | 'indexer', env: Record<string, string>) =>
    spawnService({ name, cwd: join(repoRoot, 'apps', name), cmd: ['bun', 'run', 'src/index.ts'], env, runDir, verbose: flags.verbose });
  const indexer = await spawnApp('indexer', indexerEnv(cfg));
  await waitForLog(indexer, 'Clawbada Indexer ready', 60_000);
  const engine = await spawnApp('engine', engineEnv(cfg));
  await waitForLog(engine, 'Clawbada Engine ready', 60_000);
  const api = await spawnApp('api', apiEnv(cfg));
  const apiUrl = `http://127.0.0.1:${flags.apiPort}`;
  await waitForHttp(api, `${apiUrl}/health`, 60_000);
  checks.check(true, `indexer, engine, api ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const stack: Stack = {
    repoRoot, runDir, flags, anvil, db, deployment, chain, drand, api, engine, indexer, apiUrl,
    wsUrl: `ws://127.0.0.1:${flags.apiPort}/ws`,
    async stop() {
      await Promise.all([api.stop(), engine.stop(), indexer.stop()]);
      drand?.stop();
      await anvil.stop();
      await db.drop().catch((e) => console.error('db drop failed', e));
      restore();
    },
  };
  return stack;
}
