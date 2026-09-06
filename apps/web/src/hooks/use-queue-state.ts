'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useAuth } from '@/hooks/use-auth';
import { useBattleWs, type BattleWsEvent } from '@/hooks/use-battle-ws';
import { api, type PowerRadiusPayload, type QueueStatus } from '@/lib/api';

// ──────────── State types ────────────

export type QueueStateKind =
  | 'idle'
  | 'joining'
  | 'queued'
  | 'matched'
  | 'cancelling'
  | 'cancelled'
  | 'errored';

export interface QueuedState {
  kind: 'queued';
  bracket: number;
  power: number;
  radius: PowerRadiusPayload;
  since: number; // ms epoch
  teamId: string;
  /** F-Y3: server-issued queue row PK. Collision-proof session id, preferred
   *  over `since` for stale-event filtering. Optional for backward compat
   *  with legacy server responses; reducer falls back to `since` when absent. */
  queueId?: string;
}

export interface MatchedState {
  kind: 'matched';
  battleId: string;
  opponent: string;
  yourPower: number;
  opponentPower: number;
  powerDelta: number;
  bracket: number;
}

export type QueueState =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | QueuedState
  | MatchedState
  | { kind: 'cancelling' }
  | { kind: 'cancelled'; reason: string; elapsedSec?: number }
  | { kind: 'errored'; error: string };

// ──────────── Reducer ────────────

type Action =
  | { type: 'join_start' }
  | { type: 'join_queued'; bracket: number; power: number; radius: PowerRadiusPayload; since: number; teamId: string; queueId?: string }
  | { type: 'join_matched_immediate'; payload: MatchedState }
  | { type: 'leave_start' }
  | { type: 'left' }
  /** F-FF1/F-FF2: reducer-guarded terminal for the cancel-during-join
   *  cleanup branches. Transitions to `idle` ONLY from `cancelling` —
   *  rejects from `matched`, `queued`, `joining`, etc. The previous
   *  unconditional `left` dispatches in those branches could clobber a
   *  `matched` state that a WS event had advanced to during the join
   *  HTTP flight. Using a reducer guard instead of a `stateRef`-based
   *  caller-side check eliminates a stale-ref timing window (passive
   *  effect updates the ref AFTER render commit, so a synchronously-
   *  dispatched `leave_start` may not have landed in stateRef by the
   *  time the caller-side guard reads it). */
  | { type: 'left_if_cancelling' }
  /** F-GG2: reducer-guarded `error` for join HTTP failures. Transitions
   *  to `errored` ONLY from `joining`. The caller-side `stateRef` check
   *  (F-BB1) had the same passive-effect timing vulnerability F-FF2
   *  eliminated — a synchronously-dispatched `join_recovered_from_ws`
   *  via the `queue_joined` WS path may not be in stateRef when the
   *  join catch reads it, leading to the stale-joining check passing
   *  and an unconditional `error` clobbering the recovered `queued`
   *  state. */
  | { type: 'error_if_joining'; error: string }
  /** F-HH2: reducer-guarded `error` for leave HTTP failures. Transitions
   *  to `errored` ONLY from `cancelling`. Mirrors `left_if_cancelling`
   *  for the failure path: if a WS event or reconcile advanced state to
   *  `matched`/`cancelled` during the DELETE /queue await, the catch's
   *  `error` must not clobber that newer state. */
  | { type: 'error_if_cancelling'; error: string }
  /** F-II1: reducer-guarded `reset` for callers reading state.kind from
   *  a stale closure (the auth-disconnect effect captures state at the
   *  render its deps changed; if a same-flush WS event advanced state,
   *  the effect's stale view would unconditionally clobber it). Caller
   *  passes the kind they observed; reducer rejects if current kind
   *  differs. */
  | { type: 'reset_if_kind'; expectedKind: QueueStateKind }
  /** F-II2: reducer-guarded `error` for join calls made from non-joinable
   *  states. `joinQueue` is normally called from idle/cancelled/errored,
   *  but a user-initiated call from a stale UI callback could fire while
   *  state is already queued/matched/etc. Reducer rejects from any
   *  non-joinable kind. */
  | { type: 'error_if_joinable'; error: string }
  /** F-II3: reducer-guarded `reset` for terminal-toast cleanup (the
   *  exported `reset()` callback). Only transitions from `cancelled` /
   *  `errored` — the cases where a "dismiss toast and return to idle"
   *  semantic actually applies. Prevents a stale UI handler from
   *  resetting active queue/match state. */
  | { type: 'reset_if_terminal' }
  /** F-15-b: DELETE /queue raced against a matchmaker win. Server returned
   *  the matched battle in the cancel response — transition to matched
   *  instead of cancelled. Accepts from `cancelling` (typical) plus the
   *  `queued`/`joining` states for defense-in-depth. */
  | { type: 'leave_revealed_match'; payload: MatchedState }
  /** F-X1 (PR 6): post-WS-reconnect rehydration revealed a matched battle
   *  the client missed during the disconnect window (typically a 1008
   *  signature-expiry close). Accepts from `idle` / `queued` / `joining` /
   *  `cancelling` — basically any state that isn't already terminal in a
   *  user-meaningful way. */
  | { type: 'rehydrate_matched'; payload: MatchedState }
  /** F-Y4: `queue_joined` WS event recovers the queue session when the
   *  POST /queue HTTP response was lost (transport timeout AFTER the
   *  server-side insert + WS emit). Accepts from `joining` (the typical
   *  in-flight-join case) AND `errored` (the catch already fired before
   *  the WS event arrived). Carries the server-side queue session fields
   *  plus the client-stashed `teamId` (not present in the WS payload). */
  | {
      type: 'join_recovered_from_ws';
      bracket: number;
      power: number;
      radius: PowerRadiusPayload;
      since: number;
      teamId: string;
      queueId?: string;
    }
  // F-16: WS-derived actions optionally carry the server's session id so the
  // reducer can drop events from a prior queue session that arrived after
  // re-queue.
  // F-Y3: also propagate `queueId` (DB row PK). Reducer prefers this over
  // `enqueuedAtMs` when both are present — collision-proof.
  | { type: 'ws_radius_expanded'; radius: PowerRadiusPayload; enqueuedAtMs?: number; queueId?: string }
  | { type: 'ws_match_found'; payload: MatchedState; enqueuedAtMs?: number; queueId?: string }
  | { type: 'ws_match_cancelled'; reason: string; elapsedSec?: number; enqueuedAtMs?: number; queueId?: string }
  | { type: 'rehydrate_queued'; bracket: number; power: number; radius: PowerRadiusPayload; since: number; teamId: string; queueId?: string }
  | { type: 'error'; error: string }
  | { type: 'reset' };

