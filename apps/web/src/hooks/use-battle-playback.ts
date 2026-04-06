'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type {
  BattleLobsterConfig,
  BattleViewState,
  BattleAnimState,
  ChoreographyCallbacks,
  ChoreographyAction,
  ChoreographyPhase,
  AnimationName,
} from '@/lib/battle-anim/types';
import { getTeamPos } from '@/lib/battle-anim/positions';
import {
  createHitState,
  triggerFlinch,
  applyDeathEffect,
  tickHitReactions,
} from '@/lib/battle-anim/hit-reactions';
import { ANIMATIONS, ANIM_PROPERTIES } from '@/lib/battle-anim/animations';

// ── Round data shape (from API) ──

interface RoundAction {
  actorTeam: string;
  actorSlot: number;
  moveType: number;
  targetSlot: number;
  damage: string;
  isCrit: boolean;
  isEnhanced: boolean;
}

interface RoundData {
  round: number;
  actions: RoundAction[];
  teamAHp: string[];
  teamBHp: string[];
}

// ── Options ──

interface UseBattlePlaybackOptions {
  rounds: RoundData[];
  lobsters: BattleLobsterConfig[];
  tier: number;
  scene: number;
  autoPlay?: boolean;
  speed?: number;
}

// ── Return ──

interface UseBattlePlaybackReturn {
  stateRef: React.MutableRefObject<BattleViewState | null>;
  callbacksRef: React.MutableRefObject<Partial<ChoreographyCallbacks>>;
  controls: {
    play(): void;
    pause(): void;
    togglePlay(): void;
    nextRound(): void;
    prevRound(): void;
    setSpeed(speed: number): void;
  };
  isPlaying: boolean;
  currentRound: number;
  totalRounds: number;
  phase: string;
}

// ── Phase durations (ms) ──

const PHASE_DURATIONS: Record<string, number> = {
  idle: 500,
  intro_ready: 1000,
  intro_go: 600,
  highlight: 300,
  special_overlay: 800,
  advance: 400,
  strike: 350,
  impact: 400,
  retreat: 350,
  pause: 300,
  victory: 2000,
};

// ── Helpers ──

const MOVE_TYPE_MAP: Record<number, 'attack' | 'defend' | 'special'> = {
  0: 'attack',
  1: 'defend',
  2: 'special',
};

function oppositeTeam(team: string): string {
  return team.toLowerCase() === 'a' ? 'b' : 'a';
}

function convertAction(
  action: RoundAction,
  lobsters: BattleLobsterConfig[],
): ChoreographyAction {
  const actorTeamLower = action.actorTeam.toLowerCase();
  const actorId = `${actorTeamLower}${action.actorSlot}`;
  const opp = oppositeTeam(action.actorTeam);
  const targetId = `${opp}${action.targetSlot}`;

  const actorLobster = lobsters.find((l) => l.id === actorId);

  return {
    actorId,
    actorClass: actorLobster?.classId ?? 0,
    moveType: MOVE_TYPE_MAP[action.moveType] ?? 'attack',
    targetId,
    damage: parseInt(action.damage, 10) || 0,
    crit: action.isCrit,
    enhanced: action.isEnhanced,
  };
}

function initAnimState(
  lobster: BattleLobsterConfig,
  homeX: number,
  homeY: number,
): BattleAnimState {
  return {
    id: lobster.id,
    classId: lobster.classId,
    tier: lobster.tier,
    side: lobster.side,
    slot: lobster.slot,
    anim: 'idle' as AnimationName,
    frame: 0,
    posX: homeX,
    posY: homeY,
    homeX,
    homeY,
    hp: lobster.maxHp,
    maxHp: lobster.maxHp,
    charge: 0,
    alive: true,
    highlight: false,
    hit: createHitState(),
  };
}

function initViewState(
  lobsters: BattleLobsterConfig[],
  tier: number,
  scene: number,
  totalRounds: number,
  autoPlay: boolean,
): BattleViewState {
  const positions = getTeamPos(tier, scene);
  const anims: Record<string, BattleAnimState> = {};

  for (const lobster of lobsters) {
    const posArray =
      lobster.side === 'a' ? positions.a : positions.b;
    const pos = posArray[lobster.slot] ?? { x: 0, y: 0 };
    anims[lobster.id] = initAnimState(lobster, pos.x, pos.y);
  }

  const lobsterOrder = Object.keys(anims).sort(
    (a, b) => anims[a].posY - anims[b].posY,
  );

  return {
    anims,
    playback: {
      phase: 'idle' as ChoreographyPhase,
      timer: 0,
      queue: [],
      queueIdx: 0,
      autoPlay,
      autoTimer: 0,
      _phaseDur: PHASE_DURATIONS.idle,
      currentRound: 0,
      totalRounds,
    },
    effects: [],
    shakeAmount: 0,
    lobsterOrder,
  };
}

