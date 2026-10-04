import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { decodeFunctionData } from 'viem';

// ── Mock @clawbada/chain ── (process-global: mirror the real module's shape for what the manager uses)
const realChain = await import('@clawbada/chain');
const mockSimulateStartSeason = mock((..._args: unknown[]) => Promise.resolve({ request: {} }));
mock.module('@clawbada/chain', () => ({
  ...realChain,
  addresses: { ...realChain.addresses, miningPool: '0x00000000000000000000000000000000000000aa' },
  getPublicClient: () => ({}),
  // The manager must never try to send startSeason itself (D-25). Kept here only to assert that.
  getMiningPool: () => ({ simulate: { startSeason: mockSimulateStartSeason }, read: {} }),
}));

// ── Mock @clawbada/db ──
const mockDbLimit = mock<any>();
mock.module('@clawbada/db', () => ({
  db: { select: () => ({ from: () => ({ orderBy: () => ({ limit: mockDbLimit }) }) }) },
  seasons: { season: 'season' },
}));

// ── Mock ../../logger ── records every line so the alarm names and payloads can be asserted
type Line = { level: 'info' | 'warn' | 'error'; fields: Record<string, any>; msg: string };
const lines: Line[] = [];
function record(level: Line['level']) {
  return (a: unknown, b?: unknown) =>
    lines.push(typeof a === 'string' ? { level, fields: {}, msg: a } : { level, fields: a as Record<string, any>, msg: String(b) });
}
const recorder = { info: record('info'), warn: record('warn'), error: record('error') };
const alarms = (level: Line['level'] = 'error') => lines.filter((l) => l.level === level);

import { MiningPoolAbi } from '@clawbada/chain';
import {
  SeasonManager,
  scheduledEmission,
  nextSeasonEmission,
  nextLaunchBaseReward,
  MINING_ALLOCATION,
  S1_EMISSION,
  S7_EMISSION,
  S1_LAUNCH_BASE_REWARD,
  BASE_REWARD_RULE,
  ROLLOVER_DUE_AHEAD_MS,
} from '../../seasons/manager';
import type { SeasonChainReader, SeasonInfo } from '../../seasons/manager';

/** A manager whose alarms land in `lines` (logger injected — no module mock). */
const mgr = (reader: SeasonChainReader) => new SeasonManager(reader, recorder);

const DAY = 24 * 60 * 60 * 1000;
const WEI = 10n ** 18n;

/** An indexer `seasons` row (what the DB mock returns). */
function dbRow(n: number, startedDaysAgo: number, now: number) {
  return {
    season: n,
    totalEmission: (scheduledEmission(n)).toString(),
    totalMinted: '0',
    baseReward: (1_250n * WEI).toString(),
    startTime: new Date(now - startedDaysAgo * DAY),
  };
}

/** The same season as the manager sees it (for buildRolloverPlan). */
function info(n: number, startedDaysAgo: number, now: number): SeasonInfo {
  return { season: n, totalEmission: scheduledEmission(n), totalMinted: 0n, baseReward: 1_250n * WEI, startTime: new Date(now - startedDaysAgo * DAY), source: 'chain' };
}

interface ChainState {
  /** MiningPool.currentSeason(); 0 = nothing started. */
  season: number;
  startedDaysAgo?: number;
  /** lifetimeMinted */
  minted?: bigint;
  /** currentBaseReward(): the glide's closing rate. */
  closing?: bigint;
}