/** F-AA2: validate a server `recentBattle` payload before constructing a
 *  `MatchedState`. JSON has no runtime type-checking — a server bug or
 *  schema drift could produce undefined fields, leading to UI rendering
 *  garbage (e.g., `powerDelta = NaN` when `opponentPower` is missing).
 *  Returns null if any required field is missing or malformed. */
function toMatchedStateFromRecent(
  rb: NonNullable<QueueStatus['recentBattle']> | undefined,
): MatchedState | null {
  if (!rb) return null;
  if (!rb.battleId) return null;
  if (!rb.opponent) return null;
  if (rb.bracket == null) return null;
  if (rb.yourPower == null) return null;
  if (rb.opponentPower == null) return null;
  // Codex PR-B MEDIUM-3: status=4 (create_failed) means the engine's
  // operator job died — there's no on-chain battle to navigate to. Don't
  // build a MatchedState; the API also filters these out of `recentBattle`
  // (defense in depth — handles in-flight responses with stale status).
  if (rb.status === 4) return null;
  return {
    kind: 'matched',
    battleId: rb.battleId,
    opponent: rb.opponent,
    yourPower: rb.yourPower,
    opponentPower: rb.opponentPower,
    powerDelta: rb.opponentPower - rb.yourPower,
    bracket: rb.bracket,
  };
}

/** F-Y3: session-equality check for WS events against the current queued
 *  session. Prefers the collision-proof `queueId` (DB row PK) when BOTH
 *  state and action carry it; otherwise falls back to `enqueuedAtMs` for
 *  backward compat with payloads/state from before F-Y3. If neither is
 *  present, accepts (legacy behavior).
 *
 *  F-EE2: defensive normalization. Treats empty-string `queueId` as
 *  absent on either side. A degenerate `queueId: ""` slipping through any
 *  ingress path (REST join response, WS event, future code path) would
 *  otherwise compare unequal to a real server-emitted queueId and reject
 *  every legitimate event — same failure mode F-DD2 closes for the
 *  queue_joined recovery path. Normalizing here closes the gap for ALL
 *  ingress paths, not just queue_joined.
 */
function sessionMatches(
  state: QueuedState,
  action: { enqueuedAtMs?: number; queueId?: string },
): boolean {
  const stateQueueId =
    typeof state.queueId === 'string' && state.queueId.length > 0
      ? state.queueId
      : null;
  const actionQueueId =
    typeof action.queueId === 'string' && action.queueId.length > 0
      ? action.queueId
      : null;
  if (stateQueueId !== null && actionQueueId !== null) {
    return stateQueueId === actionQueueId;
  }
  if (action.enqueuedAtMs != null) {
    return action.enqueuedAtMs === state.since;
  }
  return true;
}

