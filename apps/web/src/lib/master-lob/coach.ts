/**
 * Master Lob, the Dojo coach (owner 2026-10-31): WHEN he speaks and WHAT he says. Unity (MasterLobCoach.cs) decides
 * where he stands and plays him; this decides the rest, from the live battle snapshot.
 *
 *   When  — at the start of the player's own turns (they have the shot clock to read): their first turn, then every
 *           2–4 of their turns. Never on the bot's turn, never while earlier turns are still animating.
 *   What  — a situational tip when something teachable is happening right now (a Special is ready, the target has the
 *           class edge, a lobster is in danger…), each at most once a battle; otherwise the next unseen tip of the
 *           Beginner → Intermediate → Advanced curriculum, skipping class tips for classes not on the player's team.
 *           Seen tips are remembered across battles; when every relevant one has been seen, the curriculum starts over.
 */
import { LobsterClass, type v3 } from '@clawbada/game-logic';

export type TipTier = 'beginner' | 'intermediate' | 'advanced';

/** A lobster's class as the lowercase name the tips use ('bulwark' … 'ember'). */
export const classOf = (l: { class: LobsterClass }): string => LobsterClass[l.class].toLowerCase();
export const TIER_ORDER: readonly TipTier[] = ['beginner', 'intermediate', 'advanced'];

/** What a situational tip can look at: the battle state, the player's acting lobster, both teams. */
export interface CoachContext {
  state: v3.AtbBattleState;
  actor: v3.AtbLobster;
  mine: v3.AtbLobster[];
  enemies: v3.AtbLobster[];
}

export interface CoachTip {
  id: string;
  tier: TipTier;
  /** What he says: plain language, ≤ 160 characters (his bubble pages long tips). */
  text: string;
  /** Lowercase class names when the tip is about specific classes (shown only with one of them on the team). */
  classes?: readonly string[];
  /** A situational tip: shown when this holds at the start of the player's turn (once a battle). */
  when?: (ctx: CoachContext) => boolean;
}

/** The player's turns between appearances (inclusive range). */
export const GAP_TURNS: readonly [number, number] = [2, 4];

/** Decides on which of the player's turns he appears: the first, then every GAP_TURNS. */
export class CoachCadence {
  private next = 1;
  private count = 0;
  constructor(private readonly random: () => number = Math.random) {}
  /** Call once per player turn; true when he should try to speak on it. */
  onPlayerTurn(): boolean {
    this.count++;
    return this.count >= this.next;
  }
  /** He spoke (or the moment was refused and we skip this turn): schedule the next appearance. */
  spoke(): void {
    const [lo, hi] = GAP_TURNS;
    this.next = this.count + lo + Math.floor(this.random() * (hi - lo + 1));
  }
  /** Unity could not place him (no free hex): try again on the next turn. */
  retryNext(): void {
    this.next = this.count + 1;
  }
}

/** Pick what he says now. `seen` persists across battles; `shownThisBattle` stops repeats within one. */
export function chooseTip(
  tips: readonly CoachTip[],
  ctx: CoachContext | null,
  teamClasses: ReadonlySet<string>,
  seen: ReadonlySet<string>,
  shownThisBattle: ReadonlySet<string>,
): CoachTip | null {
  const relevant = (t: CoachTip) => !t.classes || t.classes.some((c) => teamClasses.has(c));
  // 1. Something teachable right now.
  if (ctx) {
    for (const t of tips) {
      if (!t.when || shownThisBattle.has(t.id) || !relevant(t)) continue;
      try { if (t.when(ctx)) return t; } catch { /* a trigger that can't read this state just doesn't fire */ }
    }
  }
  // 2. The curriculum, in tier order; the first relevant tip not seen yet (in any battle).
  const curriculum = tips.filter((t) => !t.when && relevant(t));
  for (const tier of TIER_ORDER) {
    const next = curriculum.find((t) => t.tier === tier && !seen.has(t.id) && !shownThisBattle.has(t.id));
    if (next) return next;
  }
  // 3. Everything seen: start over, still never repeating within this battle.
  return curriculum.find((t) => !shownThisBattle.has(t.id)) ?? null;
}

// ─── Persistence ───

export const SEEN_KEY = 'clawbada_master_lob_seen';

export function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

export function saveSeen(seen: ReadonlySet<string>): void {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* private mode */ }
}

/** The curriculum starts over once every relevant curriculum tip has been seen. */
export function resetIfExhausted(tips: readonly CoachTip[], teamClasses: ReadonlySet<string>, seen: Set<string>): void {
  const relevant = tips.filter((t) => !t.when && (!t.classes || t.classes.some((c) => teamClasses.has(c))));
  if (relevant.length && relevant.every((t) => seen.has(t.id))) seen.clear();
}
