import type {
  PlaybackState,
  BattleAnimState,
  ChoreographyAction,
  ChoreographyCallbacks,
  BattleLobsterConfig,
  Position,
} from './types';
import { EASING } from './easing';
import { lerp } from './interpolation';
import {
  createHitState,
  triggerFlinch,
  applyDeathEffect,
} from './hit-reactions';

// ── Constants ──

const SPECIAL_NAMES: Record<number, string> = {
  0: 'Fortify',
  1: 'Ambush',
  2: 'Crush',
  3: 'Maelstrom',
  4: 'Haunt',
  5: 'Rally',
  6: 'Rend',
  7: 'Devour',
  8: 'Bind',
  9: 'Inferno',
};

/** Phase durations in ms (matching the rig) */
const INTRO_READY_DUR = 900;
const INTRO_GO_DUR = 600;
const HIGHLIGHT_DUR = 350;
const SPECIAL_OVERLAY_DUR = 1000;
const IMPACT_DUR = 500;
const PAUSE_DUR = 250;
const VICTORY_DUR = 2500;
const AUTO_ROUND_DELAY = 800;

/** Minimum gap between actor and target during advance (pixels) */
const ADVANCE_GAP = 38;

// ── Internal advance/retreat interpolation state ──
// Stored externally from BattleAnimState to avoid polluting the shared type.

interface AdvanceState {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
}

const _advanceState = new Map<string, AdvanceState>();

// ── Strike duration (matches rig: totalFrames / fps * 1000) ──

function getStrikeDuration(action: ChoreographyAction): number {
  if (action.moveType === 'attack') return (75 / 60) * 1000;
  if (action.moveType === 'defend') return (60 / 60) * 1000;
  if (action.moveType === 'special') return (105 / 60) * 1000;
  return 400; // stunned
}

// ── Public API ──

/** Create initial playback state. */
export function initPlaybackState(): PlaybackState {
  return {
    phase: 'idle',
    timer: 0,
    queue: [],
    queueIdx: 0,
    autoPlay: false,
    autoTimer: 0,
    _phaseDur: 0,
    currentRound: 0,
    totalRounds: 0,
  };
}

/** Create initial animation states for all 6 lobsters. */
export function initBattleAnims(
  lobsters: BattleLobsterConfig[],
  positions: { a: Position[]; b: Position[] },
): Record<string, BattleAnimState> {
  const anims: Record<string, BattleAnimState> = {};
  for (const lob of lobsters) {
    const pos = positions[lob.side][lob.slot];
    anims[lob.id] = {
      id: lob.id,
      classId: lob.classId,
      tier: lob.tier,
      side: lob.side,
      slot: lob.slot,
      anim: 'idle',
      frame: 0,
      posX: 0,
      posY: 0,
      homeX: pos.x,
      homeY: pos.y,
      hp: lob.maxHp,
      maxHp: lob.maxHp,
      charge: 0,
      alive: true,
      highlight: false,
      hit: createHitState(),
    };
  }
  _advanceState.clear();
  return anims;
}

/** Load a round's actions into the playback queue. */
export function loadRound(
  state: PlaybackState,
  actions: ChoreographyAction[],
  roundNumber: number,
  totalRounds: number,
): void {
  state.queue = actions.slice();
  state.queueIdx = 0;
  state.currentRound = roundNumber;
  state.totalRounds = totalRounds;

  if (state.queue.length > 0) {
    state.phase = 'intro_ready';
    state.timer = INTRO_READY_DUR;
  } else {
    // Empty round -- skip straight to idle
    state.phase = 'idle';
    state.autoTimer = AUTO_ROUND_DELAY;
  }
}

