import { describe, test, expect } from 'bun:test';
import {
  getBaseStats,
  scaleStats,
  getClassAdvantage,
  calculateAttackDamage,
  calculateDefendCounter,
  calculateSpecialDamage,
  critChance,
  enhancedProcChance,
} from '../battle-resolver';
import { EvolutionTier, LobsterClass } from '../types';
import type { Stats } from '../types';
import { BASE_STATS, NUM_CLASSES } from '../constants';

// ──────────── getBaseStats ────────────

describe('getBaseStats', () => {
  const classNames = [
    'Bulwark',
    'Mantis',
    'Leviathan',
    'Tempest',
    'Specter',
    'Sentinel',
    'Reaver',
    'Abyss',
    'Kraken',
    'Ember',
  ] as const;

  const expectedStats: [bigint, bigint, bigint, bigint, bigint][] = [
    [700n, 70n, 120n, 80n, 90n], // Bulwark
    [375n, 100n, 70n, 130n, 125n], // Mantis
    [600n, 130n, 100n, 70n, 80n], // Leviathan
    [450n, 110n, 80n, 105n, 115n], // Tempest
    [425n, 85n, 85n, 125n, 120n], // Specter
    [650n, 70n, 110n, 90n, 100n], // Sentinel
    [475n, 120n, 80n, 110n, 95n], // Reaver
    [525n, 110n, 90n, 95n, 100n], // Abyss
    [550n, 90n, 100n, 105n, 95n], // Kraken
    [350n, 140n, 60n, 100n, 130n], // Ember
  ];

  for (let i = 0; i < 10; i++) {
    test(`returns correct stats for ${classNames[i]} (class ${i})`, () => {
      const stats = getBaseStats(i as LobsterClass);
      const [hp, atk, armor, spd, crit] = expectedStats[i];
      expect(stats.hp).toBe(hp);
      expect(stats.attack).toBe(atk);
      expect(stats.armor).toBe(armor);
      expect(stats.speed).toBe(spd);
      expect(stats.critical).toBe(crit);
    });
  }

  test('throws for invalid class -1', () => {
    expect(() => getBaseStats(-1 as LobsterClass)).toThrow('Invalid class ID');
  });

  test('throws for invalid class 10', () => {
    expect(() => getBaseStats(10 as LobsterClass)).toThrow('Invalid class ID');
  });
});

// ──────────── scaleStats ────────────

