'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from './use-auth';
import {
  WS_CLOSE_CAPACITY,
  WS_CLOSE_SIGNATURE_EXPIRED,
} from '@/lib/ws-close-codes';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws';

/** Event names matching `BattleEvent` in `apps/api/src/lib/ws.ts`. The hook
 *  doesn't enforce this on incoming events (defensive against unknown event
 *  types arriving from a newer server) but consumers can narrow on it. */
export type BattleEventName =
  | 'match_found'
  | 'deposits_confirmed'
  | 'round_result'
  | 'round_reveal_complete'
  | 'battle_settled'
  | 'round_started'
  | 'battle_forfeit'
  // V3 S1 queue lifecycle (sent to address rooms, not battle rooms):
  | 'queue_joined'
  | 'search_expanded'
  | 'match_cancelled';

export interface BattleWsEvent {
  /** Event name as sent by the server's `BattleMessage.event` field. */
  event: BattleEventName | string;
  /** Server-supplied battleId (empty string for address-room events). */
  battleId: string;
  /** Server-supplied event payload (`data` field on `BattleMessage`). */
  data: Record<string, unknown>;
  /** Local receive timestamp (ms since epoch). */
  receivedAt: number;
}

interface BattleWsState {
  phase: 'disconnected' | 'connecting' | 'connected' | 'closed';
  events: BattleWsEvent[];
  lastEvent: BattleWsEvent | null;
  connected: boolean;
}

type Action =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'event'; event: BattleWsEvent }
  | { type: 'closed' }
  | { type: 'reset' };

function reducer(state: BattleWsState, action: Action): BattleWsState {
  switch (action.type) {
    case 'connecting':
      return { ...state, phase: 'connecting', connected: false };
    case 'connected':
      return { ...state, phase: 'connected', connected: true };
    case 'event':
      return {
        ...state,
        events: [...state.events, action.event],
        lastEvent: action.event,
      };
    case 'closed':
      return { ...state, phase: 'closed', connected: false };
    case 'reset':
      return { phase: 'disconnected', events: [], lastEvent: null, connected: false };
    default:
      return state;
  }
}

const INITIAL_STATE: BattleWsState = {
  phase: 'disconnected',
  events: [],
  lastEvent: null,
  connected: false,
};

/**
 * Subscribe to server-pushed events for a player.
 *
 * - Pre-match (queue lifecycle): pass `battleId = null`. The hook subscribes
 *   to the address room only and receives `queue_joined`, `search_expanded`,
 *   `match_cancelled`, and the boundary `match_found` event.
 * - Post-match: pass the matched `battleId`. The hook subscribes to both the
 *   address room and the battle room (server-side wiring) and additionally
 *   receives battle-room events (`round_result`, `battle_settled`, etc.).
 *
 * Address must always be present — without it the hook holds in `disconnected`.
 *
 * Bug fix vs. the previous version: the message payload key for the event
 * name is `event` (matching the server's `BattleMessage`), not `type`. The
 * old reducer looked at `data.type` and silently received `undefined` for
 * every event's `type` field.
 */
/** F-Y8: close-code constants moved to `lib/ws-close-codes.ts` so other
 *  modules (telemetry, analytics, future hooks) reference the same source
 *  of truth. */

/** Minimum backoff for capacity closes — gives older tabs time to close
 *  and free a slot. The exponential ramps from this floor. */
const RECONNECT_CAPACITY_MIN_MS = 5_000;

/** F-Y5: after this many consecutive 1013 (capacity) closes, give up.
 *  Without this, a player with 8 stuck zombie tabs would retry the 9th
 *  forever at the 5–30s backoff. Conservative cap (~5 minutes of retries
 *  at peak backoff). Reset on any non-capacity close type or successful
 *  open. */
const MAX_CAPACITY_FAILURES = 10;

/** Exponential backoff parameters for F-2H reconnect. */
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/** F-2N: stop retrying after this many consecutive close events that never
 *  reached `onopen`. Treats permanent rejections (banned wallet, invalid
 *  battleId, expired DB row) as terminal so the client doesn't pummel the
 *  server forever and burn the WS IP rate-limit. Once a socket has opened
 *  successfully, the counter resets — transient blips on a long-lived
 *  connection won't trip this. */