// ── Choreography tick logic ──

function getNextPhase(current: ChoreographyPhase, action: ChoreographyAction | null): ChoreographyPhase {
  if (!action) return 'idle';

  switch (current) {
    case 'idle':
    case 'intro_ready':
      return 'intro_go';
    case 'intro_go':
      return 'highlight';
    case 'highlight':
      return action.moveType === 'special' ? 'special_overlay' : 'advance';
    case 'special_overlay':
      return 'advance';
    case 'advance':
      return 'strike';
    case 'strike':
      return 'impact';
    case 'impact':
      return 'retreat';
    case 'retreat':
      return 'pause';
    case 'pause':
      return 'idle'; // will pick up next action
    case 'victory':
      return 'victory'; // terminal
    default:
      return 'idle';
  }
}

function setAnimForPhase(
  state: BattleViewState,
  phase: ChoreographyPhase,
  action: ChoreographyAction | null,
): void {
  if (!action) return;

  const actor = state.anims[action.actorId];
  if (!actor) return;

  switch (phase) {
    case 'advance':
      actor.anim = 'advance';
      actor.frame = 0;
      break;
    case 'strike':
      actor.anim = action.moveType === 'defend' ? 'defend' : action.moveType === 'special' ? 'special' : 'attack';
      actor.frame = 0;
      break;
    case 'impact': {
      // Apply damage to target
      const target = state.anims[action.targetId];
      if (target && target.alive) {
        target.hp = Math.max(0, target.hp - action.damage);
        const fromRight = actor.side === 'b';
        triggerFlinch(target, action.damage, fromRight);
        if (target.hp <= 0) {
          applyDeathEffect(target);
        }
      }
      break;
    }
    case 'retreat':
      actor.anim = 'retreat';
      actor.frame = 0;
      break;
    default:
      break;
  }
}

function tickAnimFrames(state: BattleViewState, dt: number): void {
  for (const id of state.lobsterOrder) {
    const anim = state.anims[id];
    if (!anim) continue;

    // Tick hit reactions
    tickHitReactions(anim, dt);

    // Advance animation frame
    const animDef = ANIMATIONS[anim.anim];
    if (!animDef) continue;

    const frameDelta = (dt / 1000) * animDef.fps;
    anim.frame += frameDelta;

    const props = ANIM_PROPERTIES[anim.anim];
    if (props.loop) {
      anim.frame = anim.frame % animDef.totalFrames;
    } else if (anim.frame >= animDef.totalFrames) {
      // Animation complete, return to idle (or specified)
      const returnTo = (props.returnTo ?? 'idle') as AnimationName;
      anim.anim = returnTo;
      anim.frame = 0;
    }
  }
}