/** A reader over a live chain in `state`, or over a dead RPC ('down': every read throws). */
function chain(state: ChainState | 'down', now: number): SeasonChainReader {
  if (state === 'down') {
    const rpc = async (): Promise<never> => { throw new Error('rpc'); };
    return { lifetimeMinted: rpc, currentBaseReward: rpc, currentSeason: rpc, getSeasonConfig: rpc, chainNow: rpc };
  }
  const closing = state.closing ?? 1_250n * WEI;
  return {
    lifetimeMinted: async () => state.minted ?? 0n,
    currentBaseReward: async () => closing,
    currentSeason: async () => state.season,
    getSeasonConfig: async (s: number) => ({
      totalEmission: scheduledEmission(s),
      baseReward: closing,
      startTime: BigInt(Math.floor((now - (state.startedDaysAgo ?? 0) * DAY) / 1000)),
      totalMinted: 0n,
    }),
    chainNow: async () => now,
  };
}

describe('season schedule (TOK-M1, wei)', () => {
  test('S1 352.5M halving through S6, S7 7.05M — in wei', () => {
    expect(scheduledEmission(1)).toBe(352_500_000n * WEI);
    expect(scheduledEmission(2)).toBe(176_250_000n * WEI);
    expect(scheduledEmission(6)).toBe(S1_EMISSION / 32n);
    expect(scheduledEmission(7)).toBe(S7_EMISSION);
  });
  test('the next season is clamped to what is left of the 705M allocation', () => {
    const minted = MINING_ALLOCATION - 1_000n * WEI;
    expect(nextSeasonEmission(8, minted)).toBe(1_000n * WEI);
    expect(nextSeasonEmission(2, 0n)).toBe(176_250_000n * WEI);
    expect(nextSeasonEmission(9, MINING_ALLOCATION)).toBe(0n);
  });
  test('rejects season 0', () => expect(() => scheduledEmission(0)).toThrow());
});

describe('next launch base reward (D-B: 2× the closing rate, capped at the genesis 1,250)', () => {
  test('a compressed close reopens at twice the closing rate', () => {
    expect(nextLaunchBaseReward(400n * WEI)).toBe(800n * WEI);
    expect(nextLaunchBaseReward(625n * WEI)).toBe(1_250n * WEI); // exactly the cap
  });
  test('2× the closing rate above 1,250 is capped at the genesis value', () => {
    expect(nextLaunchBaseReward(1_250n * WEI)).toBe(S1_LAUNCH_BASE_REWARD); // closed at the cap: 2,500 → 1,250
    expect(nextLaunchBaseReward(800n * WEI)).toBe(S1_LAUNCH_BASE_REWARD); // 1,600 → 1,250
  });
  test('a zero closing rate is not a rate: the genesis value', () => {
    expect(nextLaunchBaseReward(0n)).toBe(S1_LAUNCH_BASE_REWARD);
  });
});

