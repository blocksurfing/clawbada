/**
 * 6 mutation operations for procedural variant generation.
 *
 * Each mutation operates within a MutationZone on a PixelGrid,
 * using deterministic RNG to ensure reproducibility.
 *
 * Mutations modify a working copy of the template pixels (role-indexed grid)
 * before color resolution, so they operate on role indices, not final colors.
 */

import { NATIVE_SIZE } from '../constants';
import { randInt, randBool, randPick, subSeed } from '../utils/deterministic-rng';
import type { MutationZone, PaletteRole } from '../types';

/** A working grid of role indices. 0xFF = transparent. */
export type RoleGrid = Uint8Array;

/** Create a role grid (all transparent). */
export function createRoleGrid(): RoleGrid {
  const grid = new Uint8Array(NATIVE_SIZE * NATIVE_SIZE);
  grid.fill(0xFF);
  return grid;
}

function roleAt(grid: RoleGrid, x: number, y: number): number {
  if (x < 0 || x >= NATIVE_SIZE || y < 0 || y >= NATIVE_SIZE) return 0xFF;
  return grid[y * NATIVE_SIZE + x];
}

function setRole(grid: RoleGrid, x: number, y: number, role: number): void {
  if (x < 0 || x >= NATIVE_SIZE || y < 0 || y >= NATIVE_SIZE) return;
  grid[y * NATIVE_SIZE + x] = role;
}

function isOpaqueRole(grid: RoleGrid, x: number, y: number): boolean {
  return roleAt(grid, x, y) !== 0xFF;
}

/** Check if pixel is an edge pixel (opaque with at least one transparent 4-neighbor). */
function isEdge(grid: RoleGrid, x: number, y: number): boolean {
  if (!isOpaqueRole(grid, x, y)) return false;
  return (
    !isOpaqueRole(grid, x - 1, y) ||
    !isOpaqueRole(grid, x + 1, y) ||
    !isOpaqueRole(grid, x, y - 1) ||
    !isOpaqueRole(grid, x, y + 1)
  );
}

/** Find the most common non-outline role adjacent to a pixel (for fill inference). */
function inferRole(grid: RoleGrid, x: number, y: number): number {
  const neighbors: number[] = [];
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const r = roleAt(grid, x + dx, y + dy);
    if (r !== 0xFF && r !== 0) neighbors.push(r); // Exclude transparent and outline
  }
  if (neighbors.length === 0) return 2; // Default to primaryBase
  // Return most common
  const counts = new Map<number, number>();
  for (const r of neighbors) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let best = 2;
  let bestCount = 0;
  for (const [role, count] of counts) {
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}

// ──────────── Mutation 1: add_pixels ────────────

/**
 * Extend the silhouette at edges within the zone.
 * Adds 1-3 pixel protrusions at random edge locations.
 */
export function addPixels(grid: RoleGrid, zone: MutationZone, seed: bigint): void {
  const count = randInt(seed, 'add_count', 1, 3);

  for (let i = 0; i < count; i++) {
    const s = subSeed(seed, `add_${i}`);
    const x = randInt(s, 'x', zone.x, zone.x + zone.w - 1);
    const y = randInt(s, 'y', zone.y, zone.y + zone.h - 1);

    // Find nearest edge pixel and extend outward
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (isEdge(grid, px, py)) {
          // Find a transparent neighbor to fill
          const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          for (const [ddx, ddy] of dirs) {
            const nx = px + ddx;
            const ny = py + ddy;
            if (nx >= zone.x && nx < zone.x + zone.w &&
                ny >= zone.y && ny < zone.y + zone.h &&
                !isOpaqueRole(grid, nx, ny)) {
              setRole(grid, nx, ny, inferRole(grid, px, py));
              return; // One pixel per iteration
            }
          }
        }
      }
    }
  }
}

// ──────────── Mutation 2: remove_pixels ────────────

/**
 * Remove 1-3 edge pixels within the zone to simplify silhouette.
 */
export function removePixels(grid: RoleGrid, zone: MutationZone, seed: bigint): void {
  const count = randInt(seed, 'rem_count', 1, 3);
  const edges: [number, number][] = [];

  // Collect edge pixels in zone
  for (let y = zone.y; y < zone.y + zone.h; y++) {
    for (let x = zone.x; x < zone.x + zone.w; x++) {
      if (isEdge(grid, x, y) && roleAt(grid, x, y) !== 0) {
        edges.push([x, y]);
      }
    }
  }

  if (edges.length === 0) return;

  for (let i = 0; i < Math.min(count, edges.length); i++) {
    const idx = randInt(seed, `rem_${i}`, 0, edges.length - 1);
    const [ex, ey] = edges[idx];
    setRole(grid, ex, ey, 0xFF); // Make transparent
    edges.splice(idx, 1);
  }
}

// ──────────── Mutation 3: shift_pixels ────────────

/**
 * Shift a sub-region within the zone by 1 pixel in a random direction.
 * Creates organic asymmetry.
 */