function tickPlayback(
  state: BattleViewState,
  dt: number,
  callbacks: Partial<ChoreographyCallbacks>,
  speed: number,
): void {
  const pb = state.playback;
  const scaledDt = dt * speed;

  pb.timer -= scaledDt;

  // Shake decay
  state.shakeAmount *= Math.pow(0.9, scaledDt / 16);
  if (state.shakeAmount < 0.5) state.shakeAmount = 0;

  if (pb.timer > 0) return;

  // Phase just completed — transition
  const currentAction: ChoreographyAction | null =
    pb.queue[pb.queueIdx] ?? null;

  // Fire callbacks for completed phase
  switch (pb.phase) {
    case 'intro_ready':
      callbacks.onBanner?.('READY', 'ready');
      break;
    case 'intro_go':
      callbacks.onBanner?.('GO!', 'go');
      setTimeout(() => callbacks.onHideBanner?.(), 400);
      break;
    case 'impact':
      if (currentAction && currentAction.damage > 0) {
        callbacks.onDamageFloat?.(
          currentAction.targetId,
          currentAction.damage,
          currentAction.crit,
          false,
        );
        if (currentAction.crit) {
          state.shakeAmount = 6;
          callbacks.onScreenShake?.(6);
        } else if (currentAction.damage > 100) {
          state.shakeAmount = 3;
          callbacks.onScreenShake?.(3);
        }
      }
      break;
    case 'special_overlay':
      if (currentAction) {
        callbacks.onSpecialOverlay?.(currentAction.actorClass);
        setTimeout(() => callbacks.onHideSpecialOverlay?.(), 600);
      }
      break;
    case 'pause':
      // Move to next action in queue
      pb.queueIdx++;
      break;
    default:
      break;
  }

  // Check if we're done with the current round's actions
  if (pb.queueIdx >= pb.queue.length && pb.phase === 'idle') {
    // Check for victory
    const teamAAlive = Object.values(state.anims).some(
      (a) => a.side === 'a' && a.alive,
    );
    const teamBAlive = Object.values(state.anims).some(
      (a) => a.side === 'b' && a.alive,
    );

    if (!teamAAlive || !teamBAlive) {
      pb.phase = 'victory';
      pb.timer = PHASE_DURATIONS.victory;
      pb._phaseDur = PHASE_DURATIONS.victory;
      const winner = teamAAlive ? 'a' : 'b';
      callbacks.onBanner?.('VICTORY', 'victory');
      callbacks.onBattleComplete?.(winner);
      return;
    }

    // Round is complete if queue is exhausted — wait for next round load
    if (pb.currentRound > 0) {
      callbacks.onRoundComplete?.(pb.currentRound, pb.totalRounds);
    }

    // Auto-advance to next round
    if (pb.autoPlay && pb.currentRound < pb.totalRounds) {
      pb.autoTimer -= scaledDt;
      if (pb.autoTimer <= 0) {
        // Signal that we're ready for next round — handled externally
      }
    }
    return;
  }

  // Determine next phase
  const nextPhase = getNextPhase(pb.phase, currentAction);

  // Apply animation changes for the new phase
  setAnimForPhase(state, nextPhase, currentAction);

  pb.phase = nextPhase;
  pb.timer = PHASE_DURATIONS[nextPhase] ?? 300;
  pb._phaseDur = pb.timer;
}

// ── Hook ──

