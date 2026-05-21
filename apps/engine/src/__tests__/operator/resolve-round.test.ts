import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ContractFunctionRevertedError } from 'viem';

// ── Mock @clawbada/chain ──
const mockGetBattle = mock<any>();
const mockWaitForReceipt = mock<any>();
const mockGetTeam = mock<any>();
const mockGetLobster = mock<any>();
const mockOwnerOf = mock<any>();
const mockGetPurity = mock<any>();
const mockWriteContract = mock(() => Promise.resolve('0xresolveTx'));

mock.module('@clawbada/chain', () => ({
  getPublicClient: () => ({ waitForTransactionReceipt: mockWaitForReceipt }),
  getOperatorClient: () => ({
    account: { address: '0xOperator' },
    writeContract: mockWriteContract,
  }),
  // Codex cross-cutting HIGH-1: handlers now use role-specific clients;
  // mock them all to the same writeContract spy.
  getMatchmakerClient: () => ({
    account: { address: '0xOperator' },
    writeContract: mockWriteContract,
  }),
  getResolverClient: () => ({
    account: { address: '0xOperator' },
    writeContract: mockWriteContract,
  }),
  getBattleArena: () => ({ read: { getBattle: mockGetBattle } }),
  getTeamManager: () => ({ read: { getTeam: mockGetTeam } }),
  getLobsterNFT: () => ({
    read: { getLobster: mockGetLobster, ownerOf: mockOwnerOf, getPurity: mockGetPurity },
  }),
  addresses: { battleArena: '0xBattleArenaAddress' },
  BattleArenaAbi: [],
}));

// ── Mock @clawbada/db ──
const dbUpdates: { table: string; set: Record<string, unknown> }[] = [];
const dbInserts: { table: string; values: Record<string, unknown> }[] = [];
const moveRevealRows: { value: Array<{ args: Record<string, unknown> }> } = { value: [] };
const vrfSeedRow: { value: Array<{ vrfSeed: string | null }> } = { value: [] };

mock.module('@clawbada/db', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        const isOnChainEvents = table?._?.name === 'on_chain_events';
        return {
          where: () => {
            if (isOnChainEvents) {
              // loadMovesForRound: `.where(...)` is the terminal await.
              return Promise.resolve(moveRevealRows.value);
            }
            // loadOrInitVrfSeed: `.where(...).orderBy(...).limit(...)`.
            return {
              orderBy: () => ({
                limit: () => Promise.resolve(vrfSeedRow.value),
              }),
            };
          },
        };
      },
    }),
    update: (table: any) => ({
      set: (args: Record<string, unknown>) => ({
        where: () => {
          dbUpdates.push({ table: table?._?.name ?? 'unknown', set: args });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: any) => ({
      values: (args: Record<string, unknown>) => {
        const tableName = table?._?.name ?? 'unknown';
        const insertRecord = { table: tableName, values: args };
        return {
          onConflictDoNothing: () => {
            dbInserts.push(insertRecord);
            return Promise.resolve();
          },
          // The handler doesn't currently call values().returning(); add a
          // stub in case it does later.
          returning: () => {
            dbInserts.push(insertRecord);
            return Promise.resolve([]);
          },
          then: (resolve: (v: unknown) => void) => {
            dbInserts.push(insertRecord);
            return Promise.resolve().then(() => resolve(undefined));
          },
        };
      },
    }),
  },
  battles: { _: { name: 'battles' }, battleId: 'battle_id' },
  battleRounds: { _: { name: 'battle_rounds' }, battleId: 'battle_id', round: 'round', vrfSeed: 'vrf_seed' },
  onChainEvents: { _: { name: 'on_chain_events' }, args: 'args', eventName: 'event_name' },
}));

// ── Mock drand (for VRF seed bootstrap) ──
mock.module('../../vrf/drand', () => ({
  DrandClient: class {
    fetchLatest() {
      return Promise.resolve({ round: 1, randomness: '0x42' });
    }
    toBigInt() {
      return 42n;
    }
  },
}));