describe('scaleStats', () => {
  // Helper: Bulwark base stats
  const bulwarkBase: Stats = {
    hp: 700n,
    attack: 70n,
    armor: 120n,
    speed: 80n,
    critical: 90n,
  };

  test('Base tier, non-legend: stats unchanged except HP x5', () => {
    const scaled = scaleStats(bulwarkBase, EvolutionTier.Base, false);
    // tierMult=1000, legendMult=1000, denom=1000*1000=1_000_000
    // stat * 1000 * 1000 / 1_000_000 = stat
    // HP also * 5
    expect(scaled.hp).toBe(700n * 5n); // 3500
    expect(scaled.attack).toBe(70n);
    expect(scaled.armor).toBe(120n);
    expect(scaled.speed).toBe(80n);
    expect(scaled.critical).toBe(90n);
  });

  test('Evolved tier (x1.2), non-legend: each stat * 1200/1000, HP also x5', () => {
    const scaled = scaleStats(bulwarkBase, EvolutionTier.Evolved, false);
    // stat * 1200 * 1000 / 1_000_000 = stat * 1200 / 1000
    expect(scaled.hp).toBe((700n * 1200n * 5n) / 1000n); // 4200
    expect(scaled.attack).toBe((70n * 1200n) / 1000n); // 84
    expect(scaled.armor).toBe((120n * 1200n) / 1000n); // 144
    expect(scaled.speed).toBe((80n * 1200n) / 1000n); // 96
    expect(scaled.critical).toBe((90n * 1200n) / 1000n); // 108
  });

  test('Elite tier (x1.4), non-legend: each stat * 1400/1000, HP also x5', () => {
    const scaled = scaleStats(bulwarkBase, EvolutionTier.Elite, false);
    expect(scaled.hp).toBe((700n * 1400n * 5n) / 1000n); // 4900
    expect(scaled.attack).toBe((70n * 1400n) / 1000n); // 98
    expect(scaled.armor).toBe((120n * 1400n) / 1000n); // 168
    expect(scaled.speed).toBe((80n * 1400n) / 1000n); // 112
    expect(scaled.critical).toBe((90n * 1400n) / 1000n); // 126
  });

  test('Apex tier (x1.6), non-legend: each stat * 1600/1000, HP also x5', () => {
    const scaled = scaleStats(bulwarkBase, EvolutionTier.Apex, false);
    expect(scaled.hp).toBe((700n * 1600n * 5n) / 1000n); // 5600
    expect(scaled.attack).toBe((70n * 1600n) / 1000n); // 112
    expect(scaled.armor).toBe((120n * 1600n) / 1000n); // 192
    expect(scaled.speed).toBe((80n * 1600n) / 1000n); // 128
    expect(scaled.critical).toBe((90n * 1600n) / 1000n); // 144
  });

  test('Base tier, legend (x1.1): legend bonus stacks', () => {
    const scaled = scaleStats(bulwarkBase, EvolutionTier.Base, true);
    // stat * 1000 * 1100 / 1_000_000 = stat * 1100 / 1000
    expect(scaled.hp).toBe((700n * 1100n * 5n) / 1000n); // 3850
    expect(scaled.attack).toBe((70n * 1100n) / 1000n); // 77
    expect(scaled.armor).toBe((120n * 1100n) / 1000n); // 132
    expect(scaled.speed).toBe((80n * 1100n) / 1000n); // 88
    expect(scaled.critical).toBe((90n * 1100n) / 1000n); // 99
  });

  test('Apex Legend Bulwark: combined tier + legend exact values', () => {
    const scaled = scaleStats(bulwarkBase, EvolutionTier.Apex, true);
    // stat * 1600 * 1100 / 1_000_000 = stat * 1760 / 1000
    const denom = 1000n * 1000n;
    expect(scaled.hp).toBe((700n * 1600n * 1100n * 5n) / denom); // 6160
    expect(scaled.attack).toBe((70n * 1600n * 1100n) / denom); // 123 (truncated)
    expect(scaled.armor).toBe((120n * 1600n * 1100n) / denom); // 211 (truncated)
    expect(scaled.speed).toBe((80n * 1600n * 1100n) / denom); // 140 (truncated)
    expect(scaled.critical).toBe((90n * 1600n * 1100n) / denom); // 158 (truncated)
  });

  test('Evolved Legend Mantis: different class + tier + legend', () => {
    const mantisBase: Stats = {
      hp: 375n,
      attack: 100n,
      armor: 70n,
      speed: 130n,
      critical: 125n,
    };
    const scaled = scaleStats(mantisBase, EvolutionTier.Evolved, true);
    const denom = 1000n * 1000n;
    expect(scaled.hp).toBe((375n * 1200n * 1100n * 5n) / denom); // 2475
    expect(scaled.attack).toBe((100n * 1200n * 1100n) / denom); // 132
    expect(scaled.armor).toBe((70n * 1200n * 1100n) / denom); // 92 (truncated)
    expect(scaled.speed).toBe((130n * 1200n * 1100n) / denom); // 171 (truncated)
    expect(scaled.critical).toBe((125n * 1200n * 1100n) / denom); // 165
  });
});

// ──────────── getClassAdvantage ────────────