export function useBattlePlayback(
  options: UseBattlePlaybackOptions,
): UseBattlePlaybackReturn {
  const { rounds, lobsters, tier, scene, autoPlay = false, speed: initialSpeed = 1 } = options;

  const stateRef = useRef<BattleViewState | null>(null);
  const callbacksRef = useRef<Partial<ChoreographyCallbacks>>({});
  const speedRef = useRef(initialSpeed);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  // Coarse UI state — updated at throttled intervals, not every frame
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentRound, setCurrentRound] = useState(0);
  const [phase, setPhase] = useState<string>('idle');
  const uiUpdateRef = useRef(0);

  const totalRounds = rounds.length;

  // Initialize state
  useEffect(() => {
    stateRef.current = initViewState(lobsters, tier, scene, totalRounds, autoPlay);

    // Start with intro if autoPlay
    if (autoPlay && rounds.length > 0) {
      loadRoundIntoState(stateRef.current, rounds[0], lobsters);
      stateRef.current.playback.phase = 'intro_ready';
      stateRef.current.playback.timer = PHASE_DURATIONS.intro_ready;
      stateRef.current.playback._phaseDur = PHASE_DURATIONS.intro_ready;
      stateRef.current.playback.currentRound = 1;
      setCurrentRound(1);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobsters, tier, scene, totalRounds]);

  // rAF loop
  useEffect(() => {
    if (!isPlaying) {
      lastTimeRef.current = 0;
      return;
    }

    const tick = (timestamp: number) => {
      if (!stateRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(timestamp - lastTimeRef.current, 50); // cap at 50ms to prevent jumps
      lastTimeRef.current = timestamp;

      const state = stateRef.current;

      // Tick animation frames
      tickAnimFrames(state, dt);

      // Tick choreography
      tickPlayback(state, dt, callbacksRef.current, speedRef.current);

      // Auto-advance rounds
      const pb = state.playback;
      if (
        pb.autoPlay &&
        pb.queueIdx >= pb.queue.length &&
        pb.phase === 'idle' &&
        pb.currentRound < pb.totalRounds
      ) {
        const nextRoundIdx = pb.currentRound; // 0-indexed in rounds array
        if (nextRoundIdx < rounds.length) {
          loadRoundIntoState(state, rounds[nextRoundIdx], lobsters);
          pb.currentRound = nextRoundIdx + 1;
          pb.phase = 'highlight';
          pb.timer = PHASE_DURATIONS.highlight;
          pb._phaseDur = PHASE_DURATIONS.highlight;
        }
      }

      // Throttled UI state updates (~10fps)
      uiUpdateRef.current += dt;
      if (uiUpdateRef.current > 100) {
        uiUpdateRef.current = 0;
        setCurrentRound(pb.currentRound);
        setPhase(pb.phase);

        // Stop if battle complete
        if (pb.phase === 'victory') {
          setIsPlaying(false);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // ── Controls ──

  const play = useCallback(() => {
    if (!stateRef.current) return;
    stateRef.current.playback.autoPlay = true;
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    if (!stateRef.current) return;
    stateRef.current.playback.autoPlay = false;
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const nextRound = useCallback(() => {
    if (!stateRef.current) return;
    const pb = stateRef.current.playback;
    const nextIdx = pb.currentRound; // currentRound is 1-indexed, rounds array is 0-indexed
    if (nextIdx >= rounds.length) return;

    loadRoundIntoState(stateRef.current, rounds[nextIdx], lobsters);
    pb.currentRound = nextIdx + 1;
    pb.phase = 'highlight';
    pb.timer = PHASE_DURATIONS.highlight;
    pb._phaseDur = PHASE_DURATIONS.highlight;
    pb.queueIdx = 0;
    setCurrentRound(pb.currentRound);
    setPhase('highlight');
    if (!isPlaying) setIsPlaying(true);
  }, [rounds, lobsters, isPlaying]);

  const prevRound = useCallback(() => {
    if (!stateRef.current) return;
    const pb = stateRef.current.playback;
    if (pb.currentRound <= 1) return;

    // Reset all lobster state and replay up to previous round
    const prevRoundIdx = pb.currentRound - 2; // go back one round (0-indexed)

    // Re-initialize all lobster HP/alive state
    const positions = getTeamPos(tier, scene);
    for (const lobster of lobsters) {
      const posArray = lobster.side === 'a' ? positions.a : positions.b;
      const pos = posArray[lobster.slot] ?? { x: 0, y: 0 };
      stateRef.current.anims[lobster.id] = initAnimState(lobster, pos.x, pos.y);
    }

    // Replay damage from round 0 up to prevRoundIdx (exclusive)
    for (let i = 0; i < prevRoundIdx; i++) {
      applyRoundDamage(stateRef.current, rounds[i], lobsters);
    }

    // Load the target round
    loadRoundIntoState(stateRef.current, rounds[prevRoundIdx], lobsters);
    pb.currentRound = prevRoundIdx + 1;
    pb.phase = 'highlight';
    pb.timer = PHASE_DURATIONS.highlight;
    pb._phaseDur = PHASE_DURATIONS.highlight;
    pb.queueIdx = 0;
    setCurrentRound(pb.currentRound);
    setPhase('highlight');
    if (!isPlaying) setIsPlaying(true);
  }, [rounds, lobsters, tier, scene, isPlaying]);

  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
  }, []);

  return {
    stateRef,
    callbacksRef,
    controls: { play, pause, togglePlay, nextRound, prevRound, setSpeed },
    isPlaying,
    currentRound,
    totalRounds,
    phase,
  };
}

// ── Internal helpers ──

function loadRoundIntoState(
  state: BattleViewState,
  round: RoundData,
  lobsters: BattleLobsterConfig[],
): void {
  const actions = round.actions.map((a) => convertAction(a, lobsters));
  state.playback.queue = actions;
  state.playback.queueIdx = 0;
}

/** Fast-forward a round's damage without animation (for prev-round replay). */
function applyRoundDamage(
  state: BattleViewState,
  round: RoundData,
  lobsters: BattleLobsterConfig[],
): void {
  for (const action of round.actions) {
    const opp = oppositeTeam(action.actorTeam);
    const targetId = `${opp}${action.targetSlot}`;
    const target = state.anims[targetId];
    if (target && target.alive) {
      const damage = parseInt(action.damage, 10) || 0;
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp <= 0) {
        target.alive = false;
        target.hit.grayscale = true;
      }
    }
  }
}
