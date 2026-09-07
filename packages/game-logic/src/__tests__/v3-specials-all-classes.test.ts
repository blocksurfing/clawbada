/**
 * Every class can cast its Special at every battle tier (Evolved, Elite, Apex):
 * validateTurn accepts it, applyTurn resolves it with the expected effect kind,
 * and the charge is consumed. Guards the live loop's Special path end-to-end at
 * the rules layer (2026-09-06 playtest question: "any bugs using special?").
 */
import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { createBattle } from '../v3/sim';
import { applyTurn, validateTurn } from '../v3/turn';
import { nextActor } from '../v3/atb';
import { legalSummary } from '../v3/guard';
import { specialTargetKind } from '../v3/specials';
import type { AtbBattleState, LobsterInput } from '../v3/state';

const CLASSES = [
  LobsterClass.Bulwark, LobsterClass.Mantis, LobsterClass.Leviathan, LobsterClass.Tempest, LobsterClass.Specter,
  LobsterClass.Sentinel, LobsterClass.Reaver, LobsterClass.Abyss, LobsterClass.Kraken, LobsterClass.Ember,
];
const TIERS: Array<[EvolutionTier, 'evolved' | 'elite' | 'apex']> = [[EvolutionTier.Evolved, 'evolved'], [EvolutionTier.Elite, 'elite'], [EvolutionTier.Apex, 'apex']];

function trio(cls: LobsterClass, tier: EvolutionTier, prefix: string): LobsterInput[] {
  return [0, 1, 2].map((i) => ({ id: `${prefix}${i}`, class: cls, tier, purity: 3, legend: false }));
}

/** Open 6x5 board, actor A0 at (2,2) with enemy B0 adjacent at (3,2) and ally A1 adjacent at (2,1). */
function arrange(state: AtbBattleState): void {
  const at = (id: string, col: number, row: number) => { const l = state.lobsters.find((x) => x.id === id)!; l.pos = { col, row }; };
  at('A0', 2, 2); at('A1', 2, 1); at('A2', 0, 4); at('B0', 3, 2); at('B1', 5, 0); at('B2', 5, 4);
  for (const l of state.lobsters) { l.lastTick = l.id === 'A0' ? 0n : 1_000_000n; } // A0 acts next
  state.lobsters.find((l) => l.id === 'A0')!.charge = state.rules.specialCost;
}