export function shiftPixels(grid: RoleGrid, zone: MutationZone, seed: bigint): void {
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const [dx, dy] = randPick(seed, 'shift_dir', dirs);

  // Define a sub-region (half the zone)
  const halfW = Math.max(2, Math.floor(zone.w / 2));
  const halfH = Math.max(2, Math.floor(zone.h / 2));
  const sx = zone.x + randInt(seed, 'shift_sx', 0, zone.w - halfW);
  const sy = zone.y + randInt(seed, 'shift_sy', 0, zone.h - halfH);

  // Collect pixels in sub-region
  const pixels: { x: number; y: number; role: number }[] = [];
  for (let y = sy; y < sy + halfH; y++) {
    for (let x = sx; x < sx + halfW; x++) {
      const r = roleAt(grid, x, y);
      if (r !== 0xFF) {
        pixels.push({ x, y, role: r });
      }
    }
  }

  // Clear original positions
  for (const p of pixels) {
    setRole(grid, p.x, p.y, 0xFF);
  }

  // Write at shifted positions (clamped to zone)
  for (const p of pixels) {
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (nx >= zone.x && nx < zone.x + zone.w &&
        ny >= zone.y && ny < zone.y + zone.h) {
      setRole(grid, nx, ny, p.role);
    }
  }
}

// ──────────── Mutation 4: thicken ────────────

/**
 * Expand outlines inward by converting interior pixels adjacent to
 * outline (role 0) pixels to outline as well. Makes the outline thicker.
 */
export function thicken(grid: RoleGrid, zone: MutationZone, seed: bigint): void {
  const toConvert: [number, number][] = [];

  for (let y = zone.y; y < zone.y + zone.h; y++) {
    for (let x = zone.x; x < zone.x + zone.w; x++) {
      const r = roleAt(grid, x, y);
      if (r === 0xFF || r === 0) continue; // Skip transparent and outline

      // Check if adjacent to outline
      const hasOutlineNeighbor =
        roleAt(grid, x - 1, y) === 0 ||
        roleAt(grid, x + 1, y) === 0 ||
        roleAt(grid, x, y - 1) === 0 ||
        roleAt(grid, x, y + 1) === 0;

      if (hasOutlineNeighbor && randBool(seed, `thick_${x}_${y}`, 40, 100)) {
        toConvert.push([x, y]);
      }
    }
  }

  for (const [x, y] of toConvert) {
    setRole(grid, x, y, 0); // Convert to outline
  }
}

// ──────────── Mutation 5: pattern_fill ────────────

/**
 * Apply a pattern to interior pixels within the zone.
 * Patterns: dots, stripes, checkerboard. Changes roles of existing pixels.
 */
export function patternFill(grid: RoleGrid, zone: MutationZone, seed: bigint): void {
  const patternType = randInt(seed, 'pattern_type', 0, 2);
  const targetRole: PaletteRole = randPick(seed, 'pattern_role', [4, 5, 6, 7, 8, 9]) as PaletteRole;

  for (let y = zone.y; y < zone.y + zone.h; y++) {
    for (let x = zone.x; x < zone.x + zone.w; x++) {
      const r = roleAt(grid, x, y);
      if (r === 0xFF || r === 0) continue; // Skip transparent and outline

      let shouldPattern = false;

      switch (patternType) {
        case 0: // Dots (every 3rd pixel in both axes)
          shouldPattern = (x - zone.x) % 3 === 0 && (y - zone.y) % 3 === 0;
          break;
        case 1: // Horizontal stripes (every 3rd row)
          shouldPattern = (y - zone.y) % 3 === 0;
          break;
        case 2: // Checkerboard (every other pixel offset)
          shouldPattern = ((x - zone.x) + (y - zone.y)) % 2 === 0;
          break;
      }

      if (shouldPattern) {
        setRole(grid, x, y, targetRole);
      }
    }
  }
}

// ──────────── Mutation 6: detail_overlay ────────────

/**
 * Add small 2×2 or 3×3 decorative clusters at random positions within the zone.
 * Only placed on top of existing opaque pixels (doesn't expand silhouette).
 */
export function detailOverlay(grid: RoleGrid, zone: MutationZone, seed: bigint): void {
  const count = randInt(seed, 'detail_count', 1, 2);
  const detailRole: PaletteRole = randPick(seed, 'detail_role', [4, 5, 6, 7, 8, 9]) as PaletteRole;

  for (let i = 0; i < count; i++) {
    const s = subSeed(seed, `detail_${i}`);
    const size = randInt(s, 'size', 2, 3);
    const cx = randInt(s, 'cx', zone.x + 1, zone.x + zone.w - size - 1);
    const cy = randInt(s, 'cy', zone.y + 1, zone.y + zone.h - size - 1);

    // Place detail only on already-opaque, non-outline pixels
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        const r = roleAt(grid, px, py);
        if (r !== 0xFF && r !== 0) {
          setRole(grid, px, py, detailRole);
        }
      }
    }
  }
}

// ──────────── Outline auto-repair ────────────

/**
 * After mutations, ensure all edge pixels have outline role (0).
 * This prevents visual artifacts from mutations that break the outline.
 */
export function repairOutlines(grid: RoleGrid): void {
  const toOutline: [number, number][] = [];

  for (let y = 0; y < NATIVE_SIZE; y++) {
    for (let x = 0; x < NATIVE_SIZE; x++) {
      if (isEdge(grid, x, y) && roleAt(grid, x, y) !== 0) {
        toOutline.push([x, y]);
      }
    }
  }

  for (const [x, y] of toOutline) {
    setRole(grid, x, y, 0);
  }
}