function reducer(state: QueueState, action: Action): QueueState {
  switch (action.type) {
    case 'join_start':
      // Only allowed from idle/cancelled/errored. The imperative API enforces
      // this via a ref guard, but defense-in-depth in the reducer too.
      if (state.kind !== 'idle' && state.kind !== 'cancelled' && state.kind !== 'errored') return state;
      return { kind: 'joining' };

    case 'join_queued':
      // B-04 fix: only honor a join-queued REST result if we're still in
      // `joining`. If the user clicked cancel mid-join, state has moved to
      // `idle` and we drop the late dispatch on the floor (the imperative
      // joinQueue handler will compensate by firing leaveQueue).
      if (state.kind !== 'joining') return state;
      return {
        kind: 'queued',
        bracket: action.bracket,
        power: action.power,
        radius: action.radius,
        since: action.since,
        teamId: action.teamId,
        queueId: action.queueId,
      };

    case 'join_matched_immediate':
      // B-04 fix: same race guard as join_queued.
      if (state.kind !== 'joining') return state;
      return action.payload;

    case 'leave_start':
      // Allow cancelling from `queued` (normal flow) AND from `joining`
      // (race: user clicked cancel before joinQueue REST returned). Both
      // paths transition to `cancelling` — keeping `joining` from skipping
      // straight to `idle` (B-21 fix). The intermediate `cancelling` state
      // shows a "Cancelling…" UI to the user during the ~50ms window where
      // the compensating leaveQueue REST is in flight, instead of dropping
      // their re-click intent silently.
      if (state.kind === 'queued' || state.kind === 'joining') return { kind: 'cancelling' };
      return state;

    case 'left':
      return { kind: 'idle' };

    case 'left_if_cancelling':
      // F-FF1/F-FF2: only from `cancelling`. Reducer-enforced because
      // caller-side `stateRef` checks were vulnerable to passive-effect
      // timing (the ref updates after render, so a synchronously-
      // dispatched `leave_start` could be missed by the caller's check).
      if (state.kind !== 'cancelling') return state;
      return { kind: 'idle' };

    case 'error_if_joining':
      // F-GG2: only from `joining`. Same reducer-side guard rationale as
      // `left_if_cancelling` — eliminates the stale-stateRef window where
      // a WS-recovered `queued` state could be clobbered by a stale-join
      // catch's unconditional `error` dispatch.
      if (state.kind !== 'joining') return state;
      return { kind: 'errored', error: action.error };

    case 'error_if_cancelling':
      // F-HH2: only from `cancelling`. Same rationale as the other
      // `_if_X` guards. A WS-advanced state during the DELETE /queue
      // await must not be clobbered by the catch's error dispatch.
      if (state.kind !== 'cancelling') return state;
      return { kind: 'errored', error: action.error };

    case 'reset_if_kind':
      // F-II1: reject if state has advanced past the caller's observed
      // kind. The auth-disconnect effect is the primary caller —
      // captures `state.kind` at render-time, then reacts on a separate
      // dep (auth.isConnected). Between those two events, a WS or
      // reconcile dispatch could advance state — the reset must not
      // clobber that newer state.
      if (state.kind !== action.expectedKind) return state;
      return { kind: 'idle' };

    case 'error_if_joinable':
      // F-II2: only from joinable states. `joinQueue` typically runs
      // from idle/cancelled/errored; if called from queued/matched/
      // joining/cancelling (stale UI callback or test fixture), the
      // "Not authenticated" error must not clobber active state.
      if (
        state.kind !== 'idle' &&
        state.kind !== 'cancelled' &&
        state.kind !== 'errored'
      ) {
        return state;
      }
      return { kind: 'errored', error: action.error };

    case 'reset_if_terminal':
      // F-II3: only from terminal-toast states (`cancelled` / `errored`).
      // The exported `reset()` is meant for "dismiss the toast and return
      // to idle" UX — must not clobber active queue/match state when a
      // stale callback fires after a WS recovery.
      if (state.kind !== 'cancelled' && state.kind !== 'errored') return state;
      return { kind: 'idle' };

    case 'leave_revealed_match':
      // F-15-b: only honor when we're actually in the leave flow (or still
      // queued/joining if the dispatch raced). Reject from idle/matched/
      // cancelled to avoid late server responses pulling state back.
      if (
        state.kind !== 'cancelling' &&
        state.kind !== 'queued' &&
        state.kind !== 'joining'
      ) {
        return state;
      }
      return action.payload;

    case 'rehydrate_matched':
      // F-X1 (PR 6): server-side queueStatus refetch (typically post-WS-
      // reconnect) reveals a matched battle. Accept from `idle`, `queued`,
      // and `cancelling` — the cases where the user could legitimately be
      // unaware of an in-flight match.
      // F-AA1: do NOT accept from `joining`. A late rehydrate response
      // arriving DURING a manual join would clobber the in-flight queue
      // attempt, then the legitimate `join_queued` is rejected. Callers
      // (the initial-rehydrate effect and the reconnect-watcher) ALSO
      // skip dispatch when state is `joining` — this reducer guard is
      // belt-and-suspenders for any future caller.
      if (
        state.kind !== 'idle' &&
        state.kind !== 'queued' &&
        state.kind !== 'cancelling'
      ) {
        return state;
      }
      return action.payload;

    case 'join_recovered_from_ws':
      // F-Y4: only honor when an explicit join is/was in flight. Reject
      // from `idle`/`queued`/`matched`/`cancelled`/`cancelling` to avoid
      // unexpected jumps from a stale WS event.
      if (state.kind !== 'joining' && state.kind !== 'errored') return state;
      return {
        kind: 'queued',
        bracket: action.bracket,
        power: action.power,
        radius: action.radius,
        since: action.since,
        teamId: action.teamId,
        queueId: action.queueId,
      };

    case 'ws_radius_expanded':
      // Only meaningful while queued — ignore stale events from prior sessions.
      if (state.kind !== 'queued') return state;
      // F-16: explicit session-id check on top of state-kind check. The
      // matchmaker tags every search_expanded with the queue row's
      // `enqueuedAtMs`; a player who matched and re-queued has a NEW
      // `state.since` while a stale tick from the prior session may still
      // be in flight. Drop mismatches.
      // F-Y3: prefer the collision-proof `queueId` (DB row PK) when both
      // sides have it; fall back to `enqueuedAtMs` for backward compat.
      if (!sessionMatches(state, action)) return state;
      return { ...state, radius: action.radius };

    case 'ws_match_found':
      // B-02 fix: ignore late match_found events that arrive after the user
      // already requested cancellation (or entered any non-active state).
      // Server-side post-cancel match still creates an on-chain battle, but
      // at least the UI state stays consistent with user intent.
      if (state.kind !== 'queued' && state.kind !== 'joining') return state;
      // F-16 / F-Y3: if we're in `queued` and the server's session id
      // doesn't match ours, this match_found is for a prior session — drop.
      // While in `joining` we don't yet have a session id, so we accept;
      // the rare race where a stale match_found beats the join_queued REST
      // response is bounded by the server's matchmaker only firing
      // match_found for an existing queue row (which, in `joining`, hasn't
      // been written yet for the current session).
      if (state.kind === 'queued' && !sessionMatches(state, action)) return state;
      return action.payload;

    case 'ws_match_cancelled':
      // Only fire when we were actively in queue or already cancelling.
      // Late cancellation events for a previous queue session shouldn't drag
      // an idle/matched state back to cancelled.
      if (state.kind !== 'queued' && state.kind !== 'cancelling' && state.kind !== 'joining') return state;
      // F-16 / F-Y3: same session-id guard as match_found. `cancelling`
      // and `joining` lack identity fields, so we can only enforce on
      // `queued`.
      if (state.kind === 'queued' && !sessionMatches(state, action)) return state;
      return { kind: 'cancelled', reason: action.reason, elapsedSec: action.elapsedSec };

    case 'rehydrate_queued':
      // B-10 fix: only allowed to populate state from a fresh idle. Prevents
      // stomping on whatever state the user is actively in.
      if (state.kind !== 'idle') return state;
      return {
        kind: 'queued',
        bracket: action.bracket,
        power: action.power,
        radius: action.radius,
        since: action.since,
        teamId: action.teamId,
        queueId: action.queueId,
      };

    case 'error':
      return { kind: 'errored', error: action.error };

    case 'reset':
      return { kind: 'idle' };

    default:
      return state;
  }
}

const INITIAL: QueueState = { kind: 'idle' };

// ──────────── Hook ────────────

export interface UseQueueStateResult {
  state: QueueState;
  /** Submit a queue request. Idempotent if already queued (rejects with error). */
  joinQueue: (teamId: string, stakeAmount: string) => Promise<void>;
  /** Cancel an in-flight queue. No-op if not queued. */
  leaveQueue: () => Promise<void>;
  /** Reset to idle (e.g., after navigating away from a `cancelled` / `errored` toast). */
  reset: () => void;
}

/**
 * Owns the player's queue lifecycle as a state machine. Subscribes to
 * address-room WS events for queue transitions; offers imperative join/leave.
 *
 * Lifetime: WS opens lazily on `joinQueue`. The hook keeps the connection
 * open until `reset()` is called or the component unmounts.
 *
 * Guard rails:
 *  - **B-03 re-entry guard**: a ref blocks concurrent `joinQueue`/`leaveQueue`
 *    calls (e.g. from a double-click) before they can stomp each other.
 *  - **B-04 cancel-during-join**: if the user clicks cancel while the
 *    `joinQueue` REST is in flight, we set a ref; the resolve handler issues
 *    a compensating `leaveQueue` so we don't end up phantom-queued.
 *  - **B-10 rehydration**: on first mount with an authenticated wallet, we
 *    call `queueStatus` once and populate `queued` if the server says we're
 *    still in queue (e.g. user reloaded the page mid-queue).
 */
