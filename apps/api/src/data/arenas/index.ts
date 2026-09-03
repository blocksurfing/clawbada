import arena_evolved_01 from './arena_evolved_01.json';
import arena_evolved_02 from './arena_evolved_02.json';
import arena_evolved_03 from './arena_evolved_03.json';
import arena_elite_01 from './arena_elite_01.json';
import arena_elite_02 from './arena_elite_02.json';
import arena_elite_03 from './arena_elite_03.json';
import arena_apex_01 from './arena_apex_01.json';
import arena_apex_02 from './arena_apex_02.json';
import arena_apex_03 from './arena_apex_03.json';

export type BattleTier = 'evolved' | 'elite' | 'apex';

export interface HexPosition {
  col: number;
  row: number;
}

export interface ArenaLayout {
  layoutId: string;
  cols: number;
  rows: number;
  tier: BattleTier;
  blockedHexes: HexPosition[];
  teamASpawns: HexPosition[];
  teamBSpawns: HexPosition[];
}

const allLayouts: ArenaLayout[] = [
  arena_evolved_01 as ArenaLayout,
  arena_evolved_02 as ArenaLayout,
  arena_evolved_03 as ArenaLayout,
  arena_elite_01 as ArenaLayout,
  arena_elite_02 as ArenaLayout,
  arena_elite_03 as ArenaLayout,
  arena_apex_01 as ArenaLayout,
  arena_apex_02 as ArenaLayout,
  arena_apex_03 as ArenaLayout,
];

export const arenaLayouts: Record<string, ArenaLayout> = Object.fromEntries(
  allLayouts.map((l) => [l.layoutId, l]),
);

export function getLayoutsForTier(tier: BattleTier): ArenaLayout[] {
  return allLayouts.filter((l) => l.tier === tier);
}

export function getLayoutById(id: string): ArenaLayout | undefined {
  return arenaLayouts[id];
}

export function pickRandomLayout(tier: BattleTier): ArenaLayout {
  const options = getLayoutsForTier(tier);
  if (options.length === 0) {
    throw new Error(`No arena layouts defined for tier: ${tier}`);
  }
  return options[Math.floor(Math.random() * options.length)]!;
}
