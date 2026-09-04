import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/chain (auth + ABI encoding) ──
const mockVerifyMessage = mock(() => Promise.resolve(true));
const mockGetAddress = mock((addr: string) => addr);
const mockEncodeFunctionData = mock(() => '0xabcdef');

mock.module('@clawbada/chain', () => ({
  verifyMessage: mockVerifyMessage,
  getAddress: mockGetAddress,
  encodeFunctionData: mockEncodeFunctionData,
  TeamManagerAbi: [],
  addresses: {
    teamManager: '0xTEAM',
    clawToken: '0xCLAW',
  },
  base: { id: 8453 },
  baseSepolia: { id: 84532 },
}));

// ── Local serializeBigInts (pure fn, avoids async import in mock.module) ──
function _serializeBigInts(obj: any): any {
  if (typeof obj === 'bigint') return obj.toString();
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(_serializeBigInts);
  if (typeof obj === 'object') {
    const r: any = {};
    for (const [k, v] of Object.entries(obj)) r[k] = _serializeBigInts(v);
    return r;
  }
  return obj;
}

// ── Mock ../../lib/chain (on-chain reads) ──
const mockReadTeam = mock<any>();
const mockReadTeamsByOwner = mock<any>();
const mockReadLobster = mock<any>();

mock.module('../../lib/chain', () => ({
  readTeam: mockReadTeam,
  readTeamsByOwner: mockReadTeamsByOwner,
  readLobster: mockReadLobster,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { teamRoutes } from '../../routes/game/teams';
import {
  TEST_ADDRESS,
  OTHER_ADDRESS,
  authHeaders,
  mockLobster,
  mockTeam,
  createTestApp,
} from '../helpers/route-test-utils';

const app = createTestApp(teamRoutes, '/teams');

describe('team routes', () => {
  beforeEach(() => {
    mockReadTeam.mockReset();
    mockReadTeamsByOwner.mockReset();
    mockReadLobster.mockReset();
    mockVerifyMessage.mockImplementation(() => Promise.resolve(true));
    mockGetAddress.mockImplementation((addr: string) => addr);
  });

  // ──────────── GET /teams ────────────

  describe('GET /teams', () => {
    test('returns teams for valid address', async () => {
      const team = mockTeam();
      mockReadTeamsByOwner.mockResolvedValue([team]);

      const res = await app.request(`/teams?address=${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(1);
      expect(body.teams).toHaveLength(1);
    });

    test('returns 400 when address query param missing', async () => {
      const res = await app.request('/teams');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('INVALID_INPUT');
    });

    test('returns empty array for address with no teams', async () => {
      mockReadTeamsByOwner.mockResolvedValue([]);

      const res = await app.request(`/teams?address=${TEST_ADDRESS}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(0);
      expect(body.teams).toHaveLength(0);
    });
  });

  // ──────────── GET /teams/:teamId ────────────

  describe('GET /teams/:teamId', () => {
    test('returns enriched team with lobster data', async () => {
      const team = mockTeam();
      mockReadTeam.mockResolvedValue(team);
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id })),
      );

      const res = await app.request('/teams/1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.lobsters).toHaveLength(3);
      expect(body.lobsters[0]).toHaveProperty('stats');
      expect(body.lobsters[0]).toHaveProperty('purity');
    });

    test('returns 404 when team not found', async () => {
      const { ApiError } = await import('../../lib/errors');
      mockReadTeam.mockRejectedValue(new ApiError('NOT_FOUND', 'Team not found'));

      const res = await app.request('/teams/999');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('NOT_FOUND');
    });
  });

  // ──────────── POST /teams/create ────────────

  describe('POST /teams/create', () => {
    test('returns calldata for valid 3 lobsters', async () => {
      mockReadLobster.mockImplementation((id: bigint) =>
        Promise.resolve(mockLobster({ tokenId: id, owner: TEST_ADDRESS })),
      );

      const res = await app.request('/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterIds: ['1', '2', '3'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].calldata).toHaveProperty('to');
      expect(body.steps[0].calldata).toHaveProperty('data');
      expect(body.steps[0].calldata).toHaveProperty('chainId');
    });

    test('returns 400 when fewer than 3 lobsterIds', async () => {
      const res = await app.request('/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterIds: ['1', '2'] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('INVALID_INPUT');
    });

    test('returns 401 without auth headers', async () => {
      const res = await app.request('/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobsterIds: ['1', '2', '3'] }),
      });
      expect(res.status).toBe(401);
    });

    test('returns 400 when lobster not owned by caller', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ owner: OTHER_ADDRESS }));

      const res = await app.request('/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterIds: ['1', '2', '3'] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('not owned by caller');
    });

    test('returns 409 when lobster is locked', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ locked: true }));

      const res = await app.request('/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lobsterIds: ['1', '2', '3'] }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('LOBSTER_LOCKED');
    });
  });

  // ──────────── POST /teams/:teamId/disband ────────────

  describe('POST /teams/:teamId/disband', () => {
    test('returns calldata for disbanding owned team', async () => {
      mockReadTeam.mockResolvedValue(mockTeam());

      const res = await app.request('/teams/1/disband', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].description).toContain('Disband');
    });

    test('returns 400 when not team owner', async () => {
      mockReadTeam.mockResolvedValue(mockTeam({ owner: OTHER_ADDRESS }));

      const res = await app.request('/teams/1/disband', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Not the team owner');
    });

    test('returns 400 when the team is busy (mining or in a battle)', async () => {
      // F-02c: TeamManager.disbandTeam reverts while active=true, so the API refuses early.
      mockReadTeam.mockResolvedValue(mockTeam({ active: true }));

      const res = await app.request('/teams/1/disband', {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('busy');
    });
  });
});
