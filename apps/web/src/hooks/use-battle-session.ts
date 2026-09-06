'use client';

/**
 * Live battle WebSocket client. Holds the authoritative snapshot the server
 * sends on join, applies turn_resolved events to it, and queues them for the
 * renderer so animations never overlap while the server keeps running.
 *
 * Gating: when `gateOnAnimation` is on (Unity present), a resolved turn sits in
 * `pending` until `markAnimated(turn)`; the HUD/board only advance then. Without
 * Unity, turns apply immediately.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  BarUpdatedPayload,
  BattleEndedPayload,
  BattleSnapshot,
  CurrentTurn,
  SessionErrorPayload,
  Side,
  TurnCommand,
  TurnResolvedPayload,
  TurnStartedPayload,
  WireBarEntry,
  WsEnvelope,
} from '@/lib/battle-protocol';
import { api } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws';
const LOG_KEEP = 80;

export type Connection = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface AuthParams { address: string; signature: string; timestamp: string | number }

export interface SessionViewState {
  connection: Connection;
  snapshot: BattleSnapshot | null;
  /** Server truth: whose turn it is right now (the clock runs regardless of animation). */
  current: CurrentTurn | null;
  timeouts: Record<Side, number>;
  bar: WireBarEntry[];
  /** Resolved turns already applied to `snapshot` (newest last). */
  log: TurnResolvedPayload[];
  /** Resolved turns waiting for the renderer (oldest first). */
  pending: TurnResolvedPayload[];
  ended: BattleEndedPayload | null;
  error: SessionErrorPayload | null;
  lastAck: { turn: number; duplicate: boolean } | null;
}

type Action =
  | { type: 'connection'; value: Connection }
  | { type: 'snapshot'; snapshot: BattleSnapshot }
  | { type: 'turn_started'; data: TurnStartedPayload }
  | { type: 'turn_resolved'; data: TurnResolvedPayload; gate: boolean }
  | { type: 'animated'; turn: number }
  | { type: 'bar_updated'; data: BarUpdatedPayload }
  | { type: 'battle_ended'; data: BattleEndedPayload }
  | { type: 'error'; data: SessionErrorPayload }
  | { type: 'ack'; data: { turn: number; duplicate: boolean } };

const INITIAL: SessionViewState = {
  connection: 'idle', snapshot: null, current: null, timeouts: { A: 0, B: 0 }, bar: [], log: [], pending: [], ended: null, error: null, lastAck: null,
};

/** Apply one resolved turn to the client-side wire state (HP, alive, position, turn). */
function applyResolved(snapshot: BattleSnapshot, t: TurnResolvedPayload): BattleSnapshot {
  // Server sends the authoritative post-turn state: take it wholesale. The patch below
  // is only a fallback for older servers and misses bar order, statuses and stun —
  // enough drift to make every later command fail validation ("not your turn").
  if (t.state) return { ...snapshot, state: t.state };
  const path = t.result.path;
  const dest = path.length > 0 ? path[path.length - 1] : null;
  const lobsters = snapshot.state.lobsters.map((l) => {
    const h = t.hp[l.id];
    const moved = dest && l.id === t.result.lobsterId ? { pos: { col: dest.col, row: dest.row } } : {};
    const charge = l.id === t.result.lobsterId ? { charge: t.result.chargeAfter, defending: t.result.action === 'defend' } : {};
    return h ? { ...l, hp: h.hp, alive: h.alive, ...moved, ...charge } : { ...l, ...moved, ...charge };
  });
  return {
    ...snapshot,
    state: { ...snapshot.state, lobsters, turn: t.turn, tick: t.result.tick, finished: t.result.finished, winner: t.result.winner, nextActorId: t.nextActorId, bar: t.result.bar },
  };
}

function reducer(s: SessionViewState, a: Action): SessionViewState {
  switch (a.type) {
    case 'connection':
      return { ...s, connection: a.value };
    case 'snapshot':
      return { ...s, snapshot: a.snapshot, current: a.snapshot.current, timeouts: a.snapshot.timeouts, bar: a.snapshot.state.bar, pending: [], error: null };
    case 'turn_started':
      return { ...s, current: { turn: a.data.turn, lobsterId: a.data.lobsterId, side: a.data.side, controller: a.data.controller, deadline: a.data.deadline }, bar: a.data.bar };
    case 'turn_resolved': {
      if (s.log.some((x) => x.turn === a.data.turn) || s.pending.some((x) => x.turn === a.data.turn)) return s;
      if (a.gate && s.snapshot) return { ...s, pending: [...s.pending, a.data] };
      const snapshot = s.snapshot ? applyResolved(s.snapshot, a.data) : null;
      return { ...s, snapshot, log: [...s.log, a.data].slice(-LOG_KEEP) };
    }
    case 'animated': {
      const idx = s.pending.findIndex((p) => p.turn === a.turn);
      if (idx < 0) return s;
      const t = s.pending[idx];
      const snapshot = s.snapshot ? applyResolved(s.snapshot, t) : null;
      return { ...s, snapshot, pending: s.pending.filter((_, i) => i !== idx), log: [...s.log, t].slice(-LOG_KEEP) };
    }
    case 'bar_updated':
      return { ...s, bar: a.data.bar };
    case 'battle_ended':
      return { ...s, ended: a.data, current: null };
    case 'error':
      return { ...s, error: a.data };
    case 'ack':
      return { ...s, lastAck: a.data, error: null };
    default:
      return s;
  }
}

