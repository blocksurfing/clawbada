/**
 * The Dojo's pure helpers, ported from Nzib's workbench (`design/website/workbench/components/dojo.js`, drop 5cb6655):
 * the three-slot lineup edits (click toggle, drag replace / swap / remove), the purity line and the summary.
 * Slots hold lobster token ids; '' is an empty slot.
 */
export type Slots = readonly [string, string, string];
export const EMPTY_SLOTS: Slots = ['', '', ''];

const asSlots = (ids: readonly string[]): Slots => [ids[0] ?? '', ids[1] ?? '', ids[2] ?? ''];

/** Click on a tile: a picked lobster leaves (the rest close ranks), a new one takes the first free slot.
 *  `full` = the team already has three, so nothing changed. */
export function toggleSlot(slots: Slots, id: string): { slots: Slots; full: boolean } {
  if (slots.includes(id)) return { slots: compactSlots(slots.filter((s) => s !== id)), full: false };
  const free = slots.indexOf('');
  if (free < 0) return { slots, full: true };
  const next = [...slots];
  next[free] = id;
  return { slots: asSlots(next), full: false };
}

/** Drop `id` on slot `slot`: a lobster already in the lineup swaps places with whatever is there; one from the
 *  inventory replaces it. */
export function dropOnSlot(slots: Slots, id: string, slot: number): Slots {
  if (slot < 0 || slot > 2) return slots;
  const next = [...slots];
  const previous = next.indexOf(id);
  if (previous >= 0) next[previous] = next[slot];
  next[slot] = id;
  return asSlots(next);
}

/** A lineup lobster dragged back onto the inventory leaves the team; the rest close ranks. */
export function removeFromSlots(slots: Slots, id: string): Slots {
  return compactSlots(slots.filter((s) => s !== id));
}

export function compactSlots(ids: readonly string[]): Slots {
  return asSlots(ids.filter(Boolean));
}

/** Three distinct lobsters. */
export function slotsComplete(slots: Slots): boolean {
  return slots.every(Boolean) && new Set(slots).size === 3;
}

export function purityDescription(purity: number): string {
  return `Specials hit ${100 + purity * 10}% as hard and fire their enhanced version ${5 + purity * 5}% of the time.`;
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The visible status line under the cards. The builder's format is the one the harness waits for:
 *  "Bulwark · Leviathan · Sentinel, Evolved, purity 2 vs Charger". */
export function builderSummary(team: readonly string[], tier: string, purity: number, botLabel: string): string {
  return `${team.map(title).join(' · ')}, ${title(tier)}, purity ${purity} vs ${botLabel}`;
}

export function ownedSummary(names: readonly string[], teamId: string | null, botLabel: string): string {
  return `${teamId ? `Team #${teamId}: ` : ''}${names.join(' · ')} vs ${botLabel}`;
}

/** Inventory pages of ten (two rows of five), as in the drop. */
export const INVENTORY_PAGE_SIZE = 10;
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
}