describe('SeasonManager.checkRollover (the Safe starts seasons — D-25; the chain is read first — C-L3)', () => {
  const now = Date.UTC(2027, 0, 1);
  beforeEach(() => {
    mockDbLimit.mockReset();
    mockDbLimit.mockResolvedValue([]); // no indexer row unless a test says so: the monitor must not need one
    mockSimulateStartSeason.mockReset();
    lines.length = 0;
  });

  test('chain down and nothing in DB → nothing (one warning)', async () => {
    expect(await mgr(chain('down', now)).checkRollover(now)).toBeNull();
    expect(alarms()).toHaveLength(0);
    expect(alarms('warn').some((l) => l.msg.includes('blind'))).toBe(true);
  });

  test('mid-season → silent', async () => {
    expect(await mgr(chain({ season: 1, startedDaysAgo: 30 }, now)).checkRollover(now)).toBeNull();
    expect(alarms()).toHaveLength(0);
  });

  test('currentSeason() is 0 and no SeasonStarted ever indexed → season_not_started, daily', async () => {
    const m = mgr(chain({ season: 0 }, now));
    expect(await m.checkRollover(now)).toBe('not_started');
    expect(alarms()).toHaveLength(1);
    expect(alarms()[0].msg).toStartWith('season_not_started');
    expect(alarms()[0].fields.miningPool).toBe('0x00000000000000000000000000000000000000aa');
    expect(await m.checkRollover(now + 60 * 60 * 1000)).toBeNull();
    expect(await m.checkRollover(now + DAY)).toBe('not_started');
    expect(mockSimulateStartSeason).not.toHaveBeenCalled();
  });

  test('currentSeason() is 0 but the indexer holds a row → a mismatch warning, not season_not_started', async () => {
    mockDbLimit.mockResolvedValue([dbRow(1, 10, now)]);
    expect(await mgr(chain({ season: 0 }, now)).checkRollover(now)).toBeNull();
    expect(alarms()).toHaveLength(0);
    expect(alarms('warn').some((l) => l.msg.startsWith('season_chain_db_mismatch') && l.fields.indexedSeason === 1)).toBe(true);
  });

  test('3 days before the end → season_rollover_due with the exact Safe transaction at 2× the closing rate', async () => {
    const m = mgr(chain({ season: 1, startedDaysAgo: 58, minted: 100_000_000n * WEI, closing: 500n * WEI }, now)); // ends in 2 days
    expect(await m.checkRollover(now)).toBe('due');
    const plan = await m.buildRolloverPlan(info(1, 58, now));
    expect(plan.target).toBe('0x00000000000000000000000000000000000000aa');
    expect(plan.nextSeason).toBe(2);
    expect(plan.closingBaseReward).toBe(500n * WEI);
    expect(plan.baseReward).toBe(1_000n * WEI);
    expect(plan.baseRewardRule).toBe(BASE_REWARD_RULE);
    const decoded = decodeFunctionData({ abi: MiningPoolAbi, data: plan.calldata });
    expect(decoded.functionName).toBe('startSeason');
    expect(decoded.args).toEqual([176_250_000n * WEI, 1_000n * WEI]);
    expect(mockSimulateStartSeason).not.toHaveBeenCalled(); // never sends it itself
    // The alarm states the rule and the closing rate, so the signer can check the proposal.
    const due = alarms()[0];
    expect(due.msg).toStartWith('season_rollover_due');
    expect(due.msg).toContain(BASE_REWARD_RULE);
    expect(due.fields.baseRewardRule).toBe(BASE_REWARD_RULE);
    expect(due.fields.closingBaseReward).toBe((500n * WEI).toString());
    expect(due.fields.safeTx).toEqual({ to: plan.target, value: '0', data: plan.calldata, call: `MiningPool.startSeason(${176_250_000n * WEI}, ${1_000n * WEI})` });
  });

  test('a season that closed at the cap reopens at the cap (2 × 1,250 → capped at 1,250)', async () => {
    const m = mgr(chain({ season: 1, startedDaysAgo: 58, closing: 1_250n * WEI }, now));
    const plan = await m.buildRolloverPlan(info(1, 58, now));
    expect(plan.baseReward).toBe(1_250n * WEI);
    expect(decodeFunctionData({ abi: MiningPoolAbi, data: plan.calldata }).args).toEqual([176_250_000n * WEI, 1_250n * WEI]);
  });

  test('the due alarm repeats daily, not every tick', async () => {
    const m = mgr(chain({ season: 1, startedDaysAgo: 58 }, now));
    expect(await m.checkRollover(now)).toBe('due');
    expect(await m.checkRollover(now + 60 * 60 * 1000)).toBeNull();
    expect(await m.checkRollover(now + DAY)).toBe('due');
  });

  test('season over and no new one → season_rollover_overdue (the season gap), repeating hourly, with no indexer row', async () => {
    const m = mgr(chain({ season: 2, startedDaysAgo: 61 }, now));
    expect(await m.checkRollover(now)).toBe('overdue');
    expect(await m.checkRollover(now + 30 * 60 * 1000)).toBeNull();
    expect(await m.checkRollover(now + 61 * 60 * 1000)).toBe('overdue');
    const gap = alarms()[0];
    expect(gap.msg).toStartWith('season_rollover_overdue');
    expect(gap.msg).toContain('season gap');
    expect(gap.fields.seasonGap.since).toBe(new Date(now - DAY).toISOString());
    expect(gap.fields.seasonGap.hours).toBe(24);
    expect(gap.fields.seasonGap.effect).toContain('SeasonNotActive');
    expect(gap.fields.seasonSource).toBe('chain');
  });

  test('chain down but the indexer has the row → the alarm still fires from the DB fallback', async () => {
    mockDbLimit.mockResolvedValue([dbRow(2, 61, now)]);
    const m = mgr(chain('down', now));
    expect(await m.checkRollover(now)).toBe('overdue');
    const gap = alarms()[0];
    expect(gap.fields.seasonSource).toBe('db');
    // The closing rate and lifetimeMinted were unreadable too: the plan falls back to the genesis
    // 1,250 and the unclamped schedule (the contract clamps anyway, D-20), and says so.
    expect(gap.fields.closingBaseReward).toBeNull();
    expect(gap.fields.baseRewardRule).toContain('unreadable');
    expect(gap.fields.emissionRule).toContain('NOT clamped');
    expect(decodeFunctionData({ abi: MiningPoolAbi, data: gap.fields.safeTx.data }).args).toEqual([scheduledEmission(3), 1_250n * WEI]);
  });

  test('allocation exhausted → no alarm to start anything', async () => {
    expect(await mgr(chain({ season: 8, startedDaysAgo: 61, minted: MINING_ALLOCATION }, now)).checkRollover(now)).toBe('exhausted');
    expect(alarms()).toHaveLength(0);
  });

  test('an unreadable closing rate falls back to the genesis 1,250 (the Safe may change it)', async () => {
    const live = chain({ season: 1, startedDaysAgo: 58 }, now);
    const m = mgr({ ...live, currentBaseReward: async () => { throw new Error('rpc'); } });
    expect(await m.checkRollover(now)).toBe('due');
    const plan = await m.buildRolloverPlan(info(1, 58, now));
    expect(plan.closingBaseReward).toBeNull();
    expect(plan.baseRewardRule).toContain(BASE_REWARD_RULE);
    expect(decodeFunctionData({ abi: MiningPoolAbi, data: plan.calldata }).args?.[1]).toBe(1_250n * WEI);
    expect(alarms('warn').some((l) => l.msg.includes('closing base reward unreadable'))).toBe(true);
  });

  test('the Safe started the next season → handler fires once and the alarms reset', async () => {
    // The chain's state moves under the manager: season 1 ended a day ago, then season 2 starts.
    let state: ChainState = { season: 1, startedDaysAgo: 61 };
    let t = now;
    const m = mgr({
      ...chain(state, t),
      currentSeason: async () => state.season,
      getSeasonConfig: (s) => chain(state, t).getSeasonConfig(s),
    });
    const handler = mock((_season: number, _emission: bigint, _baseReward: bigint) => {});
    m.setRolloverHandler(handler);
    expect(await m.checkRollover(now)).toBe('overdue');
    state = { season: 2, startedDaysAgo: 0 };
    t = now + DAY;
    expect(await m.checkRollover(now + DAY)).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(2);
    expect(await m.checkRollover(now + 2 * DAY)).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('due window starts exactly ROLLOVER_DUE_AHEAD_MS before the end', async () => {
    const end = now;
    const m = mgr(chain({ season: 1, startedDaysAgo: 60 }, end));
    expect(await m.checkRollover(end - ROLLOVER_DUE_AHEAD_MS - 1)).toBeNull();
    expect(await m.checkRollover(end - ROLLOVER_DUE_AHEAD_MS)).toBe('due');
  });

  test('with no `now`, the tick judges the season by chain time, not the wall clock', async () => {
    // Chain time says the season ended a day ago; the wall clock (2026) is long before `now`.
    const m = mgr(chain({ season: 1, startedDaysAgo: 61 }, now));
    expect(await m.checkRollover()).toBe('overdue');
  });
});