export interface UseBattleSessionOptions {
  address?: string;
  spectate?: boolean;
  getAuthParams?: () => Promise<AuthParams>;
  /** Hold resolved turns until the renderer acknowledges them (Unity). */
  gateOnAnimation: boolean;
  enabled?: boolean;
}

export function useBattleSession(battleId: string | null, opts: UseBattleSessionOptions) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const wsRef = useRef<WebSocket | null>(null);
  const gateRef = useRef(opts.gateOnAnimation);
  gateRef.current = opts.gateOnAnimation;
  const closedByUs = useRef(false);
  const snapshotRef = useRef<BattleSnapshot | null>(null);
  snapshotRef.current = state.snapshot;

  const fetchSnapshot = useCallback(async () => {
    if (!battleId) return;
    try {
      const headers = !opts.spectate && opts.getAuthParams ? await opts.getAuthParams().then((p) => ({ 'X-Wallet-Address': p.address, 'X-Signature': p.signature, 'X-Timestamp': String(p.timestamp) })) : undefined;
      const snap = await api.combat.getState(battleId, headers);
      dispatch({ type: 'snapshot', snapshot: snap });
    } catch {
      // not started yet — the WS will deliver a snapshot / turn_started
    }
  }, [battleId, opts.spectate, opts.getAuthParams]);

  useEffect(() => {
    if (!battleId || opts.enabled === false) return;
    if (!opts.spectate && !opts.getAuthParams) return;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    closedByUs.current = false;

    const connect = async () => {
      dispatch({ type: 'connection', value: 'connecting' });
      let url: string;
      try {
        if (opts.spectate) url = `${WS_URL}?battleId=${encodeURIComponent(battleId)}&spectate=1`;
        else {
          const p = await opts.getAuthParams!();
          url = `${WS_URL}?address=${p.address}&signature=${p.signature}&timestamp=${p.timestamp}&battleId=${encodeURIComponent(battleId)}`;
        }
      } catch {
        dispatch({ type: 'connection', value: 'error' });
        return;
      }
      if (closedByUs.current) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        dispatch({ type: 'connection', value: 'open' });
      };
      ws.onmessage = (evt) => {
        let msg: WsEnvelope;
        try {
          msg = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        switch (msg.event) {
          case 'battle_snapshot':
            dispatch({ type: 'snapshot', snapshot: msg.data as BattleSnapshot });
            break;
          case 'turn_started':
            if (!snapshotRef.current) void fetchSnapshot();
            dispatch({ type: 'turn_started', data: msg.data as TurnStartedPayload });
            break;
          case 'turn_resolved':
            dispatch({ type: 'turn_resolved', data: msg.data as TurnResolvedPayload, gate: gateRef.current });
            break;
          case 'bar_updated':
            dispatch({ type: 'bar_updated', data: msg.data as BarUpdatedPayload });
            break;
          case 'battle_ended':
            dispatch({ type: 'battle_ended', data: msg.data as BattleEndedPayload });
            break;
          case 'turn_ack':
            dispatch({ type: 'ack', data: msg.data as { turn: number; duplicate: boolean } });
            break;
          case 'error':
            dispatch({ type: 'error', data: msg.data as SessionErrorPayload });
            break;
          default:
            break;
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (closedByUs.current) return;
        dispatch({ type: 'connection', value: 'closed' });
        // Auth expiry (1008) and drops: reconnect with backoff; a fresh signature is requested.
        const delay = Math.min(10_000, 1_000 * 2 ** Math.min(attempt++, 3));
        retryTimer = setTimeout(() => void connect(), delay);
      };
      ws.onerror = () => {
        // onclose follows; nothing to do here
      };
    };
    void connect();
    return () => {
      closedByUs.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId, opts.spectate, opts.enabled]);

  const submitTurn = useCallback(
    (turn: number, command: TurnCommand): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !battleId) return false;
      ws.send(JSON.stringify({ type: 'submit_turn', battleId, turn, command }));
      return true;
    },
    [battleId],
  );

  const markAnimated = useCallback((turn: number) => dispatch({ type: 'animated', turn }), []);

  return { ...state, submitTurn, markAnimated, refreshSnapshot: fetchSnapshot };
}