/** Main tick function -- advances the choreography state machine. */
export function tickChoreography(
  playback: PlaybackState,
  anims: Record<string, BattleAnimState>,
  dt: number,
  speed: number,
  callbacks: ChoreographyCallbacks,
): void {
  const pb = playback;

  // ── Idle: wait for autoPlay to trigger next round ──
  if (pb.phase === 'idle') {
    if (pb.autoPlay) {
      pb.autoTimer -= dt * speed;
      if (pb.autoTimer <= 0) {
        // Signal round complete -- the consumer should call loadRound for the next round
        callbacks.onRoundComplete(pb.currentRound, pb.totalRounds);
      }
    }
    return;
  }

  // ── Victory: count down then go idle ──
  if (pb.phase === 'victory') {
    pb.timer -= dt;
    if (pb.timer <= 0) {
      callbacks.onHideBanner();
      pb.phase = 'idle';
      pb.autoPlay = false;
    }
    return;
  }

  // Dampen speed multiplier for advance/retreat so movement looks natural even at 2x
  const isMovement = pb.phase === 'advance' || pb.phase === 'retreat';
  const speedMult = isMovement ? 1 + (speed - 1) * 0.35 : speed;
  pb.timer -= dt * speedMult;

  // ── Interpolate position during advance/retreat ──
  if (isMovement) {
    const action = pb.queue[pb.queueIdx];
    if (action) {
      const ba = anims[action.actorId];
      const adv = _advanceState.get(action.actorId);
      if (ba && adv && pb._phaseDur > 0) {
        const t = Math.max(0, Math.min(1, 1 - pb.timer / pb._phaseDur));
        const easedT = EASING.easeInOutQuad(t);
        ba.posX = lerp(adv.startX, adv.targetX, easedT);
        ba.posY = lerp(adv.startY, adv.targetY, easedT);
      }
    }
  }

  // Timer still running -- wait
  if (pb.timer > 0) return;

  // ── Handle intro phases (queue is empty during intro) ──
  if (pb.phase === 'intro_ready') {
    callbacks.onHideBanner();
    callbacks.onBanner('GO!!', 'go');
    pb.phase = 'intro_go';
    pb.timer = INTRO_GO_DUR;
    return;
  }
  if (pb.phase === 'intro_go') {
    callbacks.onHideBanner();
    // Start the first action
    if (pb.queue.length > 0) {
      pb.phase = 'highlight';
      pb.timer = HIGHLIGHT_DUR;
      highlightActor(anims, pb.queue[0]);
    } else {
      finishRound(pb, anims, callbacks);
    }
    return;
  }

  // ── Phase complete -- transition to next phase ──
  const action = pb.queue[pb.queueIdx];
  if (!action) {
    finishRound(pb, anims, callbacks);
    return;
  }

  switch (pb.phase) {
    case 'highlight': {
      if (action.moveType === 'special') {
        callbacks.onSpecialOverlay(action.actorClass);
        pb.phase = 'special_overlay';
        pb.timer = SPECIAL_OVERLAY_DUR;
      } else if (
        action.moveType === 'defend' ||
        action.moveType === 'stunned'
      ) {
        // Defend/stunned: skip advance, go straight to strike in place
        pb.phase = 'strike';
        pb.timer = getStrikeDuration(action);
        startStrike(anims, action);
      } else {
        // Attack: advance toward target
        const advDur = startAdvance(anims, action);
        pb.phase = 'advance';
        pb.timer = advDur;
        pb._phaseDur = advDur;
      }
      break;
    }

    case 'special_overlay': {
      callbacks.onHideSpecialOverlay();
      const advDur = startAdvance(anims, action);
      pb.phase = 'advance';
      pb.timer = advDur;
      pb._phaseDur = advDur;
      break;
    }

    case 'advance': {
      pb.phase = 'strike';
      pb.timer = getStrikeDuration(action);
      startStrike(anims, action);
      break;
    }

    case 'strike': {
      pb.phase = 'impact';
      pb.timer = IMPACT_DUR;
      applyImpact(anims, action, callbacks);
      applyFlinch(anims, action);
      const shakeBase = action.moveType === 'special' ? 10 : 4;
      callbacks.onScreenShake(Math.max(shakeBase, computeShake(action)));
      break;
    }

    case 'impact': {
      if (
        action.moveType === 'defend' ||
        action.moveType === 'stunned'
      ) {
        // No retreat for defend/stunned
        pb.phase = 'pause';
        pb.timer = PAUSE_DUR;
        endAction(anims, action);
      } else {
        const retDur = startRetreat(anims, action);
        pb.phase = 'retreat';
        pb.timer = retDur;
        pb._phaseDur = retDur;
      }
      break;
    }

    case 'retreat': {
      pb.phase = 'pause';
      pb.timer = PAUSE_DUR;
      endAction(anims, action);
      break;
    }

    case 'pause': {
      pb.queueIdx++;
      if (pb.queueIdx < pb.queue.length) {
        pb.phase = 'highlight';
        pb.timer = HIGHLIGHT_DUR;
        highlightActor(anims, pb.queue[pb.queueIdx]);
      } else {
        finishRound(pb, anims, callbacks);
      }
      break;
    }
  }
}

// ── Internal helpers ──

