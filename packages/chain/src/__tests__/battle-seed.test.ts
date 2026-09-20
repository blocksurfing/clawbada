import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { battleSeed, deriveSeedSecret, loadSeedMasterSecret, roundAtOrAfter, roundTime, seedCommitment, seedRoundFor, SEED_ROUND_DELAY_S } from '../battle-seed';
import { DrandBeaconClient } from '../drand';

// Known answers computed with `cast keccak $(cast concat-hex …)`, i.e. abi.encodePacked in the
// same order BattleArena.sol uses. The forge suite pins the same commitment vector
// (test_D01_commitmentKnownAnswer), so a drift on either side fails a test.
const SECRET = '0x1111111111111111111111111111111111111111111111111111111111111111';
const RANDOMNESS = '2222222222222222222222222222222222222222222222222222222222222222';
const KAT_COMMIT = '0x1cb972df85b64850dbe8c661744bd0bef0baa3ef8ecb4f0dcc959ea1e0990bab';
const KAT_SEED = '0x4cfc3772820031c7f693a676632d05193094288b1e70b9284cc2f0ce55de693f';

describe('D-01 battle seed', () => {
  test('commitment matches BattleArena: keccak256(abi.encodePacked(battleId, seedSecret))', () => {
    expect(seedCommitment(7n, SECRET)).toBe(KAT_COMMIT);
  });

  test('seed = keccak256(abi.encodePacked(randomness, seedSecret, battleId)), with or without 0x', () => {
    expect(battleSeed(RANDOMNESS, SECRET, 7n)).toBe(BigInt(KAT_SEED));
    expect(battleSeed('0x' + RANDOMNESS, SECRET, 7n)).toBe(BigInt(KAT_SEED));
  });

  test('the seed is not the public beacon and changes with the secret and with the battle', () => {
    const seed = battleSeed(RANDOMNESS, SECRET, 7n);
    expect(seed).not.toBe(BigInt('0x' + RANDOMNESS));
    expect(battleSeed(RANDOMNESS, deriveSeedSecret('another-master-secret-0123456789abcdef', 7n), 7n)).not.toBe(seed);
    expect(battleSeed(RANDOMNESS, SECRET, 8n)).not.toBe(seed);
  });

  test('per-battle secrets are deterministic, distinct per battle, and distinct per master', () => {
    const m = 'a-master-secret-that-is-long-enough-0123456789';
    expect(deriveSeedSecret(m, 1n)).toBe(deriveSeedSecret(m, 1n));
    expect(deriveSeedSecret(m, 1n)).not.toBe(deriveSeedSecret(m, 2n));
    expect(deriveSeedSecret(m, 1n)).not.toBe(deriveSeedSecret(m + 'x', 1n));
    expect(() => deriveSeedSecret('', 1n)).toThrow();
  });

  test('round rule: the first round emitted at or after revealedAt + delay — never one that already exists', () => {
    const info = { genesisTime: 1_692_803_367, period: 3 }; // quicknet
    for (const revealedAt of [1_800_000_000, 1_800_000_001, 1_800_000_002, 1_800_000_003]) {
      const r = seedRoundFor(info, revealedAt);
      expect(roundTime(info, r)).toBeGreaterThanOrEqual(revealedAt + SEED_ROUND_DELAY_S);
      expect(roundTime(info, r - 1)).toBeLessThan(revealedAt + SEED_ROUND_DELAY_S);
      expect(roundTime(info, r)).toBeGreaterThan(revealedAt); // strictly after the reveal block
    }
    expect(roundAtOrAfter(info, info.genesisTime)).toBe(1);
    expect(roundAtOrAfter(info, info.genesisTime + 1)).toBe(2);
    expect(roundAtOrAfter(info, info.genesisTime + 3)).toBe(2);
    expect(roundAtOrAfter({ genesisTime: 100, period: 30 }, 50)).toBe(1);
  });

  test('SEED_ROUND_DELAY_S mirrors BattleArena.SEED_ROUND_DELAY', () => {
    const sol = readFileSync(join(import.meta.dir, '../../../../contracts/BattleArena.sol'), 'utf8');
    const m = sol.match(/SEED_ROUND_DELAY\s*=\s*(\d+)\s*seconds/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(SEED_ROUND_DELAY_S);
  });

  test('master secret: required in production, length-checked, ephemeral elsewhere', () => {
    expect(loadSeedMasterSecret({ BATTLE_SEED_SECRET: 'x'.repeat(32) })).toEqual({ secret: 'x'.repeat(32), ephemeral: false });
    expect(() => loadSeedMasterSecret({ BATTLE_SEED_SECRET: 'short' })).toThrow();
    expect(() => loadSeedMasterSecret({ NODE_ENV: 'production' })).toThrow();
    const a = loadSeedMasterSecret({ NODE_ENV: 'test' });
    const b = loadSeedMasterSecret({ NODE_ENV: 'test' });
    expect(a.ephemeral).toBe(true);
    expect(a.secret).not.toBe(b.secret);
  });
});

describe('drand client (D-01 additions)', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  test('info() reads genesis and period once', async () => {
    let calls = 0;
    const c = new DrandBeaconClient('http://drand.test', (async () => { calls++; return json({ genesis_time: 1000, period: 3 }); }) as unknown as typeof fetch);
    expect(await c.info()).toEqual({ genesisTime: 1000, period: 3 });
    await c.info();
    expect(calls).toBe(1);
  });

  test('fetchRoundWhenReady waits out 404/425 for a round that is not published yet', async () => {
    const statuses = [404, 425, 200];
    const slept: number[] = [];
    const c = new DrandBeaconClient('http://drand.test', (async () => { const st = statuses.shift()!; return st === 200 ? json({ round: 9, randomness: 'ab'.repeat(32) }) : json({}, st); }) as unknown as typeof fetch);
    const b = await c.fetchRoundWhenReady(9, { pollMs: 10, sleep: async (ms) => { slept.push(ms); } });
    expect(b).toEqual({ round: 9, randomness: 'ab'.repeat(32) });
    expect(slept).toEqual([10, 10]);
  });

  test('fetchRoundWhenReady gives up after the timeout, fails fast on a real error, and rejects the wrong round', async () => {
    const never = new DrandBeaconClient('http://drand.test', (async () => json({}, 404)) as unknown as typeof fetch);
    await expect(never.fetchRoundWhenReady(9, { timeoutMs: 30, pollMs: 10, sleep: async () => {} })).rejects.toThrow(/not published/);
    const broken = new DrandBeaconClient('http://drand.test', (async () => json({}, 500)) as unknown as typeof fetch);
    await expect(broken.fetchRoundWhenReady(9, { sleep: async () => {} })).rejects.toThrow(/500/);
    const wrong = new DrandBeaconClient('http://drand.test', (async () => json({ round: 8, randomness: 'ab'.repeat(32) })) as unknown as typeof fetch);
    await expect(wrong.fetchRoundWhenReady(9, { sleep: async () => {} })).rejects.toThrow(/wanted 9/);
  });
});
