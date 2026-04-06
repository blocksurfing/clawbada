import type { TeamPositions, CustomPositions } from './types';

/** Canonical arena dimensions (internal coordinate space) */
export const CANVAS_W = 480;
export const CANVAS_H = 270;

/** Sprite size in canonical coords */
export const SPRITE_SIZE = 64;

/**
 * Default team positions per tier (1-3) per scene (0-1).
 * Coordinates are top-left of each 64×64 lobster sprite in 480×270 space.
 * Team A on left, Team B on right — each team has 3 slots.
 */
export const TEAM_POS: Record<number, TeamPositions[]> = {
  1: [
    // Evolved — Scene 0: beach, centered in lower sand pit
    {
      a: [{ x: 100, y: 168 }, { x: 130, y: 196 }, { x: 100, y: 224 }],
      b: [{ x: 320, y: 168 }, { x: 290, y: 196 }, { x: 320, y: 224 }],
    },
    // Evolved — Scene 1: underwater reef, oval stone arena
    {
      a: [{ x: 100, y: 160 }, { x: 130, y: 188 }, { x: 100, y: 216 }],
      b: [{ x: 320, y: 160 }, { x: 290, y: 188 }, { x: 320, y: 216 }],
    },
  ],
  2: [
    // Elite — Scene 0: jellyfish deep sea, teams inside glowing ring
    {
      a: [{ x: 110, y: 155 }, { x: 140, y: 183 }, { x: 110, y: 211 }],
      b: [{ x: 310, y: 155 }, { x: 280, y: 183 }, { x: 310, y: 211 }],
    },
    // Elite — Scene 1: deep sea bioluminescent, glowing ring platform
    {
      a: [{ x: 100, y: 155 }, { x: 130, y: 188 }, { x: 100, y: 221 }],
      b: [{ x: 320, y: 155 }, { x: 290, y: 188 }, { x: 320, y: 221 }],
    },
  ],
  3: [
    // Apex — Scene 0: volcanic caldera, top anchored
    {
      a: [{ x: 105, y: 155 }, { x: 130, y: 183 }, { x: 105, y: 211 }],
      b: [{ x: 315, y: 155 }, { x: 290, y: 183 }, { x: 315, y: 211 }],
    },
    // Apex — Scene 1
    {
      a: [{ x: 105, y: 155 }, { x: 130, y: 183 }, { x: 105, y: 211 }],
      b: [{ x: 315, y: 155 }, { x: 290, y: 183 }, { x: 315, y: 211 }],
    },
  ],
};

/** Resolve team positions for a given tier + scene, with optional custom overrides. */
export function getTeamPos(
  tier: number,
  scene: number,
  custom?: CustomPositions,
): TeamPositions {
  const key = `${tier}:${scene}`;
  if (custom?.[key]) return custom[key];
  const tierScenes = TEAM_POS[tier] || TEAM_POS[1];
  return tierScenes[scene] || tierScenes[0];
}

/** Load custom positions from a JSON file (fetched at runtime from /data/arena-positions.json). */
let _customPositionsCache: CustomPositions | null = null;

export async function loadCustomPositions(): Promise<CustomPositions> {
  if (_customPositionsCache) return _customPositionsCache;
  try {
    const res = await fetch('/data/arena-positions.json');
    if (res.ok) {
      _customPositionsCache = (await res.json()) as CustomPositions;
      return _customPositionsCache;
    }
  } catch {
    // Fall back to defaults — no custom positions file yet
  }
  _customPositionsCache = {};
  return _customPositionsCache;
}