describe('every class casts its Special at every battle tier', () => {
  for (const [tier, tierName] of TIERS) {
    for (const cls of CLASSES) {
      test(`${LobsterClass[cls]} @ ${tierName}`, () => {
        const layout = {
          layoutId: 'open', cols: 6, rows: 5, tier: tierName, blockedHexes: [],
          teamASpawns: [{ col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }],
          teamBSpawns: [{ col: 5, row: 1 }, { col: 5, row: 2 }, { col: 5, row: 3 }],
        } as AtbBattleState['layout'];
        const state = createBattle({ battleId: `spec-${cls}-${tierName}`, vrfSeed: 12345n + BigInt(cls), tier: tierName, teamA: trio(cls, tier, 'A'), teamB: trio(LobsterClass.Bulwark, tier, 'B'), layout });
        arrange(state);
        const actor = nextActor(state)!;
        expect(actor.id).toBe('A0');
        const kind = specialTargetKind(cls);
        const summary = legalSummary(state, actor);
        expect(summary.canSpecial).toBe(true);
        expect(summary.specialKind).toBe(kind);
        const targetId = kind === 'none' ? undefined : kind === 'ally' ? 'A1' : 'B0';
        if (kind !== 'none') expect(summary.specialTargets).toContain(targetId!);
        const cmd = { lobsterId: 'A0', action: 'special' as const, ...(targetId ? { targetId } : {}) };
        expect(() => validateTurn(state, cmd)).not.toThrow();
        const hpBefore = Object.fromEntries(state.lobsters.map((l) => [l.id, l.hp]));
        const r = applyTurn(state, cmd);
        expect(r.lobsterId).toBe('A0');
        expect(r.action).toBe('special');
        expect(r.skipped).toBeNull();
        expect(r.chargeAfter).toBe(0);
        const dmgTo = (id: string) => r.damage.filter((d) => d.targetId === id && d.kind === 'special').reduce((s, d) => s + Number(d.amount), 0);
        switch (cls) {
          case LobsterClass.Bulwark: // Fortify: team buff, no damage
            expect(r.statuses.some((s) => s.applied && s.targetId.startsWith('A'))).toBe(true);
            expect(dmgTo('B0')).toBe(0);
            break;
          case LobsterClass.Tempest: // Maelstrom: AoE — adjacent enemy hit
            expect(dmgTo('B0')).toBeGreaterThan(0);
            break;
          case LobsterClass.Sentinel: { // Rally: heals the ally (pre-damaged)
            expect(r.heals.some((h) => h.targetId === 'A1')).toBe(true);
            break;
          }
          case LobsterClass.Specter: // Haunt: damage + debuff
            expect(dmgTo('B0')).toBeGreaterThan(0);
            expect(r.statuses.some((s) => s.applied && s.targetId === 'B0')).toBe(true);
            break;
          case LobsterClass.Reaver: // Rend: hit + bleed
            expect(dmgTo('B0')).toBeGreaterThan(0);
            expect(r.statuses.some((s) => s.applied && s.targetId === 'B0')).toBe(true);
            break;
          case LobsterClass.Kraken: // Bind: damage + stun
            expect(dmgTo('B0')).toBeGreaterThan(0);
            expect(r.statuses.some((s) => s.applied && s.targetId === 'B0' && /stun/i.test(s.status))).toBe(true);
            break;
          case LobsterClass.Abyss: // Devour: damage + self heal
            expect(dmgTo('B0')).toBeGreaterThan(0);
            expect(r.heals.some((h) => h.targetId === 'A0')).toBe(true);
            break;
          case LobsterClass.Ember: // Inferno: damage + self recoil
            expect(dmgTo('B0')).toBeGreaterThan(0);
            expect(r.damage.some((d) => d.targetId === 'A0' && d.kind !== 'special')).toBe(true);
            break;
          default: // Mantis Ambush, Leviathan Crush: single-target damage
            expect(dmgTo('B0')).toBeGreaterThan(0);
        }
        const b0 = state.lobsters.find((l) => l.id === 'B0')!;
        if (dmgTo('B0') > 0) expect(b0.hp < hpBefore['B0']).toBe(true);
        expect(state.lobsters.find((l) => l.id === 'A0')!.charge).toBe(0);
      });
    }
  }

  test('Rally heals a damaged ally (Sentinel @ evolved)', () => {
    const layout = {
      layoutId: 'open', cols: 6, rows: 5, tier: 'evolved', blockedHexes: [],
      teamASpawns: [{ col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }],
      teamBSpawns: [{ col: 5, row: 1 }, { col: 5, row: 2 }, { col: 5, row: 3 }],
    } as AtbBattleState['layout'];
    const state = createBattle({ battleId: 'rally', vrfSeed: 7n, tier: 'evolved', teamA: trio(LobsterClass.Sentinel, EvolutionTier.Evolved, 'A'), teamB: trio(LobsterClass.Bulwark, EvolutionTier.Evolved, 'B'), layout });
    arrange(state);
    const ally = state.lobsters.find((l) => l.id === 'A1')!;
    ally.hp = ally.maxHp / 2n;
    const r = applyTurn(state, { lobsterId: 'A0', action: 'special', targetId: 'A1' });
    expect(r.heals.find((h) => h.targetId === 'A1')!.amount > 0n).toBe(true);
    expect(ally.hp > ally.maxHp / 2n).toBe(true);
  });
});