// ── Mock game-logic to avoid the full resolver math in unit tests ──
// (initBattle + resolveRound have heavy dependencies — happy-path
// resolution is covered by the integration suite tracked in X9.)
const mockInitBattle = mock(() => ({
  round: 0,
  finished: false,
  winner: null as 'A' | 'B' | 'draw' | null,
  teamA: [],
  teamB: [],
  vrfSeed: 42n,
  roundResults: [],
}));
const mockResolveRoundFn = mock(() => ({
  round: 1,
  actions: [],
  teamAHp: [100n, 100n, 100n],
  teamBHp: [100n, 100n, 100n],
}));
mock.module('@clawbada/game-logic', () => ({
  initBattle: (...args: unknown[]) => mockInitBattle(...args as []),
  resolveRound: (state: any, ...args: unknown[]) => {
    const result = mockResolveRoundFn(...args as []);
    // The real resolver mutates state; mirror that here for `state.finished`
    // assertions.
    state.round = result.round;
    return result;
  },
  MAX_ROUNDS: 7,
  BATTLE_PROTOCOL_FEE_BPS: 1000n,
  STAKE_BRACKETS: [2500n, 10000n, 50000n],
}));

// ── Mock resolver/toLobster (used by loadTeamLobsters) ──
mock.module('../../combat/resolver', () => ({
  toLobster: (raw: Record<string, unknown>) => raw,
  CombatResolver: class {},
}));

// ── Import after mocks ──
import { resolveRoundHandler, type ResolveRoundPayload } from '../../operator/jobs/resolve-round';
import type { JobContext, JobResult } from '../../operator/types';

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 1n,
    jobType: 'resolve_round',
    attempts: 1,
    priorTxHash: null,
    recordTxHash: mock(() => Promise.resolve()),
    ...overrides,
  };
}

function makePayload(overrides: Partial<ResolveRoundPayload> = {}): ResolveRoundPayload {
  return { battleId: '42', round: 1, ...overrides };
}

function makeRevert(errorName: string): Error {
  const err = Object.create(ContractFunctionRevertedError.prototype);
  err.message = `reverted: ${errorName}`;
  err.data = { errorName };
  return err as Error;
}

function makeBattleStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    playerA: '0xAaA',
    playerB: '0xBbB',
    teamIdA: 1n,
    teamIdB: 2n,
    currentRound: 1,
    roundRevealedA: true,
    roundRevealedB: true,
    ...overrides,
  };
}

// 6 bytes = 12 hex chars: [moveType, target] × 3 lobsters
const VALID_MOVE_HEX = '0x000100000001';

