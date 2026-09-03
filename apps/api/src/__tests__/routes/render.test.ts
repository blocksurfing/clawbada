import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock @clawbada/asset-gen ──
const mockRenderLobsterPng = mock(() => Promise.resolve(Buffer.from('fake-png-data')));

mock.module('@clawbada/asset-gen', () => ({
  renderLobsterPng: mockRenderLobsterPng,
  VALID_SIZES: [64, 128, 256, 512],
}));

// ── Mock ../../lib/chain ──
const mockReadLobster = mock<any>();

// ── Local serializeBigInts ──
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

mock.module('../../lib/chain', () => ({
  readLobster: mockReadLobster,
  serializeBigInts: _serializeBigInts,
}));

// ── Import AFTER mocking ──
import { renderRoutes } from '../../routes/game/render';
import { mockLobster, createTestApp } from '../helpers/route-test-utils';

const app = createTestApp(renderRoutes, '/render');

describe('render routes', () => {
  beforeEach(() => {
    mockReadLobster.mockReset();
    mockRenderLobsterPng.mockImplementation(() => Promise.resolve(Buffer.from('fake-png-data')));
  });

  // ──────────── GET /render/dna/:dna ────────────

  describe('GET /render/dna/:dna', () => {
    test('returns PNG for valid DNA', async () => {
      const res = await app.request('/render/dna/12345');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    });

    test('accepts size and tier query params', async () => {
      const res = await app.request('/render/dna/12345?size=256&tier=2');
      expect(res.status).toBe(200);
    });

    test('returns 400 for invalid size', async () => {
      const res = await app.request('/render/dna/12345?size=100');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('size');
    });

    test('returns 400 for invalid tier', async () => {
      const res = await app.request('/render/dna/12345?tier=5');
      expect(res.status).toBe(400);
    });
  });

  // ──────────── GET /render/:tokenId ────────────

  describe('GET /render/:tokenId', () => {
    test('returns PNG for valid token ID', async () => {
      mockReadLobster.mockResolvedValue(mockLobster({ dna: 12345n }));

      const res = await app.request('/render/1');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    });
  });
});