const MAX_PRE_OPEN_FAILURES = 5;

export function useBattleWs(battleId: string | null, address: string | undefined) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  // F-2N-a: external trigger that resets `terminal`/`preOpenFailures` and
  // restarts the reconnect loop. Bumped by `retry()` so the effect re-runs
  // with fresh local state.
  const [retryNonce, setRetryNonce] = useReducer((n: number) => n + 1, 0);
  const { getAuthParams, invalidateAuthCache } = useAuth();

  useEffect(() => {
    if (!address) return;

    dispatch({ type: 'connecting' });

    // F-03/F-07: WS upgrade requires the same EIP-191 signature the REST
    // walletAuth middleware uses. We embed `address`, `signature`, `timestamp`
    // (and optional `battleId`) in the URL — the cache in `useAuth` reuses a
    // single signMessage call across both transports.
    //
    // F-2H: server forces a close at signature expiry (~5 min) to bound the
    // window of any leaked auth URL. Without reconnect, every queue/battle
    // hits a chronic 5-min disconnect. We reconnect with exponential backoff
    // and invalidate the cached signature on a 1008 close so the next sign
    // attempt produces a fresh, server-acceptable signature.
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    // F-2N: count consecutive close events whose socket never reached `onopen`.
    // Reset on a successful open. If this exceeds MAX_PRE_OPEN_FAILURES we stop
    // retrying — repeated upgrade failures are typically permanent rejections
    // (banned wallet, invalid battleId, expired DB row) and infinite retry
    // burns the WS IP rate limiter for everyone behind that IP.
    let preOpenFailures = 0;
    // F-Y5: separate counter for consecutive 1013 (capacity) closes. The
    // F-2N classifier exempts 1013 (transient signal), but with no upper
    // bound the client would retry forever if the cap stayed full. Reset
    // on a successful open OR any non-capacity close type.
    let capacityFailures = 0;
    let terminal = false;

    const connect = async () => {
      if (cancelled || terminal) return;
      dispatch({ type: 'connecting' });

      let auth: Awaited<ReturnType<typeof getAuthParams>>;
      try {
        auth = await getAuthParams();
      } catch {
        // Signature rejected, wallet not connected, etc. — bail; the next
        // re-render with a connected wallet will retry.
        if (!cancelled) dispatch({ type: 'closed' });
        return;
      }
      if (cancelled) return;

      // Defensive: server lower-cases address before joining rooms; mirror it
      // so server logs and address-room keys agree.
      const params = new URLSearchParams({
        address: auth.address.toLowerCase(),
        signature: auth.signature,
        timestamp: String(auth.timestamp),
      });
      if (battleId) params.set('battleId', battleId);
      const url = `${WS_URL}?${params.toString()}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;
      // F-2N: per-socket flag. Distinguishes "we got connected and then lost
      // it" (transient — keep retrying) from "we never connected" (likely
      // permanent — back off and eventually give up).
      let socketOpened = false;

      // F-2D: guard every handler against stale dispatches. If the effect
      // cleanup ran (cancelled=true) or a newer socket has replaced this one
      // (wsRef.current !== ws), drop the event — without this, an in-flight
      // onclose from socket A can mark socket B as 'closed' immediately
      // after B opens.
      const isStale = () => cancelled || wsRef.current !== ws;

      ws.onopen = () => {
        if (isStale()) return;
        socketOpened = true;
        reconnectAttempt = 0; // reset backoff on successful open
        preOpenFailures = 0; // F-2N: a successful open clears the pre-open failure count
        capacityFailures = 0; // F-Y5: same for capacity-failure counter
        dispatch({ type: 'connected' });
      };

      ws.onmessage = (evt) => {
        if (isStale()) return;
        try {
          const parsed = JSON.parse(evt.data) as {
            event?: string;
            battleId?: string;
            data?: Record<string, unknown>;
          };
          if (!parsed.event) return; // malformed/heartbeat
          dispatch({
            type: 'event',
            event: {
              event: parsed.event,
              battleId: parsed.battleId ?? '',
              data: parsed.data ?? {},
              receivedAt: Date.now(),
            },
          });
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = (evt: CloseEvent) => {
        if (isStale()) return;
        dispatch({ type: 'closed' });

        // F-2N: track sockets that never opened — repeated pre-open failures
        // are usually permanent (auth/policy rejection at upgrade). 1008
        // (signature expired) is exempt: it's an expected periodic event that
        // we recover from by re-signing, not a permanent rejection.
        // F-Y2: 1013 (capacity) is also exempt — it's a transient capacity
        // signal. The user has too many tabs/sockets open; closing one
        // frees a slot. Counting it toward F-2N would falsely strand the
        // 9th tab in `terminal` after 5 retries even though closing a tab
        // would resolve the issue.
        const isAuthRenewal = evt.code === WS_CLOSE_SIGNATURE_EXPIRED;
        const isCapacityLimit = evt.code === WS_CLOSE_CAPACITY;
        if (!socketOpened && !isAuthRenewal && !isCapacityLimit) {
          preOpenFailures += 1;
          if (preOpenFailures >= MAX_PRE_OPEN_FAILURES) {
            terminal = true;
            // Leave dispatch in 'closed' — consumers see no reconnect happen.
            // Diagnostic only: this is a last-resort log so devs can spot
            // upgrade-rejection storms without wiring a new state field.
            console.warn(
              '[useBattleWs] giving up after %d consecutive pre-open failures; last close code=%d reason=%s',
              preOpenFailures,
              evt.code,
              evt.reason,
            );
            return;
          }
        }

        // F-Y5: track consecutive capacity closes. Increment on 1013;
        // RESET on any other close type (including the auth-renewal 1008
        // case, which is recoverable via re-sign and shouldn't reset the
        // OTHER failure path). After the cap, go terminal — the user has
        // a structural too-many-tabs problem and indefinite retry just
        // burns server resources.
        if (isCapacityLimit) {
          capacityFailures += 1;
          if (capacityFailures >= MAX_CAPACITY_FAILURES) {
            terminal = true;
            console.warn(
              '[useBattleWs] giving up after %d consecutive capacity closes; close other tabs and call retry()',
              capacityFailures,
            );
            return;
          }
        } else {
          capacityFailures = 0;
        }

        // F-2H: schedule a reconnect with exponential backoff. On 1008
        // (signature expired) clear the cached signature first so the next
        // signMessage produces a server-acceptable one.
        if (isAuthRenewal) {
          invalidateAuthCache();
        }
        // F-Y2: capacity-limit closes use a higher minimum backoff (5s) so
        // we don't pummel the server with rapid retries when the cap is
        // genuinely full. The exponential ramp from this floor still caps
        // at RECONNECT_MAX_MS.
        const baseDelay = isCapacityLimit ? RECONNECT_CAPACITY_MIN_MS : RECONNECT_INITIAL_MS;
        const delay = Math.min(
          RECONNECT_MAX_MS,
          baseDelay * Math.pow(2, reconnectAttempt),
        );
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connect();
        }, delay);
      };
    };

    // F-2R: when the browser comes back online, fire an immediate reconnect
    // attempt instead of waiting up to 30s for the existing backoff timer.
    // Only acts if a reconnect is already pending (we're disconnected) AND
    // we haven't terminally given up — otherwise the listener is a no-op.
    const handleOnline = () => {
      if (cancelled || terminal) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        // Reset backoff so a quick second drop doesn't immediately go to 30s.
        reconnectAttempt = 0;
        void connect();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    void connect();

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const ws = wsRef.current;
      if (ws) {
        // F-2D: drop handlers before closing so the close event from the
        // browser can't race in and dispatch on a torn-down effect.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [battleId, address, getAuthParams, invalidateAuthCache, retryNonce]);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  // F-2N-a: explicit recovery for the terminal state. Calling `retry()` bumps
  // the nonce and re-runs the effect, which resets `terminal` /
  // `preOpenFailures` (effect-iteration-local) and starts a fresh connect
  // sequence. Useful when the consumer wants to expose a "Reconnect" button.
  const retry = useCallback(() => setRetryNonce(), []);

  return { ...state, reset, retry };
}