describe('resolveRoundHandler', () => {
  beforeEach(() => {
    dbUpdates.length = 0;
    dbInserts.length = 0;
    moveRevealRows.value = [];
    vrfSeedRow.value = [];
    mockGetBattle.mockReset();
    mockWaitForReceipt.mockReset();
    mockGetTeam.mockReset();
    mockGetLobster.mockReset();
    mockOwnerOf.mockReset();
    mockGetPurity.mockReset();
    mockWriteContract.mockReset();
    mockInitBattle.mockClear();
    mockResolveRoundFn.mockClear();

    mockWriteContract.mockImplementation(() => Promise.resolve('0xresolveTx'));
    mockGetTeam.mockImplementation(() =>
      Promise.resolve({ lobsterIds: [10n, 11n, 12n] as readonly bigint[] }),
    );
    mockGetLobster.mockImplementation(() =>
      Promise.resolve({
        dna: 0n,
        evolutionTier: 1,
        damage: 0,
        breedCount: 0,
        generation: 0,
        soulbound: false,
        locked: false,
      }),
    );
    mockOwnerOf.mockImplementation(() => Promise.resolve('0xOwner'));
    mockGetPurity.mockImplementation(() => Promise.resolve(0n));
    mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'success' }));
  });

  describe('idempotent skip', () => {
    test('chain.currentRound > payload.round → returns ok without submit', async () => {
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 3 })));

      const result = await resolveRoundHandler(makePayload({ round: 1 }), makeCtx());

      expect(result.ok).toBe(true);
      expect(mockWriteContract).not.toHaveBeenCalled();
    });

    test('chain.currentRound < payload.round → transient retry', async () => {
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 1 })));

      const result = await resolveRoundHandler(makePayload({ round: 2 }), makeCtx());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('transient');
        expect(result.error).toBe('currentRound_mismatch');
      }
      expect(mockWriteContract).not.toHaveBeenCalled();
    });
  });

  describe('priorTxHash reconciliation', () => {
    test('successful receipt → returns ok, no resubmit', async () => {
      // Post Codex PR-C P1 restructure: priorTxHash path still reads chain
      // + replays state (to know if we need settle DB updates) but never
      // submits a new tx.
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 1 })));
      moveRevealRows.value = [
        { args: { player: '0xAaA', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
        { args: { player: '0xBbB', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
      ];
      mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'success' }));

      const result = await resolveRoundHandler(
        makePayload({ round: 1 }),
        makeCtx({ priorTxHash: '0xPrior' }),
      );

      expect(result.ok).toBe(true);
      expect(mockWriteContract).not.toHaveBeenCalled();
    });

    test('reverted receipt → dead with prior_tx_reverted', async () => {
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 1 })));
      moveRevealRows.value = [
        { args: { player: '0xAaA', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
        { args: { player: '0xBbB', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
      ];
      mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'reverted' }));

      const result = await resolveRoundHandler(
        makePayload({ round: 1 }),
        makeCtx({ priorTxHash: '0xReverted' }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('dead');
        expect(result.error).toBe('prior_tx_reverted');
      }
      expect(mockWriteContract).not.toHaveBeenCalled();
    });

    test('receipt-wait error → transient', async () => {
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 1 })));
      moveRevealRows.value = [
        { args: { player: '0xAaA', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
        { args: { player: '0xBbB', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
      ];
      mockWaitForReceipt.mockImplementation(() => Promise.reject(new Error('timeout')));

      const result = await resolveRoundHandler(
        makePayload({ round: 1 }),
        makeCtx({ priorTxHash: '0xPending' }),
      );

      // wraps as transient via classifyError catch path.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.retry).toBe('transient');
    });
  });

  describe('contract reverts', () => {
    test('InvalidBattlePhase from getBattle → dead', async () => {
      mockGetBattle.mockImplementation(() => Promise.reject(makeRevert('InvalidBattlePhase')));

      const result = await resolveRoundHandler(makePayload(), makeCtx());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('dead');
        expect(result.error).toBe('revert:InvalidBattlePhase');
      }
    });

    test('advanceRound revert on chain → dead with advance_reverted', async () => {
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 1 })));
      moveRevealRows.value = [
        { args: { player: '0xAaA', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
        { args: { player: '0xBbB', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
      ];
      vrfSeedRow.value = [];
      mockWaitForReceipt.mockImplementation(() => Promise.resolve({ status: 'reverted' }));

      const result = await resolveRoundHandler(makePayload({ round: 1 }), makeCtx());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('dead');
        expect(result.error).toBe('advance_reverted');
      }
    });
  });

  describe('moveData missing', () => {
    test('throws → transient via classifyError', async () => {
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 1 })));
      moveRevealRows.value = []; // no MoveRevealed events in on_chain_events
      vrfSeedRow.value = [];

      const result = await resolveRoundHandler(makePayload({ round: 1 }), makeCtx());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('transient');
        expect(result.error).toContain('MoveRevealed events missing');
      }
    });
  });

  describe('Codex PR-C P1: malformed moveData', () => {
    test('non-6-byte moveData on chain → dead, not transient', async () => {
      // Adversarial scenario: a player submits valid commit/reveal with
      // arbitrary `bytes` length (contract accepts unbounded `bytes`).
      // The handler can't resolve this round — must classify dead so the
      // operator job terminates after one attempt instead of burning 5.
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 1 })));
      moveRevealRows.value = [
        // 4-byte (8-hex) moveData — wrong length, contract accepted it
        { args: { player: '0xAaA', moveData: '0x00010002', round: '1', battleId: '42' } },
        { args: { player: '0xBbB', moveData: VALID_MOVE_HEX, round: '1', battleId: '42' } },
      ];
      vrfSeedRow.value = [];

      const result = await resolveRoundHandler(makePayload({ round: 1 }), makeCtx());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('dead');
        expect(result.error).toContain('malformed_moveData');
      }
      expect(mockWriteContract).not.toHaveBeenCalled();
    });
  });

  describe('Codex PR-C P2: vrf_seed null protection', () => {
    test('existing battle_rounds row with null vrf_seed → throws (transient)', async () => {
      mockGetBattle.mockImplementation(() => Promise.resolve(makeBattleStub({ currentRound: 2 })));
      // The earliest battle_rounds row exists but has a null vrf_seed —
      // signals DB corruption. Handler refuses to silently fetch a fresh
      // drand beacon (which would replay round 2 under a different seed
      // than round 1 used).
      vrfSeedRow.value = [{ vrfSeed: null }];
      moveRevealRows.value = [
        { args: { player: '0xAaA', moveData: VALID_MOVE_HEX, round: '2', battleId: '42' } },
        { args: { player: '0xBbB', moveData: VALID_MOVE_HEX, round: '2', battleId: '42' } },
      ];

      const result = await resolveRoundHandler(makePayload({ round: 2 }), makeCtx());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retry).toBe('transient');
        expect(result.error).toContain('null vrf_seed');
      }
    });
  });
});