function highlightActor(
  anims: Record<string, BattleAnimState>,
  action: ChoreographyAction,
): void {
  for (const id in anims) anims[id].highlight = false;
  const ba = anims[action.actorId];
  if (ba) ba.highlight = true;
}

function startAdvance(
  anims: Record<string, BattleAnimState>,
  action: ChoreographyAction,
): number {
  const ba = anims[action.actorId];
  if (!ba) return 800;

  // Find target position to advance toward
  let targetX = 240;
  let targetY = ba.homeY; // default: arena center, same row

  if (action.targetId) {
    const target = anims[action.targetId];
    if (target) {
      targetX = target.homeX;
      targetY = target.homeY;
    }
  } else if (action.aoeDamage && action.aoeDamage.length > 0) {
    // AoE: advance toward middle enemy slot
    const firstTarget = anims[action.aoeDamage[0].targetId];
    if (firstTarget) {
      const enemySide = firstTarget.side;
      // Find middle slot (slot 1) of enemy side
      for (const id in anims) {
        if (anims[id].side === enemySide && anims[id].slot === 1) {
          targetX = anims[id].homeX;
          targetY = anims[id].homeY;
          break;
        }
      }
    }
  }

  // Stop close enough for claws to visually connect with target
  const advX =
    ba.side === 'a'
      ? targetX - ADVANCE_GAP - ba.homeX
      : targetX + ADVANCE_GAP - ba.homeX;
  const advY = targetY - ba.homeY;

  const adv: AdvanceState = {
    startX: ba.posX,
    startY: ba.posY,
    targetX: advX,
    targetY: advY,
  };
  _advanceState.set(action.actorId, adv);

  ba.anim = 'advance';
  ba.frame = 0;

  // Duration scales with distance -- slow enough to see the lobster scuttle forward
  const dist = Math.sqrt(advX * advX + advY * advY);
  return Math.max(800, Math.min(1500, dist * 5.0));
}

function startStrike(
  anims: Record<string, BattleAnimState>,
  action: ChoreographyAction,
): void {
  const ba = anims[action.actorId];
  if (!ba) return;

  if (action.moveType === 'attack') {
    ba.anim = 'attack';
    ba.frame = 0;
  } else if (action.moveType === 'defend') {
    ba.anim = 'defend';
    ba.frame = 0;
  } else if (action.moveType === 'special') {
    ba.anim = 'special';
    ba.frame = 0;
  }
  // stunned: stay idle, just show stun status
}

function applyImpact(
  anims: Record<string, BattleAnimState>,
  action: ChoreographyAction,
  callbacks: ChoreographyCallbacks,
): void {
  // Update charge display
  const aba = anims[action.actorId];
  if (aba) {
    if (action.moveType === 'attack' || action.moveType === 'defend') {
      aba.charge = Math.min(aba.charge + 1, 3);
    } else if (action.moveType === 'special') {
      aba.charge = 0;
    }
  }

  // Primary target damage
  if (action.damage > 0 && action.targetId) {
    const tba = anims[action.targetId];
    if (tba) {
      tba.hp = Math.max(0, tba.hp - action.damage);
    }
    callbacks.onDamageFloat(action.targetId, action.damage, action.crit, false);
  }

  // AoE damage (Maelstrom, etc.)
  if (action.aoeDamage) {
    for (const aoe of action.aoeDamage) {
      const tba = anims[aoe.targetId];
      if (tba) {
        tba.hp = Math.max(0, tba.hp - aoe.damage);
      }
      callbacks.onDamageFloat(aoe.targetId, aoe.damage, false, false);
    }
  }

  // Self-damage (Inferno recoil)
  if (action.selfDamage) {
    const sba = anims[action.selfDamage.targetId];
    if (sba) {
      sba.hp = Math.max(0, sba.hp - action.selfDamage.damage);
    }
    callbacks.onDamageFloat(
      action.selfDamage.targetId,
      action.selfDamage.damage,
      false,
      false,
    );
  }

  // Heals
  if (action.healed && action.healed > 0) {
    const healTargetId = action.healTargetId ?? action.actorId;
    const hba = anims[healTargetId];
    if (hba) {
      hba.hp = Math.min(hba.maxHp, hba.hp + action.healed);
    }
    callbacks.onDamageFloat(healTargetId, action.healed, false, true);
  }

  // Show status text for non-damage moves
  if (
    action.damage === 0 &&
    !action.aoeDamage &&
    (!action.healed || action.healed === 0)
  ) {
    if (action.moveType === 'defend') {
      callbacks.onStatusText(action.actorId, 'DEFEND!', '#58a6ff');
    } else if (action.moveType === 'stunned') {
      callbacks.onStatusText(action.actorId, 'STUNNED!', '#fbbf24');
    } else if (action.moveType === 'special') {
      // Utility specials like Fortify that deal no damage
      const name = SPECIAL_NAMES[action.actorClass] ?? 'SPECIAL';
      callbacks.onStatusText(action.actorId, name.toUpperCase() + '!', '#3fb9a0');
    }
  }

  // Check for deaths after all damage/heals applied
  for (const id in anims) {
    const ba2 = anims[id];
    if (ba2.hp <= 0 && ba2.alive) {
      applyDeathEffect(ba2);
      ba2.anim = 'idle';
      ba2.frame = 0;
    }
  }
}

