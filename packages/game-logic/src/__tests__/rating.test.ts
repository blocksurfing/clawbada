import { describe, test, expect } from 'bun:test';
import {
  RATING_BASELINE,
  IDLE_DECAY_PER_EPOCH,
  BOOST_EPOCH_MS,
  BOOST_MIN_BPS,
  BOOST_MAX_BPS,
  BOOST_FLOOR_SCHEDULE,
  regressTowardBaseline,
  idleDecay,
  eloUpdate,
  lineageDecision,
  epochIdAt,
  epochWindow,
  floorPlayedForEpoch,
  boostBpsForPercentile,
  rankQualified,
  batchLadder,
} from '../rating';
import { calculateNewElo } from '../elo';
import { pctlOf, boostBpsAt } from '../v3/boost';

describe('regressTowardBaseline / idleDecay', () => {
  test('moves a fraction of the gap toward 1200, from above and below', () => {
    expect(regressTowardBaseline(1600, 0.5)).toBe(1400);
    expect(regressTowardBaseline(800, 0.5)).toBe(1000);
    expect(regressTowardBaseline(1200, 0.5)).toBe(1200);
  });

  test('fraction 0 is identity, fraction 1 is a full reset', () => {
    expect(regressTowardBaseline(1777, 0)).toBe(1777);
    expect(regressTowardBaseline(1777, 1)).toBe(RATING_BASELINE);
  });

  test('rejects fractions outside [0,1]', () => {
    expect(() => regressTowardBaseline(1500, 1.5)).toThrow();
    expect(() => regressTowardBaseline(1500, -0.1)).toThrow();
  });

  test('idle decay is 15% of the gap: 1600 → 1540, and 1600 after 4 idle weeks ≈ 1409', () => {
    expect(IDLE_DECAY_PER_EPOCH).toBe(0.15);
    expect(idleDecay(1600)).toBe(1540);
    let r = 1600;
    for (let i = 0; i < 4; i++) r = idleDecay(r);
    // 400 × (1 − 0.85^4) = 400 × 0.478 = 191 points lost (rounding per step)
    expect(r).toBeGreaterThanOrEqual(1408);
    expect(r).toBeLessThanOrEqual(1410);
  });

  test('a team at baseline never moves', () => {
    expect(idleDecay(RATING_BASELINE)).toBe(RATING_BASELINE);
  });
});

describe('eloUpdate', () => {
  test('matches calculateNewElo exactly across a table of inputs', () => {
    const cases: [number, number][] = [[1200, 1200], [1500, 1200], [1200, 1500], [1000, 2000], [1350, 1349]];
    for (const [w, l] of cases) {
      const ref = calculateNewElo(w, l);
      expect(eloUpdate(w, l)).toEqual({ winner: ref.newWinnerElo, loser: ref.newLoserElo });
    }
  });

  test('equal opponents exchange exactly 16 points (K=32)', () => {
    expect(eloUpdate(1200, 1200)).toEqual({ winner: 1216, loser: 1184 });
  });
});

describe('lineageDecision', () => {
  const parent = { rating: 1500, power: 5, gamesPlayedEpoch: 9, epochId: 7 };

  test('no parent → fresh', () => {
    expect(lineageDecision({ parent: null, shared: 0, childPower: 5, currentEpochId: 7 })).toEqual({
      rating: RATING_BASELINE, gamesPlayedEpoch: 0, reason: 'fresh',
    });
  });

  test('zero shared lobsters → fresh even with a parent', () => {
    expect(lineageDecision({ parent, shared: 0, childPower: 5, currentEpochId: 7 }).reason).toBe('fresh');
  });

  test('power changed → full re-qualification', () => {
    const d = lineageDecision({ parent, shared: 3, childPower: 6, currentEpochId: 7 });
    expect(d).toEqual({ rating: RATING_BASELINE, gamesPlayedEpoch: 0, reason: 'power_changed' });
  });

  test('1 / 2 / 3 shared → regress 2/3, 1/3, 0 of the 300-point gap', () => {
    expect(lineageDecision({ parent, shared: 1, childPower: 5, currentEpochId: 7 }).rating).toBe(1300);
    expect(lineageDecision({ parent, shared: 2, childPower: 5, currentEpochId: 7 }).rating).toBe(1400);
    expect(lineageDecision({ parent, shared: 3, childPower: 5, currentEpochId: 7 }).rating).toBe(1500);
  });

  test('played count carries over only within the same epoch', () => {
    expect(lineageDecision({ parent, shared: 2, childPower: 5, currentEpochId: 7 }).gamesPlayedEpoch).toBe(9);
    expect(lineageDecision({ parent, shared: 2, childPower: 5, currentEpochId: 8 }).gamesPlayedEpoch).toBe(0);
  });

  test('rejects an impossible shared count', () => {
    expect(() => lineageDecision({ parent, shared: 4, childPower: 5, currentEpochId: 7 })).toThrow();
  });
});