describe('getClassAdvantage', () => {
  test('self vs self = neutral (1000n) for all classes', () => {
    for (let i = 0; i < NUM_CLASSES; i++) {
      expect(getClassAdvantage(i as LobsterClass, i as LobsterClass)).toBe(1000n);
    }
  });

  test('circulant: diff 1 = advantage (1250n)', () => {
    // Bulwark (0) attacks Mantis (1): diff = (1 + 10 - 0) % 10 = 1 => advantage
    expect(getClassAdvantage(LobsterClass.Bulwark, LobsterClass.Mantis)).toBe(1250n);
  });

  test('circulant: diff 4 = advantage (1250n)', () => {
    // Bulwark (0) attacks Specter (4): diff = (4 + 10 - 0) % 10 = 4 => advantage
    expect(getClassAdvantage(LobsterClass.Bulwark, LobsterClass.Specter)).toBe(1250n);
  });

  test('circulant: diff 5 = neutral (1000n)', () => {
    // Bulwark (0) attacks Sentinel (5): diff = (5 + 10 - 0) % 10 = 5 => neutral
    expect(getClassAdvantage(LobsterClass.Bulwark, LobsterClass.Sentinel)).toBe(1000n);
  });

  test('circulant: diff 6 = disadvantage (800n)', () => {
    // Bulwark (0) attacks Reaver (6): diff = (6 + 10 - 0) % 10 = 6 => disadvantage
    expect(getClassAdvantage(LobsterClass.Bulwark, LobsterClass.Reaver)).toBe(800n);
  });

  test('circulant: diff 9 = disadvantage (800n)', () => {
    // Bulwark (0) attacks Ember (9): diff = (9 + 10 - 0) % 10 = 9 => disadvantage
    expect(getClassAdvantage(LobsterClass.Bulwark, LobsterClass.Ember)).toBe(800n);
  });

  test('each class beats exactly 4 and loses to exactly 4', () => {
    for (let atk = 0; atk < NUM_CLASSES; atk++) {
      let wins = 0;
      let losses = 0;
      let neutrals = 0;
      for (let def = 0; def < NUM_CLASSES; def++) {
        const mult = getClassAdvantage(atk as LobsterClass, def as LobsterClass);
        if (mult === 1250n) wins++;
        else if (mult === 800n) losses++;
        else neutrals++;
      }
      expect(wins).toBe(4);
      expect(losses).toBe(4);
      expect(neutrals).toBe(2); // self + opposite
    }
  });

  test('all 100 class pairs return valid multipliers', () => {
    for (let a = 0; a < NUM_CLASSES; a++) {
      for (let d = 0; d < NUM_CLASSES; d++) {
        const mult = getClassAdvantage(a as LobsterClass, d as LobsterClass);
        expect([800n, 1000n, 1250n]).toContain(mult);
      }
    }
  });

  test('throws for invalid attacker class', () => {
    expect(() => getClassAdvantage(-1 as LobsterClass, LobsterClass.Bulwark)).toThrow(
      'Invalid attacker class',
    );
    expect(() => getClassAdvantage(10 as LobsterClass, LobsterClass.Bulwark)).toThrow(
      'Invalid attacker class',
    );
  });

  test('throws for invalid defender class', () => {
    expect(() => getClassAdvantage(LobsterClass.Bulwark, -1 as LobsterClass)).toThrow(
      'Invalid defender class',
    );
    expect(() => getClassAdvantage(LobsterClass.Bulwark, 10 as LobsterClass)).toThrow(
      'Invalid defender class',
    );
  });
});

// ──────────── calculateAttackDamage ────────────

