import { describe, test, expect } from 'bun:test';
import { startDrandStub, STUB_ROUND, STUB_RANDOMNESS } from './drand-stub';
import { Checks } from './checks';
import { waitFor, TimeoutError } from './wait';
import { addressEnv, apiEnv, engineEnv, indexerEnv, KEYS } from './env';
import { dna } from './chain';
import type { Deployment } from './forge';

const deployment: Deployment = {
  network: 'base-sepolia', chainId: 84532, deployer: KEYS.deployer.address,
  contracts: Object.fromEntries(['ClawToken', 'LobsterNFT', 'Treasury', 'BattleVRF', 'TeamManager', 'Faucet', 'MiningPool', 'BreedingLab', 'EvolutionLab', 'RepairShop', 'Marketplace', 'BattleArena'].map((n, i) => [n, `0x${(i + 1).toString(16).padStart(40, '0')}`])) as Deployment['contracts'],
};

describe('drand stub', () => {
  test('serves latest and a specific round with a fixed randomness', async () => {
    const stub = startDrandStub(39_123);
    try {
      const latest = await (await fetch(`${stub.url}/public/latest`)).json() as any;
      expect(latest.round).toBe(STUB_ROUND);
      expect(latest.randomness).toBe(STUB_RANDOMNESS);
      const r = await (await fetch(`${stub.url}/public/777`)).json() as any;
      expect(r.round).toBe(777);
      expect((await fetch(`${stub.url}/nope`)).status).toBe(404);
    } finally { stub.stop(); }
  });
});

describe('env assembly', () => {
  test('maps all twelve contract addresses and the harness-only settings', () => {
    const cfg = { rpcUrl: 'http://127.0.0.1:8545', databaseUrl: 'postgresql://x', drandUrl: 'http://127.0.0.1:1', apiPort: 3001, deployment, boostAnchorTs: 123n };
    const addrs = addressEnv(deployment);
    expect(Object.keys(addrs)).toHaveLength(12);
    expect(addrs.BATTLE_ARENA_ADDRESS).toBe(deployment.contracts.BattleArena);
    const api = apiEnv(cfg);
    expect(api.MATCHMAKER_ADDRESS).toBe(KEYS.deployer.address);
    expect(api.TRUST_PROXY).toBe('true');
    expect(api.CHAIN_ENV).toBe('testnet');
    expect(engineEnv(cfg).OPERATOR_PRIVATE_KEY).toBe(KEYS.deployer.key);
    expect(indexerEnv(cfg).INDEXER_START_BLOCK).toBe('0');
    expect(api.BOOST_EPOCH_ANCHOR_TS).toBe('123');
  });
});

describe('checks + wait', () => {
  test('accumulates results and reports failures', () => {
    const c = new Checks('x');
    c.check(true, 'a'); c.eq(1, 2, 'b');
    expect(c.failed.map((f) => f.name)).toEqual(['b']);
  });
  test('waitFor resolves the first truthy value and times out otherwise', async () => {
    let n = 0;
    expect(await waitFor(async () => (++n >= 3 ? n : null), { timeoutMs: 2000, everyMs: 5, label: 'count' })).toBe(3);
    await expect(waitFor(async () => null, { timeoutMs: 30, everyMs: 5, label: 'never' })).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('dna()', () => {
  test('encodes the class in the top nibble and stays inside 256 bits', () => {
    for (let seed = 0; seed < 12; seed++) {
      const v = dna(seed);
      expect(v < 2n ** 256n).toBe(true);
      expect(Number(v >> 252n)).toBe(seed % 10);
    }
  });
});