export function useQueueState(): UseQueueStateResult {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // F-Z2 / F-AA1: closure-fresh state access for async effects (initial
  // rehydrate + reconnect watcher). Updated in a layout-style effect that
  // re-runs whenever `state` changes; readers consult `stateRef.current`
  // INSIDE async work to detect user actions that happened during awaits.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const { address } = useAccount();
  const auth = useAuth();

  // Refs for the imperative-API guards (don't trigger renders).
  const inFlightRef = useRef(false); // is a join/leave REST in flight?
  const cancelDuringJoinRef = useRef(false); // user clicked cancel during join
  // F-Y4: stashes the in-flight join request so the WS `queue_joined`
  // event can recover the queue session if the POST /queue HTTP response
  // was lost (e.g., transport timeout AFTER the server inserted the
  // row + emitted the event). Cleared on join success/error/cancel.
  const pendingJoinRef = useRef<{ teamId: string; stakeAmount: string } | null>(null);

  // Subscribe to address-room WS events. Only opens when state is non-idle —
  // matches the lazy-open decision from the scoping pass.
  const wsActive =
    state.kind === 'joining' ||
    state.kind === 'queued' ||
    state.kind === 'cancelling' ||
    state.kind === 'matched';

  const wsAddress = wsActive ? address : undefined;
  const ws = useBattleWs(null, wsAddress);

  // Drain WS events into the reducer. Tracks last seen index to avoid replaying
  // events on re-renders.
  const lastEventIdxRef = useRef(0);
  useEffect(() => {
    const events = ws.events;
    if (events.length <= lastEventIdxRef.current) return;
    for (let i = lastEventIdxRef.current; i < events.length; i++) {
      // F-Y4: pass pendingJoinRef so the `queue_joined` handler can
      // recover state if the POST /queue HTTP response was lost.
      handleWsEvent(events[i], dispatch, pendingJoinRef);
    }
    lastEventIdxRef.current = events.length;
  }, [ws.events]);

  // B-22 fix: when the wallet disconnects mid-queue, the local state would
  // otherwise get stranded — `leaveQueue` short-circuits at `!auth.isConnected`
  // so the user has no UI handle on their queue row. Reset to `idle` and
  // clear the rehydration ref. The server-side row stays until the user
  // reconnects (rehydration restores the queued state from server, OR the
  // user reconnects with a different wallet and stays idle).
  useEffect(() => {
    if (auth?.isConnected) return;
    rehydratedRef.current = false;
    if (state.kind !== 'idle' && state.kind !== 'cancelled' && state.kind !== 'errored') {
      // F-II1: this effect captures `state` at the render its `auth.isConnected`
      // dep changed. If a same-flush WS event has advanced state since
      // then (e.g., queued → matched via ws_match_found), an unconditional
      // `reset` here would clobber that newer state. Reducer-guard with
      // the observed kind — the reducer rejects if state has moved past
      // the kind we saw.
      dispatch({ type: 'reset_if_kind', expectedKind: state.kind });
    }
    // We intentionally don't depend on `state` here — that would re-fire on
    // every state transition while disconnected, which is fine but noisy.
    // The next state mutation (or auth reconnect) re-runs the effect via the
    // auth dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.isConnected]);

  // B-10 fix: rehydrate from server on mount. If the user was already in
  // queue when they last left this page (or refreshed mid-queue), the state
  // machine starts at `idle` but the server still has their queue row. Fetch
  // queueStatus once on connect; if `inQueue`, populate `queued` so the UI
  // matches reality and the user can cancel via UI.
  //
  // B-19/B-23 fix: only mark `rehydratedRef.current = true` AFTER a
  // successful dispatch (or a clean inQueue=false response). Setting it
  // before the async work would (a) break under React StrictMode dev's
  // double-mount — mount #1 sets ref=true, cleanup cancels its dispatch,
  // mount #2 sees ref=true and bails out, so rehydration never runs — and
  // (b) prevent retry if the first fetch fails due to a transient network
  // hiccup.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (!auth?.isConnected || rehydratedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await auth.getAuthHeaders();
        const status = await api.combat.queueStatus(headers);
        if (cancelled) return;
        if (status.inQueue) {
          if (
            status.bracket == null ||
            status.power == null ||
            !status.radius ||
            !status.teamId ||
            !status.enqueuedAt
          ) {
            // Server says we're in queue but the response is missing fields.
            // Don't rehydrate; leave ref=false so a later auth-change will retry.
            return;
          }
          dispatch({
            type: 'rehydrate_queued',
            bracket: status.bracket,
            power: status.power,
            radius: status.radius,
            since: new Date(status.enqueuedAt).getTime(),
            teamId: status.teamId,
            // F-Y3: rehydrated queueId so post-rehydrate WS events compare
            // against the canonical PK (matches what the matchmaker tags
            // payloads with).
            queueId: status.queueId,
          });
        } else if (status.recentBattle) {
          // F-Z3: page-mount rehydration also consumes `recentBattle`. If
          // the user refreshed mid-deposit-window (or returned from a tab
          // that was hidden when match_found fired), they'd otherwise land
          // in `idle` despite a battle waiting for their deposit. The
          // matched UI then never renders and the address-room WS never
          // subscribes, so the reconnect-watcher (PR 6) can't repair it.
          //
          // F-AA1: skip dispatch if the user clicked Join during the
          // queueStatus await. The reducer guard on `rehydrate_matched`
          // already rejects from `joining`, but checking here also lets us
          // log a clearer diagnostic and avoids the wasted dispatch.
          // F-AA2: validate the payload before dispatch to avoid building a
          // MatchedState with undefined fields.
          if (stateRef.current.kind === 'idle') {
            const matched = toMatchedStateFromRecent(status.recentBattle);
            if (matched) {
              dispatch({ type: 'rehydrate_matched', payload: matched });
            }
            // If the payload was malformed, fall through to mark the
            // rehydration "done" — a retry on every auth-change isn't useful
            // when the server is sending bad data.
          }
        }
        // Mark done only after a clean success (inQueue=false OR a complete
        // rehydration dispatch). Failures leave the ref=false so the next
        // auth-state change retries.
        rehydratedRef.current = true;
      } catch {
        // Rehydration is best-effort; failure leaves the ref=false so the
        // next auth-state change retries the call.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  // F-X1 (PR 6): post-WS-reconnect reconciliation. The first connect is
  // handled by the rehydratedRef path above; subsequent reconnects (e.g.
  // after a 1008 signature-expiry close → useBattleWs's auto-reconnect)
  // can miss events fired during the disconnect window. Re-fetch
  // queue/status after each reconnect transition and reconcile.
  //
  // Specifically: if the server reports a `recentBattle` for our address
  // (within the deposit window), dispatch `rehydrate_matched` so the UI
  // catches up to the matched state we'd have learned about via the now-
  // dropped `match_found` WS event.

  // F-Z2: `stateRef` (hoisted above) gives the watcher access to the
  // current state without making `state` a useEffect dep (which would
  // re-run the effect on every state change and break the
  // connect-transition detection).
  // F-Y4: clear the in-flight-join ref once we've definitively advanced
  // past the join attempt (queued/matched/cancelled/idle). We keep the ref
  // set while in `joining` (race with POST response) AND `errored` (so a
  // late `queue_joined` WS event can still recover the session). The ref
  // is also overwritten by the next `joinQueue` call's initial set.
  useEffect(() => {
    if (state.kind !== 'joining' && state.kind !== 'errored') {
      pendingJoinRef.current = null;
    }
  }, [state.kind]);

  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (!auth?.isConnected) {
      wasConnectedRef.current = false;
      return;
    }
    if (!ws.connected) {
      wasConnectedRef.current = false;
      return;
    }
    if (wasConnectedRef.current) return; // not a reconnect
    wasConnectedRef.current = true;

    // Skip the very first connect — `rehydratedRef` already covered it.
    if (!rehydratedRef.current) return;

    // F-Z2: don't reconcile while a join is in flight. The first WS open
    // typically happens AFTER the user clicks Join (useBattleWs only
    // subscribes when the address is set), but `rehydratedRef.current` is
    // true from page-mount — without this guard, the reconnect watcher
    // would fire for a non-reconnect "first WS open after join" and
    // potentially clobber `joining` state with a stale `recentBattle`
    // from an unrelated prior session.
    if (stateRef.current.kind === 'joining') return;

    let cancelled = false;
    (async () => {
      // F-AA3: bounded retry on queueStatus failure. The reconnect-watcher
      // is the only path that recovers a missed `match_found` after a
      // disconnect; silently swallowing a single fetch error leaves the
      // user stuck in stale `queued` state until the next WS reconnect.
      // 3 attempts at 1s/3s/10s — enough to cover a momentary network
      // blip without being annoying for legitimate auth-popup failures.
      const RECONNECT_FETCH_BACKOFFS_MS = [0, 1_000, 3_000, 10_000];
      let lastErr: unknown = null;
      for (const delay of RECONNECT_FETCH_BACKOFFS_MS) {
        if (cancelled) return;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
          if (cancelled) return;
        }
        try {
          const headers = await auth.getAuthHeaders();
          const status = await api.combat.queueStatus(headers);
          if (cancelled) return;
          // F-Z2 belt-and-suspenders: re-check state after the await. The
          // user could have started a join during the queueStatus fetch.
          if (stateRef.current.kind === 'joining') return;
          if (status.recentBattle) {
            // F-AA2: validate before dispatch.
            const matched = toMatchedStateFromRecent(status.recentBattle);
            if (matched) {
              dispatch({ type: 'rehydrate_matched', payload: matched });
            }
          }
          // Other reconciliation cases (server-says-queued + we-think-idle,
          // server-says-idle + we-think-queued) are intentionally not handled
          // here — they require deeper state inspection. Future enhancement:
          // extend `rehydrate_queued` to accept from non-idle. For now the
          // rehydratedRef-once flow plus the `recentBattle` recovery is
          // sufficient for the F-X1 reconnect gap (the most material case).
          return; // success
        } catch (err) {
          lastErr = err;
          // fall through to next backoff
        }
      }
      // F-BB4: skip the warn if the effect was cancelled (component
      // unmounted, ws disconnected, auth toggled). A cancelled flow isn't
      // a real exhausted-retry failure and shouldn't surface as one in
      // dev/test logs.
      if (cancelled) return;
      // All retries failed. Log so devs can see prolonged reconciliation
      // outages; the next WS reconnect will retry the full flow.
      console.warn(
        '[useQueueState] reconnect reconciliation failed after %d attempts; last err:',
        RECONNECT_FETCH_BACKOFFS_MS.length,
        lastErr,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, ws.connected]);

  // Codex PR-B FU2-M1 (MEDIUM): when the connected wallet switches (A → B,
  // both connected), reset the queue state so the new wallet doesn't
  // inherit the old wallet's queued/matched/errored UI. Without this:
  //   - `auth?.isConnected` is just `!!address` (`use-auth.ts:155`), so
  //     it stays `true` across wallet switches, the queued polling
  //     effect doesn't re-run, and the captured `auth.getAuthHeaders`
  //     closure keeps signing as wallet A while WS subscribes as wallet B.
  //   - The reducer state persists across the same hook instance, so
  //     wallet B sees wallet A's `queued`/`matched` view.
  // Resetting on address change forces the initial-rehydrate path to
  // re-run for the new address (see rehydratedRef below).
  const lastAddressRef = useRef<string | undefined>(address);
  useEffect(() => {
    if (lastAddressRef.current !== address) {
      lastAddressRef.current = address;
      dispatch({ type: 'reset' });
      rehydratedRef.current = false;
    }
  }, [address]);

  // Codex PR-B HIGH-2: poll /queue/status while queued so users matched
  // by the ticker (i.e. async — after POST /queue returned `queued`)
  // learn about the match without a reload or WS reconnect. PR-B removed
  // the matchmaker's inline `match_found` WS emit (engine handles the
  // lifecycle now, but the cross-process WS bridge is deferred to X10).
  // Without this polling, ticker-matched players would stay visually
  // stuck in `queued` until incidental recovery fires.
  //
  // Codex PR-B FU-1 (HIGH): deps use `auth?.isConnected` (a stable boolean)
  // instead of `auth` itself. The queue page re-renders every ~1s for the
  // elapsed-time display; `useAuth()` returns a fresh object literal each
  // call (see apps/web/src/hooks/use-auth.ts:155). Depending on `auth`
  // tore down + recreated the 3s interval on every render, so the timer
  // never survived long enough to fire. The captured `auth` in the
  // closure still works for `getAuthHeaders` (wrapped in useCallback so
  // the function reference is stable). Also fires `void tick()`
  // immediately so the first poll doesn't wait the full 3s after queued
  // state entry.
  const QUEUED_POLL_INTERVAL_MS = 3_000;
  useEffect(() => {
    if (state.kind !== 'queued') return;
    if (!auth?.isConnected) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || stateRef.current.kind !== 'queued') return;
      if (!auth?.isConnected) return;
      try {
        const headers = await auth.getAuthHeaders();
        const status = await api.combat.queueStatus(headers);
        if (cancelled || stateRef.current.kind !== 'queued') return;
        // Codex PR-B FU-2 (MEDIUM): handle the create-failed signal. The
        // /queue/status response now exposes `failedRecentBattle` (a
        // status=4 row in the matched window). Dispatch an error so the
        // queued UI exits to a "couldn't be created — please re-queue"
        // state instead of staying visually stuck.
        if (status.failedRecentBattle) {
          dispatch({
            type: 'error',
            error: `Match couldn't be created: ${status.failedRecentBattle.battleId}`,
          });
          return;
        }
        if (!status.inQueue && status.recentBattle) {
          const matched = toMatchedStateFromRecent(status.recentBattle);
          if (matched) {
            dispatch({ type: 'rehydrate_matched', payload: matched });
          }
        }
      } catch {
        // transient (auth signature failure, network blip) — next tick
        // retries. No backoff: 3s cadence is gentle enough on its own.
      }
    };
    void tick();
    const id = setInterval(tick, QUEUED_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Codex PR-B FU2-M1 (MEDIUM): include `address` so a wallet switch
    // (A → B while both connected, `isConnected` stays true) re-runs the
    // effect with a fresh auth closure. The address-change reset effect
    // above also transitions state.kind → idle on switch, so this dep
    // is belt+suspenders for the brief render window before the reset
    // dispatch propagates.
  }, [state.kind, auth?.isConnected, address]);

  // Imperative API ─────────────────────────────────────

  const joinQueue = useCallback(
    async (teamId: string, stakeAmount: string) => {
      // B-03 re-entry guard: silently drop concurrent calls (e.g. double-click).
      if (inFlightRef.current) return;
      if (!auth?.isConnected) {
        // F-II2: reducer-guarded — only transitions to `errored` from
        // joinable kinds. A stale UI callback firing `joinQueue` while
        // state is already queued/matched (e.g. the user previously
        // joined, then disconnected their wallet, then their wallet
        // reconnected as a different address and they clicked Join from
        // a stale view) must not clobber active state.
        dispatch({ type: 'error_if_joinable', error: 'Not authenticated' });
        return;
      }
      inFlightRef.current = true;
      cancelDuringJoinRef.current = false;
      // F-Y4: stash join params BEFORE the await so a late WS `queue_joined`
      // event arriving for THIS join can recover the queue session if the
      // POST response is lost (transport timeout after server-side success).
      pendingJoinRef.current = { teamId, stakeAmount };
      dispatch({ type: 'join_start' });
      // F-16-a: `since` is preferentially populated from the server's
      // `enqueuedAtMs` (set after the API call). The client-side `Date.now()`
      // is only a fallback for legacy server responses without the field.
      // F-3J: hoist `headers` outside the try so the catch can run a
      // best-effort compensating leaveQueue if the join POST itself threw
      // (e.g. transport timeout) AFTER the server already created a queue
      // row or matched the player. Without this, an in-flight cancel +
      // network failure leaves a phantom server-side state.
      let headers: Awaited<ReturnType<typeof auth.getAuthHeaders>> | null = null;
      try {
        headers = await auth.getAuthHeaders();
        const res = await api.combat.joinQueue(teamId, stakeAmount, headers);

        // B-04 fix: if the user clicked cancel mid-join, fire a compensating
        // leaveQueue so we don't sit phantom-queued server-side. The reducer
        // already moved us to `idle` via `leave_start`; we just need to clean
        // up the server.
        if (cancelDuringJoinRef.current) {
          // F-3I: if the POST itself returned `matched`, the user lost the
          // cancel-vs-match race. Honor the matched response directly
          // instead of asking DELETE /queue to rediscover it (which it
          // can't if F-3H's window applies — the battle row may not exist
          // yet).
          if (
            res.status === 'matched' &&
            res.battleId &&
            res.opponent &&
            res.bracket != null &&
            res.yourPower != null &&
            res.opponentPower != null
          ) {
            dispatch({
              type: 'leave_revealed_match',
              payload: {
                kind: 'matched',
                battleId: res.battleId,
                opponent: res.opponent,
                yourPower: res.yourPower,
                opponentPower: res.opponentPower,
                powerDelta: res.opponentPower - res.yourPower,
                bracket: res.bracket,
              },
            });
            return;
          }

          // F-3A: the compensating leaveQueue can ALSO race the matchmaker.
          // If the server returns the matched-response shape, transition to
          // `matched` rather than dropping the user into `cancelled`.
          try {
            const cancelRes = await api.combat.leaveQueue(headers);
            if (
              cancelRes.matched &&
              cancelRes.battleId &&
              cancelRes.opponent &&
              cancelRes.bracket != null &&
              cancelRes.yourPower != null &&
              cancelRes.opponentPower != null
            ) {
              dispatch({
                type: 'leave_revealed_match',
                payload: {
                  kind: 'matched',
                  battleId: cancelRes.battleId,
                  opponent: cancelRes.opponent,
                  yourPower: cancelRes.yourPower,
                  opponentPower: cancelRes.opponentPower,
                  powerDelta: cancelRes.opponentPower - cancelRes.yourPower,
                  bracket: cancelRes.bracket,
                },
              });
              return;
            }
          } catch {
            // Best-effort cleanup. If this fails the user can re-enter the
            // queue UI which will rehydrate from queueStatus and surface the
            // stale row.
          }
          // F-FF1: reducer-guarded so a `matched` state that a WS event
          // raced into during the join HTTP flight isn't clobbered.
          dispatch({ type: 'left_if_cancelling' });
          return;
        }

        if (res.status === 'matched') {
          if (!res.battleId || !res.opponent || res.yourPower == null || res.opponentPower == null || res.bracket == null) {
            // F-HH3: reducer-guarded so a malformed-payload error doesn't
            // clobber a WS-advanced state (rare but possible if a WS
            // match_found landed during the join HTTP flight).
            dispatch({ type: 'error_if_joining', error: 'Server matched but returned incomplete payload' });
            return;
          }
          dispatch({
            type: 'join_matched_immediate',
            payload: {
              kind: 'matched',
              battleId: res.battleId,
              opponent: res.opponent,
              yourPower: res.yourPower,
              opponentPower: res.opponentPower,
              powerDelta: res.opponentPower - res.yourPower,
              bracket: res.bracket,
            },
          });
        } else {
          // status === 'queued'
          if (res.bracket == null || res.power == null || !res.initialRadius) {
            // F-HH3: reducer-guarded same as the 'matched' arm above.
            dispatch({ type: 'error_if_joining', error: 'Server queued but returned incomplete payload' });
            return;
          }
          dispatch({
            type: 'join_queued',
            bracket: res.bracket,
            power: res.power,
            radius: res.initialRadius,
            // F-16-a: prefer the server's authoritative session id; without
            // it the WS stale-event filter would compare client- vs server-
            // derived timestamps and reject every legitimate event.
            since: res.enqueuedAtMs ?? Date.now(),
            teamId,
            // F-Y3: collision-proof session id from server. Reducer will
            // prefer this over `since` when both state and incoming events
            // carry it.
            queueId: res.queueId,
          });
        }
      } catch (err: unknown) {
        // F-3J: if the user cancelled mid-join AND we have headers (the auth
        // call succeeded), best-effort fire DELETE /queue to clean up any
        // server-side state that the join may have created before throwing.
        // Honor a matched response — same as the success-path cancel branch.
        // F-DD1: cancel-during-join is terminal regardless of whether auth
        // headers were obtained. The previous structure put the
        // `dispatch({type:'left'})` inside the `&& headers` block, so a
        // user who cancelled while `auth.getAuthHeaders()` was still
        // rejecting would land back at F-BB1's `!== 'joining'` check and
        // get silently stranded in `cancelling`. Hoist the cancel-terminal
        // dispatch above the headers check; the compensating leaveQueue
        // (which needs headers) becomes an inner conditional.
        if (cancelDuringJoinRef.current) {
          if (headers) {
            try {
              const cancelRes = await api.combat.leaveQueue(headers);
              if (
                cancelRes.matched &&
                cancelRes.battleId &&
                cancelRes.opponent &&
                cancelRes.bracket != null &&
                cancelRes.yourPower != null &&
                cancelRes.opponentPower != null
              ) {
                dispatch({
                  type: 'leave_revealed_match',
                  payload: {
                    kind: 'matched',
                    battleId: cancelRes.battleId,
                    opponent: cancelRes.opponent,
                    yourPower: cancelRes.yourPower,
                    opponentPower: cancelRes.opponentPower,
                    powerDelta: cancelRes.opponentPower - cancelRes.yourPower,
                    bracket: cancelRes.bracket,
                  },
                });
                return;
              }
            } catch {
              // Best-effort. The user can re-enter the queue UI to rehydrate.
            }
          }
          // F-CC2: dispatch terminal action to exit `cancelling` whether
          // the compensating leaveQueue succeeded with no match, failed,
          // or was skipped because headers were never obtained.
          // F-EE1/F-FF1/F-FF2: use the reducer-guarded
          // `left_if_cancelling` action — only transitions from
          // `cancelling`. If a WS event or reconcile advanced state to
          // `matched`/`queued` while the join HTTP was in flight, the
          // reducer rejects the transition. Reducer guard chosen over
          // caller-side `stateRef` check because the passive useEffect
          // that updates `stateRef` runs AFTER render commit — a
          // synchronously-dispatched `leave_start` could be invisible to
          // the caller-side check.
          dispatch({ type: 'left_if_cancelling' });
          return;
        }

        // F-BB1 / F-HH1: the previous `stateRef.current.kind !== 'joining'`
        // early-return was BOTH unsafe (stale stateRef when the catch
        // fires before the passive useEffect updates it — e.g. an
        // immediate `getAuthHeaders()` rejection) AND redundant (the
        // final `error_if_joining` dispatch is now reducer-guarded). The
        // queueStatus probe below is the authoritative recovery; it's
        // cheap to always attempt and idempotent — if state has already
        // moved, the reducer rejects the resulting `join_matched_immediate`
        // / `join_recovered_from_ws` / `error_if_joining` dispatches.

        // F-BB2: cold-join race fallback. If the WS subscription wasn't
        // open yet when the server emitted `queue_joined` (idle → join
        // means WS opens after render), the recovery event was lost.
        // Before declaring error, hit /queue/status as authoritative — if
        // the server has a queued row for us, recover the session from it.
        // This complements the WS-based recovery path with a REST-based
        // safety net.
        if (headers) {
          try {
            const status = await api.combat.queueStatus(headers);
            // F-HH1: removed the post-await `stateRef.current.kind !== 'joining'`
            // early-return for the same reason as the pre-probe one — stale
            // ref risk + redundant given reducer-guarded dispatches below.
            // The reducer's `join_recovered_from_ws` / `join_matched_immediate`
            // / `error_if_joining` cases all guard on `joining`, so a stale
            // dispatch is a safe no-op.
            if (
              status.inQueue &&
              status.bracket != null &&
              status.power != null &&
              status.radius &&
              status.enqueuedAt
            ) {
              dispatch({
                type: 'join_recovered_from_ws',
                bracket: status.bracket,
                power: status.power,
                radius: status.radius,
                since: new Date(status.enqueuedAt).getTime(),
                teamId,
                queueId: status.queueId,
              });
              pendingJoinRef.current = null;
              return;
            }
            if (status.recentBattle) {
              const matched = toMatchedStateFromRecent(status.recentBattle);
              if (matched) {
                // F-CC1: dispatch `join_matched_immediate` (accepts from
                // `joining`) instead of `rehydrate_matched` (which the
                // reducer rejects from `joining` per F-AA1). We KNOW we're
                // still in `joining` here — the F-BB1 short-circuit above
                // would have returned otherwise.
                dispatch({ type: 'join_matched_immediate', payload: matched });
                return;
              }
            }
          } catch {
            // Best-effort — fall through to error if the recovery probe fails.
          }
        }

        // F-GG2: reducer-guarded so a WS-recovered `queued` state (via
        // `queue_joined` → `join_recovered_from_ws`) isn't clobbered by
        // a late join-HTTP rejection. Replaces F-BB1's caller-side
        // `stateRef` check, which had a passive-effect timing window.
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'error_if_joining', error: msg });
      } finally {
        inFlightRef.current = false;
      }
    },
    [auth],
  );

  const leaveQueue = useCallback(async () => {
    if (!auth?.isConnected) return;

    // B-04 fix: a join REST is in flight. Don't issue our own leave REST yet
    // — the join handler will fire it once it knows the queue row exists.
    // We DO dispatch `leave_start` so the UI flips to idle immediately;
    // the reducer's race guards on `join_queued` / `join_matched_immediate`
    // ensure the late join response can't pull us back to queued.
    if (inFlightRef.current) {
      cancelDuringJoinRef.current = true;
      dispatch({ type: 'leave_start' });
      return;
    }

    inFlightRef.current = true;
    dispatch({ type: 'leave_start' });
    try {
      const headers = await auth.getAuthHeaders();
      const res = await api.combat.leaveQueue(headers);
      // F-15-b: server-side cancel-vs-match race detection. If the matchmaker
      // matched this player between our SELECT and DELETE, the server now
      // returns the matched battle's details so we can transition the UI to
      // `matched` instead of `cancelled`. Without this branch, the user
      // would think their cancel succeeded while actually being in a battle.
      if (res.matched && res.battleId && res.opponent && res.bracket != null && res.yourPower != null && res.opponentPower != null) {
        dispatch({
          type: 'leave_revealed_match',
          payload: {
            kind: 'matched',
            battleId: res.battleId,
            opponent: res.opponent,
            yourPower: res.yourPower,
            opponentPower: res.opponentPower,
            powerDelta: res.opponentPower - res.yourPower,
            bracket: res.bracket,
          },
        });
      } else {
        // F-GG1: main leave success path also uses the reducer-guarded
        // terminal. During the DELETE /queue await above, another reducer
        // path could have advanced state out of `cancelling` (e.g.,
        // `ws_match_cancelled` is accepted from cancelling, or a
        // reconcile dispatched `rehydrate_matched`). Without the guard,
        // this `left` would clobber `cancelled`/`matched`.
        dispatch({ type: 'left_if_cancelling' });
      }
    } catch (err: unknown) {
      // F-HH2: reducer-guarded so a WS-advanced state during the DELETE
      // /queue await isn't clobbered by the error dispatch. State could be
      // `matched` (rehydrate_matched fired) or `cancelled` (ws_match_cancelled
      // fired). The reducer's `error_if_cancelling` rejects from those.
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'error_if_cancelling', error: msg });
    } finally {
      inFlightRef.current = false;
    }
  }, [auth]);

  // F-II3: exported `reset()` is the "dismiss terminal toast and return
  // to idle" callback. Reducer-guarded so a stale UI handler (e.g. an
  // onClose passed to a long-lived component) can't clobber active
  // queue/match state if the user has since advanced past the terminal
  // toast that triggered it.
  const reset = useCallback(() => dispatch({ type: 'reset_if_terminal' }), []);

  return { state, joinQueue, leaveQueue, reset };
}