function applyFlinch(
  anims: Record<string, BattleAnimState>,
  action: ChoreographyAction,
): void {
  function hitReaction(targetId: string, damage: number): void {
    const tba = anims[targetId];
    if (!tba || !tba.alive) return;
    tba.anim = 'defend';
    tba.frame = 0;
    const fromRight = tba.side === 'b';
    triggerFlinch(tba, damage, fromRight);
  }

  if (action.targetId && action.damage > 0) {
    hitReaction(action.targetId, action.damage);
  }
  if (action.aoeDamage) {
    for (const aoe of action.aoeDamage) {
      hitReaction(aoe.targetId, aoe.damage);
    }
  }
}

function computeShake(action: ChoreographyAction): number {
  let shake = 0;
  if (action.damage > 0) {
    shake = Math.min(action.damage / 20, 12);
    if (action.crit) shake = Math.min(shake * 1.5, 16);
  }
  if (action.aoeDamage) {
    shake = Math.max(shake, 8);
  }
  return shake;
}

function startRetreat(
  anims: Record<string, BattleAnimState>,
  action: ChoreographyAction,
): number {
  const ba = anims[action.actorId];
  if (!ba) return 800;

  ba.anim = 'retreat';
  ba.frame = 0;

  const adv: AdvanceState = {
    startX: ba.posX,
    startY: ba.posY,
    targetX: 0, // back to home offset (0,0)
    targetY: 0,
  };
  _advanceState.set(action.actorId, adv);

  // Duration scales with distance back home
  const dist = Math.sqrt(ba.posX * ba.posX + ba.posY * ba.posY);
  return Math.max(800, Math.min(1500, dist * 5.0));
}

function endAction(
  anims: Record<string, BattleAnimState>,
  action: ChoreographyAction,
): void {
  const ba = anims[action.actorId];
  if (ba) {
    ba.posX = 0;
    ba.posY = 0;
    ba.highlight = false;
    ba.anim = 'idle';
    ba.frame = 0;
  }
  _advanceState.delete(action.actorId);

  // Reset flinching targets back to idle
  if (action.targetId) {
    const tba = anims[action.targetId];
    if (tba && tba.alive) {
      tba.anim = 'idle';
      tba.frame = 0;
    }
  }
  if (action.aoeDamage) {
    for (const aoe of action.aoeDamage) {
      const tba = anims[aoe.targetId];
      if (tba && tba.alive) {
        tba.anim = 'idle';
        tba.frame = 0;
      }
    }
  }

  // Check for deaths after this action
  for (const id in anims) {
    const ba2 = anims[id];
    if (ba2.hp <= 0 && ba2.alive) {
      applyDeathEffect(ba2);
      ba2.anim = 'idle';
      ba2.frame = 0;
    }
  }
}

function finishRound(
  pb: PlaybackState,
  anims: Record<string, BattleAnimState>,
  callbacks: ChoreographyCallbacks,
): void {
  pb.phase = 'idle';
  pb.autoTimer = AUTO_ROUND_DELAY;

  // Check if all rounds are complete
  if (pb.currentRound >= pb.totalRounds) {
    // Determine winner: side with more total HP remaining
    let hpA = 0;
    let hpB = 0;
    for (const id in anims) {
      const ba = anims[id];
      if (ba.side === 'a') hpA += Math.max(0, ba.hp);
      else hpB += Math.max(0, ba.hp);
    }
    const winner = hpA >= hpB ? 'a' : 'b';

    pb.phase = 'victory';
    pb.timer = VICTORY_DUR;
    callbacks.onBanner(
      winner === 'a' ? 'VICTORY \u2014 Team A' : 'VICTORY \u2014 Team B',
      'victory',
    );
    callbacks.onBattleComplete(winner);
  }
}
