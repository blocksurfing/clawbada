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
  SettlementAlertPayload,
  Side,
  TurnCommand,
  TurnResolvedPayload,
  TurnStartedPayload,
  WireBarEntry,
  WsEnvelope,
} from '@/lib/battle-protocol';
import { api, battleSocketUrl } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws';

/** Connection attempts before a battle that was never reached is given up on (1 + 2 + 4 + 8 + 10 × 4 ≈ 55 s). */
export const FIRST_CONNECT_ATTEMPTS = 8;

/** Did the player refuse the request in their wallet? (EIP-1193 code 4001; viem's UserRejectedRequestError; the
 *  message wallets and wagmi use.) The error may be wrapped, so the causes are walked too. */
export function isWalletRejection(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 6; depth++) {
    const x = e as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (x.code === 4001 || x.name === 'UserRejectedRequestError') return true;
    if (typeof x.message === 'string' && /user (rejected|denied)|rejected the request|request rejected/i.test(x.message)) return true;
    e = x.cause;
  }
  return false;
}
const LOG_KEEP = 80;

export type Connection = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface AuthParams { address: string; signature: string; timestamp: string | number; nonce?: string; domain?: string }

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
  /** The battle was already over when this page joined (its end was read from the stored snapshot, not heard live). */
  endedBeforeJoin: boolean;
  /** D-06: a result was submitted on-chain while this battle is still live. */
  settlementAlert: SettlementAlertPayload | null;
  error: SessionErrorPayload | null;
  lastAck: { turn: number; duplicate: boolean } | null;
  /** Incremented each time a full server snapshot is applied (initial + reconnects). */
  snapshotSeq: number;
}

type Action =
  | { type: 'connection'; value: Connection }
  | { type: 'snapshot'; snapshot: BattleSnapshot }
  | { type: 'turn_started'; data: TurnStartedPayload }
  | { type: 'turn_resolved'; data: TurnResolvedPayload; gate: boolean }
  | { type: 'animated'; turn: number }
  | { type: 'bar_updated'; data: BarUpdatedPayload }
  | { type: 'battle_ended'; data: BattleEndedPayload }
  | { type: 'settlement_alert'; data: SettlementAlertPayload }
  | { type: 'error'; data: SessionErrorPayload }
  | { type: 'ack'; data: { turn: number; duplicate: boolean } };

const INITIAL: SessionViewState = {
  connection: 'idle', snapshot: null, current: null, timeouts: { A: 0, B: 0 }, bar: [], log: [], pending: [], ended: null, endedBeforeJoin: false, settlementAlert: null, error: null, lastAck: null, snapshotSeq: 0,
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
      return { ...s, snapshot: a.snapshot, current: a.snapshot.current, timeouts: a.snapshot.timeouts, bar: a.snapshot.state.bar, pending: [], error: null, snapshotSeq: s.snapshotSeq + 1, ...(s.ended ? {} : (() => { const e = endedFromSnapshot(a.snapshot); return e ? { ended: e, endedBeforeJoin: true } : {}; })()) };
    case 'turn_started':
      return { ...s, current: { turn: a.data.turn, lobsterId: a.data.lobsterId, side: a.data.side, controller: a.data.controller, deadline: a.data.deadline, clockMs: a.data.clockMs, playbackMs: a.data.playbackMs }, bar: a.data.bar };
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
    case 'settlement_alert':
      return { ...s, settlementAlert: a.data };
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
  /** Bearer headers for REST reads. */
  getAuthHeaders?: () => Promise<Record<string, string>>;
  /** Session token for the socket — no signature, so a battle never prompts the wallet. */
  getSessionToken?: () => Promise<string>;
  /** Hold resolved turns until the renderer acknowledges them (Unity). */
  gateOnAnimation: boolean;
  enabled?: boolean;
}

