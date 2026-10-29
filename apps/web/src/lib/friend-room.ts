'use client';

/**
 * Battle Friends on the website (owner 2026-10-28): a link anyone can open and play from — no wallet on either side.
 *
 *   host (Dojo › Fight with friend › Create invite link)  →  /battle-friends/join#<roomId>.<secret>
 *   friend opens it → a guest session is minted silently → joined → the Dojo's Fight with friend tab, same lobby.
 *
 * The secret rides in the URL FRAGMENT, which browsers never send to a server or in a Referer; the join page strips
 * it from the address bar as soon as it has read it. The API stores only its hash and lets it be used once.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type FriendRoomView } from '@/lib/api';

export const FRIEND_JOIN_PATH = '/battle-friends/join';
/** Lobby poll: well inside the API's 90 requests/min per IP on room routes, quick enough to feel live. */
const POLL_MS = 2000;
/** How long the Dojo keeps an eye out for the friend's rematch after a battle. */
const REMATCH_WATCH_MS = 2 * 60_000;
const ROOM_KEY = 'clawbada.friend.room';
const INVITE_KEY = (roomId: string) => `clawbada.friend.invite.${roomId}`;
const ROOM_ID_RE = /^r_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isRoomId = (id: string | null | undefined): id is string => !!id && ROOM_ID_RE.test(id);
export const isTerminal = (s: FriendRoomView['status']) => s === 'ended' || s === 'expired' || s === 'cancelled';

export function inviteUrl(invite: string): string {
  return `${window.location.origin}${FRIEND_JOIN_PATH}#${invite}`;
}

/** `<roomId>.<secret>` from a fragment (with or without the #). Null when it isn't one. */
export function parseInvite(hash: string): { roomId: string; secret: string } | null {
  const raw = decodeURIComponent(hash.replace(/^#/, '')).trim();
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const roomId = raw.slice(0, dot), secret = raw.slice(dot + 1);
  if (!isRoomId(roomId) || !/^[A-Za-z0-9_-]{22,64}$/.test(secret)) return null;
  return { roomId, secret };
}

// The current room survives a refresh of the tab (sessionStorage: one tab, one lobby). The host's link too, so the
// lobby can still show it — it is the only copy of the secret.
const store = {
  get(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string) { try { sessionStorage.setItem(key, v); } catch { /* private mode: the lobby just won't survive a refresh */ } },
  del(key: string) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
};
export function savedRoomId(): string | null {
  const id = store.get(ROOM_KEY);
  return isRoomId(id) ? id : null;
}
export function saveRoom(roomId: string, invite?: string) {
  store.set(ROOM_KEY, roomId);
  if (invite) store.set(INVITE_KEY(roomId), invite);
}
export function savedInvite(roomId: string): string | null {
  return store.get(INVITE_KEY(roomId));
}
/** Which room a friend battle came from, so the way back from the battle can offer a rematch. */
const BATTLE_ROOM_KEY = (battleId: string) => `clawbada.friend.battle.${battleId}`;
export function rememberBattleRoom(battleId: string, roomId: string) { store.set(BATTLE_ROOM_KEY(battleId), roomId); }
export function roomOfBattle(battleId: string): string | null {
  const id = store.get(BATTLE_ROOM_KEY(battleId));
  return isRoomId(id) ? id : null;
}

export function forgetRoom(roomId?: string | null) {
  store.del(ROOM_KEY);
  if (roomId) store.del(INVITE_KEY(roomId));
}

/**
 * The lobby, polled. Stops on a closed room (ended / expired / cancelled) and once the battle has started — or, with
 * `untilRematch` (the Dojo just after a friend battle), once the finished room shows a rematch. `error` is set when the
 * room is gone or not ours (404) — the caller resets the tab.
 */
export function useFriendRoom(roomId: string | null, getAuthHeaders: () => Promise<Record<string, string>>, opts: { untilRematch?: boolean } = {}) {
  const untilRematch = !!opts.untilRematch;
  const [view, setView] = useState<FriendRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const authRef = useRef(getAuthHeaders);
  authRef.current = getAuthHeaders;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setError(null);
    if (!roomId) { setView(null); return; }
    let live = true;
    const since = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const v = await api.friend.room(roomId, await authRef.current());
        if (!live) return;
        setView(v);
        // After a battle (untilRematch): keep watching the finished room for the friend's rematch, for two minutes.
        if (untilRematch) {
          if (v.rematch || v.status !== 'ended' || Date.now() - since > REMATCH_WATCH_MS) return;
        } else if (isTerminal(v.status) || (v.status === 'in_battle' && v.battleId)) return;
      } catch (e) {
        if (!live) return;
        const msg = e instanceof Error ? e.message : 'Lost the lobby';
        if (/not found/i.test(msg)) { setError(msg); return; }
        // A blip (network, rate limit): keep polling, a little slower.
        timer = setTimeout(poll, POLL_MS * 2);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [roomId, tick, untilRematch]);
  return { view, setView, error, refresh: () => setTick((t) => t + 1) };
}

/** Share the link: the phone's share sheet where there is one, else the clipboard. Returns what happened. */
export async function shareInvite(url: string): Promise<'shared' | 'copied' | 'failed'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'Clawbada battle', text: 'Join me for a Clawbada battle — no wallet needed.', url });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'failed';   // the player closed the sheet
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}

export const canNativeShare = () => typeof navigator !== 'undefined' && typeof (navigator as Navigator & { share?: unknown }).share === 'function';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / denied permission: the classic selection copy.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