// ──────────── WS event → action mapping ────────────

function handleWsEvent(
  evt: BattleWsEvent,
  dispatch: React.Dispatch<Action>,
  // F-Y4: stashed in-flight join params so the WS `queue_joined` event
  // can recover the queue session when the POST /queue HTTP response was
  // lost. `null` in the ref means no in-flight join — `queue_joined`
  // becomes a no-op (the REST path will have populated state already).
  pendingJoinRef: React.MutableRefObject<{ teamId: string; stakeAmount: string } | null>,
): void {
  switch (evt.event) {
    case 'queue_joined': {
      // F-Y4: if the user has an in-flight join AND the WS event has the
      // session details, recover. Without this, a lost POST response
      // strands the user in `errored` while the server-side queue row
      // continues to live — they'd see "Server error" but a phantom
      // queue row that the matchmaker would match against.
      const pending = pendingJoinRef.current;
      if (!pending) return; // No in-flight join — REST path handled it.
      const data = evt.data as {
        bracket?: number;
        power?: number;
        initialRadius?: { low?: number; high?: number; halfWidth?: number | 'all' };
        enqueuedAtMs?: number;
        queueId?: string;
      };
      if (
        data.bracket == null ||
        data.power == null ||
        !data.initialRadius ||
        data.initialRadius.low == null ||
        data.initialRadius.high == null
      ) {
        return; // malformed — let the REST path handle
      }
      // F-BB3 / F-CC3 / F-DD2: require a canonical server-side session id.
      // Without `queueId` OR a usable `enqueuedAtMs`, falling back to
      // `Date.now()` for `state.since` would diverge from any
      // server-emitted future event — `sessionMatches` would then reject
      // every legitimate event.
      //
      // F-DD2: tighten both validations. `enqueuedAtMs` must be a finite
      // positive number AT LEAST 1.7e12 (year 2023 in JS-ms — comfortably
      // before the V3 S1 launch window and well past sentinel values like
      // 0 or 1). `queueId` must be a non-empty string (empty would compare
      // unequal to any real server-emitted queueId, poisoning the filter).
      const MIN_PLAUSIBLE_TIMESTAMP_MS = 1_700_000_000_000; // 2023-11-14
      const hasUsableTimestamp =
        typeof data.enqueuedAtMs === 'number' &&
        Number.isFinite(data.enqueuedAtMs) &&
        data.enqueuedAtMs >= MIN_PLAUSIBLE_TIMESTAMP_MS;
      const hasUsableQueueId =
        typeof data.queueId === 'string' && data.queueId.length > 0;
      if (!hasUsableTimestamp && !hasUsableQueueId) {
        return;
      }
      dispatch({
        type: 'join_recovered_from_ws',
        bracket: data.bracket,
        power: data.power,
        radius: {
          low: data.initialRadius.low,
          high: data.initialRadius.high,
          halfWidth: data.initialRadius.halfWidth,
        },
        // F-DD2: prefer the validated timestamp; only fall back to Date.now()
        // if NO usable timestamp was provided (in which case `hasUsableQueueId`
        // must have been true — see the early return above).
        since: hasUsableTimestamp ? (data.enqueuedAtMs as number) : Date.now(),
        teamId: pending.teamId,
        // F-DD2: don't ship empty-string queueIds — they'd compare unequal
        // to any real server-emitted queueId, breaking sessionMatches.
        queueId: hasUsableQueueId ? data.queueId : undefined,
      });
      // Clear so a subsequent (post-recovery) WS replay doesn't re-fire.
      pendingJoinRef.current = null;
      return;
    }

    case 'search_expanded': {
      const data = evt.data as {
        newRadius?: { low?: number; high?: number };
        halfWidth?: number | string;
        enqueuedAtMs?: number;
        queueId?: string;
      };
      if (data.newRadius?.low == null || data.newRadius?.high == null) return;
      dispatch({
        type: 'ws_radius_expanded',
        radius: {
          low: data.newRadius.low,
          high: data.newRadius.high,
          halfWidth: data.halfWidth as number | 'all' | undefined,
        },
        enqueuedAtMs: data.enqueuedAtMs,
        queueId: data.queueId,
      });
      return;
    }

    case 'match_found': {
      const data = evt.data as {
        battleId?: string;
        opponent?: string;
        yourPower?: number;
        opponentPower?: number;
        powerDelta?: number;
        stakeBracket?: number;
        enqueuedAtMs?: number;
        queueId?: string;
      };
      if (!data.battleId || !data.opponent || data.yourPower == null || data.opponentPower == null || data.stakeBracket == null) return;
      dispatch({
        type: 'ws_match_found',
        payload: {
          kind: 'matched',
          battleId: data.battleId,
          opponent: data.opponent,
          yourPower: data.yourPower,
          opponentPower: data.opponentPower,
          powerDelta: data.powerDelta ?? data.opponentPower - data.yourPower,
          bracket: data.stakeBracket,
        },
        enqueuedAtMs: data.enqueuedAtMs,
        queueId: data.queueId,
      });
      return;
    }

    case 'match_cancelled': {
      const data = evt.data as { reason?: string; elapsedSec?: number; enqueuedAtMs?: number; queueId?: string };
      dispatch({
        type: 'ws_match_cancelled',
        reason: data.reason ?? 'unknown',
        elapsedSec: data.elapsedSec,
        enqueuedAtMs: data.enqueuedAtMs,
        queueId: data.queueId,
      });
      return;
    }

    default:
      // Unknown / battle-room event — not relevant for queue state.
      return;
  }
}