/**
 * A battle that ended before this page joined (bug 2026-11-04: a resign while the page was still loading). The server
 * broadcasts `battle_ended` once and then drops the battle from memory, so a socket that joins later hears nothing —
 * only the stored snapshot says it is over. Rebuild the ended payload from it so the result shows and the page returns.
 */
function endedFromSnapshot(snap: BattleSnapshot): BattleEndedPayload | null {
  const status = snap.session.status;
  // The state's own flag too: a snapshot taken from the live session in the moment it ends can still read 'active'.
  if (!snap.state.finished && status !== 'finished' && status !== 'settling' && status !== 'settled') return null;
  const winner = snap.session.winner ?? snap.state.winner ?? 'draw';
  const wiped = (['A', 'B'] as const).some((side) => !snap.state.lobsters.some((l) => l.team === side && l.alive));
  const reason = wiped ? 'wipeout' : snap.state.turn >= 100 ? 'turn_cap' : 'forfeit';
  return { winner, reason, finalStateHash: '', turnLogHash: '', settle: 'n/a' };
}

export function useBattleSession(battleId: string | null, opts: UseBattleSessionOptions) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const wsRef = useRef<WebSocket | null>(null);
  const gateRef = useRef(opts.gateOnAnimation);
  gateRef.current = opts.gateOnAnimation;
  const closedByUs = useRef(false);
  /** A command pressed while the socket was down — sent the moment it is back (see submitTurn). */
  const queued = useRef<{ turn: number; command: TurnCommand } | null>(null);
  /** `ready` asked for while the socket was down: sent on open. */
  const readyQueued = useRef(false);
  const snapshotRef = useRef<BattleSnapshot | null>(null);
  snapshotRef.current = state.snapshot;

  const fetchSnapshot = useCallback(async () => {
    if (!battleId) return;
    try {
      const headers = !opts.spectate && opts.getAuthHeaders ? await opts.getAuthHeaders() : undefined;
      const snap = await api.combat.getState(battleId, headers);
      dispatch({ type: 'snapshot', snapshot: snap });
    } catch {
      // not started yet — the WS will deliver a snapshot / turn_started
    }
  }, [battleId, opts.spectate, opts.getAuthHeaders]);

  useEffect(() => {
    if (!battleId || opts.enabled === false) return;
    if (!opts.spectate && !opts.getSessionToken) return;
    let attempt = 0;
    let everOpened = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    closedByUs.current = false;
    /** A battle this client has never reached (no socket, no snapshot) is given up on after a while: a tab left on
     *  a battle id that is not this player's must not ask for tickets every ten seconds for ever. A battle that WAS
     *  reached keeps reconnecting for as long as it takes (an API rollout, a lost network). */
    const givenUp = () => !everOpened && !snapshotRef.current && attempt >= FIRST_CONNECT_ATTEMPTS;

    const connect = async () => {
      dispatch({ type: 'connection', value: 'connecting' });
      let url: string;
      try {
        if (opts.spectate) url = `${WS_URL}?battleId=${encodeURIComponent(battleId)}&spectate=1`;
        else {
          const token = await opts.getSessionToken!();
          url = await battleSocketUrl(WS_URL, token, battleId);
        }
      } catch (err) {
        dispatch({ type: 'connection', value: 'error' });
        if (closedByUs.current) return;
        // The player said no to the wallet: asking again by ourselves would be a prompt nobody clicked for.
        if (isWalletRejection(err)) {
          console.warn('[BattleSession] sign-in was refused in the wallet — not retrying');
          return;
        }
        if (givenUp()) {
          console.warn(`[BattleSession] could not reach this battle after ${attempt} attempts — giving up`);
          return;
        }
        // The ticket request (or the token renewal) failed — usually a network blip or an API restart mid-battle:
        // keep trying on the same backoff as a dropped socket instead of leaving the battle disconnected.
        const delay = Math.min(10_000, 1_000 * 2 ** Math.min(attempt++, 3));
        console.warn(`[BattleSession] could not get a socket ticket (${err instanceof Error ? err.message : 'error'}) — retrying in ${delay} ms`);
        retryTimer = setTimeout(() => void connect(), delay);
        return;
      }
      if (closedByUs.current) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        everOpened = true;
        console.log(`[BattleSession] socket open${attempt > 0 ? ` (reconnect #${attempt})` : ''}`);
        // A live battle answers the join with its snapshot at once. Silence means it is not in the server's memory —
        // over already (or on another replica): read the stored state, which says how it ended.
        setTimeout(() => { if (!snapshotRef.current && wsRef.current === ws) void fetchSnapshot(); }, 400);
        attempt = 0;
        dispatch({ type: 'connection', value: 'open' });
        if (readyQueued.current) {
          readyQueued.current = false;
          ws.send(JSON.stringify({ type: 'ready', battleId }));
          console.log('[BattleSession] socket open — sending the queued ready');
        }
        const q = queued.current;
        if (q) {
          queued.current = null;
          console.log(`[BattleSession] socket back — sending the queued turn ${q.turn}`);
          ws.send(JSON.stringify({ type: 'submit_turn', battleId, turn: q.turn, command: q.command }));
        }
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
          case 'turn_started': {
            if (!snapshotRef.current) void fetchSnapshot();
            const d = msg.data as TurnStartedPayload;
            if (queued.current && queued.current.turn !== d.turn) queued.current = null;   // the clock or a reconnect moved on
            dispatch({ type: 'turn_started', data: d });
            break;
          }
          case 'turn_resolved': {
            const d = msg.data as TurnResolvedPayload;
            if (queued.current && queued.current.turn <= d.turn) queued.current = null;
            dispatch({ type: 'turn_resolved', data: d, gate: gateRef.current });
            break;
          }
          case 'bar_updated':
            dispatch({ type: 'bar_updated', data: msg.data as BarUpdatedPayload });
            break;
          case 'battle_ended':
            dispatch({ type: 'battle_ended', data: msg.data as BattleEndedPayload });
            break;
          case 'settlement_alert':
            dispatch({ type: 'settlement_alert', data: msg.data as SettlementAlertPayload });
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
      ws.onclose = (ev) => {
        wsRef.current = null;
        if (closedByUs.current) return;
        dispatch({ type: 'connection', value: 'closed' });
        if (givenUp()) {
          dispatch({ type: 'connection', value: 'error' });
          console.warn(`[BattleSession] could not reach this battle after ${attempt} attempts — giving up`);
          return;
        }
        // Auth expiry (1008) and drops: reconnect with backoff; the session token renews silently.
        const delay = Math.min(10_000, 1_000 * 2 ** Math.min(attempt++, 3));
        console.warn(`[BattleSession] socket closed code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ''} — reconnecting in ${delay} ms`);
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
      if (!battleId) return false;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Socket mid-reconnect (a network blip, a dropped connection): keep the press and send
        // it on open instead of dropping it — to the player a dropped press is a frozen game.
        // The server dedups by turn; a turn the clock has already resolved answers
        // turn_mismatch, which the view treats as "resync", not as a failure.
        queued.current = { turn, command };
        console.warn(`[BattleSession] socket ${ws ? `state ${ws.readyState}` : 'absent'} — turn ${turn} queued until it reconnects`);
        return true;
      }
      ws.send(JSON.stringify({ type: 'submit_turn', battleId, turn, command }));
      return true;
    },
    [battleId],
  );

  const markAnimated = useCallback((turn: number) => dispatch({ type: 'animated', turn }), []);

  /** Battle-start intro done: a fresh battle begins once every player is ready (the server caps the wait). */
  const sendReady = useCallback(() => {
    if (!battleId) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { readyQueued.current = true; return; }
    ws.send(JSON.stringify({ type: 'ready', battleId }));
    console.log('[BattleSession] ready sent');
  }, [battleId]);

  return { ...state, submitTurn, markAnimated, sendReady, refreshSnapshot: fetchSnapshot };
}
