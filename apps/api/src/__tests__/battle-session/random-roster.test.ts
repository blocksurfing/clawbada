// Needs the REAL @clawbada/game-logic (no mock.module in this folder — bun module mocks are process-global).
import { describe, expect, test } from 'bun:test';
import { EvolutionTier, decodeDNA } from '@clawbada/game-logic';
import { rollRandomRoster } from '../../lib/battle-session/random-roster';

describe('rollRandomRoster', () => {
  test('three distinct classes at the tier, real DNA, purity consistent with the dominant parts', () => {
    let k = 0; const seq = [0.01, 0.99, 0.5, 0.2, 0.9, 0.6, 0.33, 0.71];
    const r = rollRandomRoster('elite', () => seq[k++ % seq.length]);
    expect(r.tier).toBe(EvolutionTier.Elite);
    expect(r.classes).toHaveLength(3);
    expect(new Set(r.classes).size).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(decodeDNA(r.dna[i]).class).toBe(r.classes[i]);
      expect(r.partClassIds[i]).toHaveLength(6);
      expect(r.partClassIds[i].filter((c) => c === r.classes[i]).length).toBe(r.purity[i]);
      expect(r.purity[i]).toBeGreaterThanOrEqual(0);
      expect(r.purity[i]).toBeLessThanOrEqual(6);
    }
  });

  test('rejects an unknown tier', () => {
    expect(() => rollRandomRoster('base')).toThrow(/unknown random tier/);
  });
});

describe('rollSpecialsRoster', () => {
  test('one lobster of each VFX-ready class, purity 3, Elite by default', async () => {
    const { rollSpecialsRoster, SPECIALS_PRESET_RE, VFX_READY_CLASSES } = await import('../../lib/battle-session/random-roster');
    const { LobsterClass } = await import('@clawbada/game-logic');
    expect(SPECIALS_PRESET_RE.test('specials')).toBe(true);
    expect(SPECIALS_PRESET_RE.test('specials_apex')).toBe(true);
    expect(SPECIALS_PRESET_RE.test('specials_base')).toBe(false);
    expect(SPECIALS_PRESET_RE.test('specials_')).toBe(false);
    // The roster is exactly the VFX-ready list, in order, so a reviewer knows what to expect.
    expect([...VFX_READY_CLASSES]).toEqual(['ember', 'tempest', 'specter']);

    const r = rollSpecialsRoster();
    expect(r.tier).toBe(EvolutionTier.Elite);
    expect(r.classes).toEqual([LobsterClass.Ember, LobsterClass.Tempest, LobsterClass.Specter]);
    expect(new Set(r.classes).size).toBe(3);
    expect(r.purity).toEqual([3, 3, 3]);
    for (let i = 0; i < 3; i++) {
      expect(decodeDNA(r.dna[i]).class).toBe(r.classes[i]);
      expect(r.partClassIds[i]).toHaveLength(6);
    }
  });

  test('honours a tier suffix and rejects an unknown tier', async () => {
    const { rollSpecialsRoster } = await import('../../lib/battle-session/random-roster');
    expect(rollSpecialsRoster('apex').tier).toBe(EvolutionTier.Apex);
    expect(rollSpecialsRoster('evolved').tier).toBe(EvolutionTier.Evolved);
    expect(() => rollSpecialsRoster('base')).toThrow(/unknown specials tier/);
  });
});

describe('rollTrioRoster', () => {
  test('three of one class at the requested tier with genetics, purity 3', async () => {
    const { rollTrioRoster, TRIO_PRESET_RE } = await import('../../lib/battle-session/random-roster');
    const { LobsterClass } = await import('@clawbada/game-logic');
    expect(TRIO_PRESET_RE.test('trio_ember')).toBe(true);
    expect(TRIO_PRESET_RE.test('trio_ember_apex')).toBe(true);
    expect(TRIO_PRESET_RE.test('trio_dragon')).toBe(false);
    const r = rollTrioRoster('ember', 'apex');
    expect(r.tier).toBe(EvolutionTier.Apex);
    expect(r.classes).toEqual([LobsterClass.Ember, LobsterClass.Ember, LobsterClass.Ember]);
    expect(r.purity).toEqual([3, 3, 3]);
    for (const p of r.partClassIds) expect(p).toHaveLength(6);
    expect(() => rollTrioRoster('dragon')).toThrow();
  });
});
