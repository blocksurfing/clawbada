'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws';

interface BattleEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface BattleWsState {
  phase: 'disconnected' | 'connecting' | 'connected' | 'closed';
  events: BattleEvent[];
  lastEvent: BattleEvent | null;
  connected: boolean;
}

type Action =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'event'; event: BattleEvent }
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

export function useBattleWs(battleId: string | null, address: string | undefined) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!battleId || !address) return;

    dispatch({ type: 'connecting' });

    const ws = new WebSocket(`${WS_URL}?battleId=${battleId}&address=${address}`);
    wsRef.current = ws;

    ws.onopen = () => dispatch({ type: 'connected' });

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        dispatch({
          type: 'event',
          event: { type: data.type, data, timestamp: Date.now() },
        });
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => dispatch({ type: 'closed' });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [battleId, address]);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { ...state, reset };
}