describe('calculateAttackDamage', () => {
  test('known input: atk=100, armor=100, neutral, no crit, vrfRoll=1000 => 100', () => {
    // 100 * min(100*1000/100, 2200) * 1000 * 1000 * 1000 / (1000^4)
    // = 100 * 1000 * 1000 * 1000 * 1000 / 1_000_000_000_000
    // = 100_000_000_000_000 / 1_000_000_000_000 = 100
    const result = calculateAttackDamage(100n, 100n, 1000n, false, 1000n);
    expect(result).toBe(100n);
  });

  test('stat ratio cap: atk=10000, armor=1 => ratio capped at 2200', () => {
    // ratio = 10000*1000/1 = 10_000_000 => capped at 2200
    // 100 * 2200 * 1000 * 1000 * 1000 / 1_000_000_000_000 = 220
    const result = calculateAttackDamage(10000n, 1n, 1000n, false, 1000n);
    expect(result).toBe(220n);
  });

  test('crit multiplier: same inputs with isCrit=true => result x1.5', () => {
    const noCrit = calculateAttackDamage(100n, 100n, 1000n, false, 1000n);
    const withCrit = calculateAttackDamage(100n, 100n, 1000n, true, 1000n);
    expect(withCrit).toBe((noCrit * 1500n) / 1000n);
  });

  test('VRF variance: vrfRoll=850 vs 1150 changes output', () => {
    const low = calculateAttackDamage(100n, 100n, 1000n, false, 850n);
    const high = calculateAttackDamage(100n, 100n, 1000n, false, 1150n);
    expect(low).toBeLessThan(high);
    // 100 * 1000 * 1000 * 1000 * 850 / 1e12 = 85
    expect(low).toBe(85n);
    // 100 * 1000 * 1000 * 1000 * 1150 / 1e12 = 115
    expect(high).toBe(115n);
  });

  test('class advantage multiplier: 1250 gives 25% more damage', () => {
    const neutral = calculateAttackDamage(100n, 100n, 1000n, false, 1000n);
    const advantage = calculateAttackDamage(100n, 100n, 1250n, false, 1000n);
    expect(advantage).toBe(125n);
    expect(advantage).toBe((neutral * 1250n) / 1000n);
  });

  test('class disadvantage multiplier: 800 gives 20% less damage', () => {
    const disadvantage = calculateAttackDamage(100n, 100n, 800n, false, 1000n);
    expect(disadvantage).toBe(80n);
  });

  test('high atk vs low armor (within cap): atk=200, armor=100 => ratio=2.0', () => {
    // 100 * 2000 * 1000 * 1000 * 1000 / 1e12 = 200
    const result = calculateAttackDamage(200n, 100n, 1000n, false, 1000n);
    expect(result).toBe(200n);
  });

  test('low atk vs high armor: atk=50, armor=100 => ratio=0.5', () => {
    // 100 * 500 * 1000 * 1000 * 1000 / 1e12 = 50
    const result = calculateAttackDamage(50n, 100n, 1000n, false, 1000n);
    expect(result).toBe(50n);
  });
});

// ──────────── calculateDefendCounter ────────────

describe('calculateDefendCounter', () => {
  test('base 30 with ratio 1.0, neutral, vrfRoll=1000 => 30', () => {
    // 30 * 1000 * 1000 * 1000 / (1000^3) = 30
    const result = calculateDefendCounter(100n, 100n, 1000n, 1000n);
    expect(result).toBe(30n);
  });

  test('stat ratio cap applies: atk=10000, armor=1 => capped at 2200', () => {
    // 30 * 2200 * 1000 * 1000 / 1_000_000_000 = 66
    const result = calculateDefendCounter(10000n, 1n, 1000n, 1000n);
    expect(result).toBe(66n);
  });

  test('class advantage: 1250 multiplier', () => {
    // 30 * 1000 * 1250 * 1000 / 1e9 = 37 (truncated from 37.5)
    const result = calculateDefendCounter(100n, 100n, 1250n, 1000n);
    expect(result).toBe(37n);
  });

  test('VRF variance affects counter damage', () => {
    const low = calculateDefendCounter(100n, 100n, 1000n, 850n);
    const high = calculateDefendCounter(100n, 100n, 1000n, 1150n);
    expect(low).toBe(25n); // 30 * 850/1000 = 25.5 truncated
    expect(high).toBe(34n); // 30 * 1150/1000 = 34.5 truncated
  });
});

// ──────────── calculateSpecialDamage ────────────

