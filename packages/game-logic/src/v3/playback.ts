/**
 * How long the browser takes to PLAY one resolved turn (smoothness campaign 2026-11-04). The server arms a human's shot
 * clock when their turn starts, but the battle page shows that turn only after every earlier turn has finished animating;
 * the session adds the queued playback this estimates to the deadline, so animation never eats the player's 60 s.
 *
 * It mirrors the Unity player (BattleManager, shipped BattleScene values): walks at 0.45 s a hex, the swing or Special,
 * the longest death, a stun skip's hold, the beat between actions. Per-class swing and Special times are MEASURED on
 * production (scripts/harness/perf-battle.ts, Unity's per-turn segments, p90). Over-estimating only gives a player a
 * few hidden seconds; under-estimating costs them time, so the total carries a margin.
 */
import { LobsterClass } from '../types';
import type { AtbBattleState, TurnResult } from './state';

/** Seconds per hex walked (BattleManager.secondsPerHexMove). */
export const PLAYBACK_WALK_MS_PER_HEX = 450;
/** A stunned lobster's skipped turn (BattleManager.stunSkipHold). */
export const PLAYBACK_STUN_SKIP_MS = 1200;
/** Extra when the turn kills: the turn waits for the longest Die clip (deathDuration floor 0.9 s). */
export const PLAYBACK_DEATH_MS = 1200;
/** The beat between one turn's playback and the next (BattleManager.delayBetweenActions). */
export const PLAYBACK_GAP_MS = 200;
export const PLAYBACK_DEFEND_MS = 450;   // measured: every class's in-place Defend plays in 450 ms
export const PLAYBACK_PASS_MS = 200;
/** Hit feel (2026-11-09, Unity HitFeel): the attacker and target hold on the contact frame — about 85 ms for a hit,
 *  170 ms for a crit — and a killing blow holds 250 ms and starts the fall in slow motion (+300 ms). */
export const PLAYBACK_HITSTOP_MS = 100;
export const PLAYBACK_HITSTOP_CRIT_MS = 100;
export const PLAYBACK_HITSTOP_KILL_MS = 550;
/** Safety margin on the total, and the most one turn can add. */
export const PLAYBACK_MARGIN = 1.15;
export const PLAYBACK_TURN_CAP_MS = 8000;

/** Attack playback per class (ms) without the walk — measured on production 2026-11-04 (scripts/harness/perf-battle.ts,
 *  10 Elite Dojo battles, 916 turn segments; the no-walk level of each class's segments). Tempest and Sentinel never
 *  attacked in the run: conservative values. */
export const PLAYBACK_ATTACK_MS: Record<LobsterClass, number> = {
  [LobsterClass.Bulwark]: 1250, [LobsterClass.Mantis]: 1850, [LobsterClass.Leviathan]: 1350, [LobsterClass.Tempest]: 1400,
  [LobsterClass.Specter]: 850, [LobsterClass.Sentinel]: 1400, [LobsterClass.Reaver]: 1700, [LobsterClass.Abyss]: 1250,
  [LobsterClass.Kraken]: 850, [LobsterClass.Ember]: 1420,
};

/** Special playback per class (ms) without the walk, same run. Sentinel's Rally never fired: conservative value. Tempest's
 *  Maelstrom was the long one (~5.2 s); Nzib trimmed 2 s of build-up (2026-11-06) and it now plays ~3.4 s. */
export const PLAYBACK_SPECIAL_MS: Record<LobsterClass, number> = {
  [LobsterClass.Bulwark]: 2770, [LobsterClass.Mantis]: 1850, [LobsterClass.Leviathan]: 1450, [LobsterClass.Tempest]: 3450,
  [LobsterClass.Specter]: 1700, [LobsterClass.Sentinel]: 3000, [LobsterClass.Reaver]: 1900, [LobsterClass.Abyss]: 3700,
  [LobsterClass.Kraken]: 2350, [LobsterClass.Ember]: 4100,
};

/** Estimated ms for the browser to play `result` (a resolved turn of `state`). 0 for the forfeit terminator. */
export function playbackEstimateMs(result: TurnResult, state: AtbBattleState): number {
  if (!result.lobsterId) return 0;
  const actor = state.lobsters.find(l => l.id === result.lobsterId);
  let ms = PLAYBACK_GAP_MS;
  if (result.skipped === 'stun') ms += PLAYBACK_STUN_SKIP_MS;
  else {
    // The path lists every hex stepped onto (board.shortestPath leaves the start out).
    ms += result.path.length * PLAYBACK_WALK_MS_PER_HEX;
    const cls = actor?.class;
    switch (result.action) {
      case 'attack': ms += cls !== undefined ? PLAYBACK_ATTACK_MS[cls] : 1500; break;
      case 'special': ms += cls !== undefined ? PLAYBACK_SPECIAL_MS[cls] : 4000; break;
      case 'defend': ms += PLAYBACK_DEFEND_MS; break;
      case 'none': ms += PLAYBACK_PASS_MS; break;
      default: break;
    }
  }
  if (result.damage.some(d => d.amount > 0n)) ms += PLAYBACK_HITSTOP_MS;
  if (result.damage.some(d => d.isCrit)) ms += PLAYBACK_HITSTOP_CRIT_MS;
  if (result.damage.some(d => d.killed)) ms += PLAYBACK_DEATH_MS + PLAYBACK_HITSTOP_KILL_MS;
  return Math.min(PLAYBACK_TURN_CAP_MS, Math.round(ms * PLAYBACK_MARGIN));
}
