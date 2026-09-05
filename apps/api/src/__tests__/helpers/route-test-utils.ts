import { Hono } from 'hono';
import { ApiError } from '../../lib/errors';

// ──────────── Constants ────────────

export const TEST_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
export const OTHER_ADDRESS = '0x1234567890123456789012345678901234567890';

export const MOCK_ADDRESSES = {
  clawToken: '0xCLAW000000000000000000000000000000000000',
  lobsterNFT: '0xNFT0000000000000000000000000000000000000',
  teamManager: '0xTEAM000000000000000000000000000000000000',
  miningPool: '0xMINE000000000000000000000000000000000000',
  breedingLab: '0xBREED00000000000000000000000000000000000',
  marketplace: '0xMKT0000000000000000000000000000000000000',
  treasury: '0xTREAS0000000000000000000000000000000000',
  faucet: '0xFAUCET000000000000000000000000000000000',
  battleArena: '0xAREN000000000000000000000000000000000000',
  battleVRF: '0xVRF0000000000000000000000000000000000000',
  evolutionLab: '0xEVO0000000000000000000000000000000000000',
  repairShop: '0xREPAIR000000000000000000000000000000000',
};

// ──────────── Auth helpers ────────────

export function authHeaders(address?: string): Record<string, string> {
  return {
    'X-Wallet-Address': address ?? TEST_ADDRESS,
    'X-Signature': '0xdeadbeef',
    'X-Timestamp': String(Math.floor(Date.now() / 1000)),
  };
}

// ──────────── App factory ────────────

export function createTestApp(routes: Hono, basePath: string): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message }, err.status as any);
    }
    return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
  });
  app.route(basePath, routes);
  return app;
}

// ──────────── serializeBigInts (real copy — pure function, avoids mock) ────────────

export function serializeBigInts<T>(obj: T): T {
  if (typeof obj === 'bigint') return obj.toString() as unknown as T;
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(serializeBigInts) as unknown as T;
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInts(value);
    }
    return result as T;
  }
  return obj;
}

// ──────────── Mock factories ────────────

export function mockLobster(overrides: Record<string, any> = {}) {
  return {
    tokenId: 1n,
    owner: TEST_ADDRESS,
    dna: 0x3700000000000000000000000000000000000000000000000000000000000000n,
    decoded: { class: 3, legend: 0, breedType: 0, bodyParts: [] },
    evolutionTier: 1,
    damage: 0,
    breedCount: 0,
    generation: 0,
    soulbound: false,
    locked: false,
    purity: 3,
    stats: { hp: 450, attack: 110, armor: 80, speed: 105, critical: 115 },
    ...overrides,
  };
}

export function mockTeam(overrides: Record<string, any> = {}) {
  return {
    teamId: 1n,
    owner: TEST_ADDRESS,
    lobsterIds: [1n, 2n, 3n] as [bigint, bigint, bigint],
    // TeamManager.sol creates teams with active=false; `active` means "busy in mining or a
    // battle" (F-02). Idle by default so routes that require an idle team pass unless a test
    // opts into the busy case with { active: true }.
    active: false,
    ...overrides,
  };
}

export function mockExpedition(overrides: Record<string, any> = {}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    expeditionId: 1n,
    teamId: 1n,
    owner: TEST_ADDRESS,
    season: 1n,
    mineTier: 0,
    startTime: now - 14400n, // 4h ago (completed)
    reward: 1250n,
    claimed: false,
    isComplete: true,
    ...overrides,
  };
}

export function mockListing(overrides: Record<string, any> = {}) {
  return {
    listingId: 1n,
    seller: TEST_ADDRESS,
    lobsterId: 1n,
    price: 5000n,
    active: true,
    ...overrides,
  };
}

export function mockFaucetStatus(overrides: Record<string, any> = {}) {
  return {
    isOpen: true,
    closeTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
    isEligible: true,
    hasClaimedLobsters: false,
    hasClaimedClaw: false,
    ...overrides,
  };
}

export function mockBattle(overrides: Record<string, any> = {}) {
  return {
    battleId: 1n,
    playerA: TEST_ADDRESS,
    playerB: OTHER_ADDRESS,
    teamIdA: 1n,
    teamIdB: 2n,
    stakeAmount: 2500n,
    phase: 0,
    winner: '0x0000000000000000000000000000000000000000',
    depositA: false,
    depositB: false,
    teamCommitA: '0x0',
    teamCommitB: '0x0',
    teamRevealedA: false,
    teamRevealedB: false,
    proposedWinner: '0x0000000000000000000000000000000000000000',
    finalStateHash: '0x0',
    turnLogHash: '0x0',
    ...overrides,
  };
}