describe('calculateSpecialDamage', () => {
  test('purity 0 = x1.0 potency (1000n)', () => {
    // basePower=150 * 1000(ratio) * 1000(class) * 1000(purity) * 1000(vrf) / 1e12 = 150
    const result = calculateSpecialDamage(150n, 100n, 100n, 1000n, 0, 1000n);
    expect(result).toBe(150n);
  });

  test('purity 6 = x1.6 potency (1600n)', () => {
    // basePower=150 * 1000 * 1000 * 1600 * 1000 / 1e12 = 240
    const result = calculateSpecialDamage(150n, 100n, 100n, 1000n, 6, 1000n);
    expect(result).toBe(240n);
  });

  test('purity 3 = x1.3 potency', () => {
    // basePower=150 * 1000 * 1000 * 1300 * 1000 / 1e12 = 195
    const result = calculateSpecialDamage(150n, 100n, 100n, 1000n, 3, 1000n);
    expect(result).toBe(195n);
  });

  test('basePower affects output: Crush (180) vs Ambush (150)', () => {
    const crush = calculateSpecialDamage(180n, 100n, 100n, 1000n, 0, 1000n);
    const ambush = calculateSpecialDamage(150n, 100n, 100n, 1000n, 0, 1000n);
    expect(crush).toBe(180n);
    expect(ambush).toBe(150n);
    expect(crush).toBeGreaterThan(ambush);
  });

  test('stat ratio cap applies to specials', () => {
    // basePower=100 * 2200(capped) * 1000 * 1000 * 1000 / 1e12 = 220
    const result = calculateSpecialDamage(100n, 10000n, 1n, 1000n, 0, 1000n);
    expect(result).toBe(220n);
  });

  test('Inferno (200) with purity 6 and advantage: max burst scenario', () => {
    // 200 * 1000 * 1250 * 1600 * 1000 / 1e12 = 400
    const result = calculateSpecialDamage(200n, 100n, 100n, 1250n, 6, 1000n);
    expect(result).toBe(400n);
  });
});

// ──────────── critChance ────────────

describe('critChance', () => {
  test('0 crit stat => 0 chance', () => {
    expect(critChance(0n)).toBe(0n);
  });

  test('200 crit stat => 5000 (50%)', () => {
    // 200 * 10000 / (200 + 200) = 2_000_000 / 400 = 5000
    expect(critChance(200n)).toBe(5000n);
  });

  test('large crit stat approaches 10000 (100%)', () => {
    // 1_000_000 * 10000 / (1_000_000 + 200) = ~9998
    const result = critChance(1_000_000n);
    expect(result).toBeGreaterThan(9990n);
    expect(result).toBeLessThan(10_000n);
  });

  test('100 crit stat => 3333 (33.33%)', () => {
    // 100 * 10000 / (100 + 200) = 1_000_000 / 300 = 3333 (truncated)
    expect(critChance(100n)).toBe(3333n);
  });

  test('90 crit stat (Bulwark base crit)', () => {
    // 90 * 10000 / (90 + 200) = 900_000 / 290 = 3103 (truncated)
    expect(critChance(90n)).toBe(3103n);
  });

  test('130 crit stat (Ember base crit)', () => {
    // 130 * 10000 / (130 + 200) = 1_300_000 / 330 = 3939 (truncated)
    expect(critChance(130n)).toBe(3939n);
  });
});

// ──────────── enhancedProcChance ────────────

describe('enhancedProcChance', () => {
  test('purity 0 => 500 (5%)', () => {
    expect(enhancedProcChance(0)).toBe(500n);
  });

  test('purity 1 => 1000 (10%)', () => {
    expect(enhancedProcChance(1)).toBe(1000n);
  });

  test('purity 3 => 2000 (20%)', () => {
    expect(enhancedProcChance(3)).toBe(2000n);
  });

  test('purity 6 => 3500 (35%)', () => {
    expect(enhancedProcChance(6)).toBe(3500n);
  });
});
