'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ActivityEvent } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws';

interface UseActivityFeedOptions {
  /** Max events per page (default 30) */
  limit?: number;
  /** Filter by event type */
  type?: string;
  /** Polling interval in ms (default 30000). Set 0 to disable. */
  pollInterval?: number;
  /** Enable WebSocket live updates (default true) */
  enableWs?: boolean;
}

interface UseActivityFeedResult {
  events: ActivityEvent[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
}

export function useActivityFeed(options: UseActivityFeedOptions = {}): UseActivityFeedResult {
  const {
    limit = 30,
    type,
    pollInterval = 30_000,
    enableWs = true,
  } = options;

  const [allEvents, setAllEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryClient = useQueryClient();

  // Initial fetch
  const { data, isLoading, error } = useQuery({
    queryKey: ['activity', 'recent', limit, type],
    queryFn: () => api.activity.recent(limit, undefined, type),
    refetchInterval: pollInterval > 0 ? pollInterval : false,
  });

  // Sync initial data
  useEffect(() => {
    if (data) {
      setAllEvents(data.events);
      setHasMore(data.nextCursor !== null);
      setCursor(data.nextCursor);
    }
  }, [data]);

  // Load more (pagination)
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await api.activity.recent(limit, cursor, type);
      setAllEvents((prev) => [...prev, ...more.events]);
      setHasMore(more.nextCursor !== null);
      setCursor(more.nextCursor);
    } catch {
      // Silently fail — user can retry
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, limit, type]);

  // WebSocket for live updates (prepend new events)
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enableWs) return;

    try {
      const ws = new WebSocket(`${WS_URL}?channel=activity`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'activity' && msg.data) {
            const newEvent: ActivityEvent = msg.data;
            // Filter by type if set
            if (type && newEvent.type !== type) return;
            setAllEvents((prev) => [newEvent, ...prev]);
            // Also invalidate the query so next poll gets fresh data
            queryClient.invalidateQueries({ queryKey: ['activity', 'recent'] });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        // WS failed — polling fallback handles it
      };

      return () => {
        ws.close();
        wsRef.current = null;
      };
    } catch {
      // WebSocket not available — polling handles it
      return;
    }
  }, [enableWs, type, queryClient]);

  return {
    events: allEvents,
    loading: isLoading,
    error: error ? (error as Error).message : null,
    hasMore,
    loadMore,
    loadingMore,
  };
}