describe('epoch clock', () => {
  const anchor = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01T00:00Z

  test('window index at the anchor is 0, one ms before is −1, one week later is 1', () => {
    expect(epochIdAt(anchor, anchor)).toBe(0);
    expect(epochIdAt(anchor - 1, anchor)).toBe(-1);
    expect(epochIdAt(anchor + BOOST_EPOCH_MS, anchor)).toBe(1);
    expect(epochIdAt(anchor + BOOST_EPOCH_MS - 1, anchor)).toBe(0);
  });

  test('epochWindow is half-open and contiguous', () => {
    const w0 = epochWindow(0, anchor);
    const w1 = epochWindow(1, anchor);
    expect(w0.startsAt.getTime()).toBe(anchor);
    expect(w0.endsAt.getTime()).toBe(w1.startsAt.getTime());
    expect(epochIdAt(w0.endsAt.getTime() - 1, anchor)).toBe(0);
    expect(epochIdAt(w1.startsAt.getTime(), anchor)).toBe(1);
  });

  test('floor ramps 7 → 14 at the scheduled epoch', () => {
    expect(BOOST_FLOOR_SCHEDULE[0].floorPlayed).toBe(7);
    expect(floorPlayedForEpoch(0)).toBe(7);
    expect(floorPlayedForEpoch(3)).toBe(7);
    expect(floorPlayedForEpoch(4)).toBe(14);
    expect(floorPlayedForEpoch(40)).toBe(14);
    expect(floorPlayedForEpoch(2, [{ fromEpoch: 0, floorPlayed: 9 }])).toBe(9);
  });
});

describe('boostBpsForPercentile', () => {
  test('bottom = +10%, top = +50%, midpoint = +30%', () => {
    expect(boostBpsForPercentile(0)).toBe(BOOST_MIN_BPS);
    expect(boostBpsForPercentile(1)).toBe(BOOST_MAX_BPS);
    expect(boostBpsForPercentile(0.5)).toBe(3_000);
  });

  test('never exceeds the contract cap even with a wider schedule', () => {
    expect(boostBpsForPercentile(1, { kind: 'smooth', minBps: 1_000, maxBps: 9_000 })).toBe(BOOST_MAX_BPS);
  });
});

describe('rankQualified', () => {
  const team = (id: number, rating: number) => ({ teamId: BigInt(id), rating });

  test('empty ladder → no rows', () => {
    expect(rankQualified([])).toEqual([]);
  });

  test('k = 1: the lone team is top and earns +50% (spec behaviour)', () => {
    const [row] = rankQualified([team(1, 1200)]);
    expect(row.rank).toBe(1);
    expect(row.percentile).toBe(1);
    expect(row.boostBps).toBe(BOOST_MAX_BPS);
  });

  test('k = 2: {+50%, +10%}', () => {
    const rows = rankQualified([team(1, 1300), team(2, 1250)]);
    expect(rows.map((r) => r.boostBps)).toEqual([5_000, 1_000]);
    expect(rows.map((r) => Number(r.teamId))).toEqual([1, 2]);
  });

  test('reproduces pctlOf / boostBpsAt exactly for k = 50', () => {
    const teams = Array.from({ length: 50 }, (_, i) => team(i + 1, 2000 - i * 7));
    const rows = rankQualified(teams);
    rows.forEach((row, r) => {
      const p = pctlOf(r, 50);
      expect(row.percentile).toBeCloseTo(p, 12);
      expect(row.boostBps).toBe(Math.round(boostBpsAt(p, { kind: 'smooth', minBps: 1000, maxBps: 5000 })));
      expect(row.rank).toBe(r + 1);
    });
    expect(rows[0].boostBps).toBe(5_000);
    expect(rows[49].boostBps).toBe(1_000);
  });

  test('ties share rank and boost; the team after a tie group takes the next raw position', () => {
    const rows = rankQualified([team(1, 1400), team(2, 1400), team(3, 1300), team(4, 1200)]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(rows[0].boostBps).toBe(rows[1].boostBps);
    expect(rows[0].boostBps).toBe(5_000);
    expect(rows[3].boostBps).toBe(1_000);
  });

  test('boost is monotone non-increasing down the ladder', () => {
    const teams = Array.from({ length: 200 }, (_, i) => team(i + 1, 1000 + ((i * 37) % 900)));
    const rows = rankQualified(teams);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].boostBps).toBeLessThanOrEqual(rows[i - 1].boostBps);
      expect(rows[i].rating).toBeLessThanOrEqual(rows[i - 1].rating);
    }
  });

  test('below minLadderSize everyone earns the minimum', () => {
    const rows = rankQualified([team(1, 1500), team(2, 1400)], { minLadderSize: 3 });
    expect(rows.map((r) => r.boostBps)).toEqual([1_000, 1_000]);
  });

  test('population-proof: the same relative ladder pays the same at 50 / 500 / 5000 teams', () => {
    const boostAtQuartiles = (n: number) => {
      const rows = rankQualified(Array.from({ length: n }, (_, i) => team(i + 1, 3000 - i)));
      return [0, 0.25, 0.5, 0.75].map((q) => rows[Math.floor(q * (n - 1))].boostBps);
    };
    const a = boostAtQuartiles(50);
    const b = boostAtQuartiles(500);
    const c = boostAtQuartiles(5000);
    // Quartile INDEX rounding at n=50 moves the sampled percentile by up to ~2 points
    // (≈ 80 bps); anything beyond 1% would mean the ladder itself scales with population.
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(100);
      expect(Math.abs(b[i] - c[i])).toBeLessThanOrEqual(100);
    }
  });
});

describe('batchLadder', () => {
  test('450 rows → 3 batches of 200/200/50', () => {
    const rows = Array.from({ length: 450 }, (_, i) => i);
    const batches = batchLadder(rows, 200);
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(batches.flat()).toEqual(rows);
  });

  test('empty input → no batches; invalid size throws', () => {
    expect(batchLadder([], 200)).toEqual([]);
    expect(() => batchLadder([1], 0)).toThrow();
  });
});
