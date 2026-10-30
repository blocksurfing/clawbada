'use client';

import './join.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { parseInvite, saveRoom } from '@/lib/friend-room';
import { BattleBackdrop } from '@/components/battle/battle-backdrop';

/**
 * Where an invite link lands (Battle Friends, owner 2026-10-28): `/battle-friends/join#<roomId>.<secret>`.
 * No wallet, no sign-up, no button: the secret is read from the fragment (and wiped from the address bar), a guest
 * session is minted silently, the seat is claimed, and the friend is taken to the Dojo's Fight with friend tab.
 *
 * The one exception is a player who already has a wallet connected whose session has run out: we never pop a
 * signature on a page load, so they get a single "Sign in to join" button instead.
 */
type Phase = 'joining' | 'needs-sign-in' | 'failed';

/** The lobby, carrying the review params (?auto ?speed ?stay — the harness and designer tools) through. */
function dojoUrl(roomId: string): string {
  const q = new URLSearchParams(window.location.search);
  const out = new URLSearchParams({ room: roomId });
  for (const k of ['auto', 'speed', 'stay', 'perf']) { const v = q.get(k); if (v) out.set(k, v); }
  return `/dojo?${out}`;
}

export default function JoinFriendBattlePage() {
  const router = useRouter();
  const { getAuthHeaders, hasLiveSession, kind, resolving } = useAuth({ allowGuest: true });
  const [phase, setPhase] = useState<Phase>('joining');
  const [message, setMessage] = useState<string | null>(null);
  const invite = useRef<{ roomId: string; secret: string } | null>(null);
  const started = useRef(false);

  // Read the invite once, then take it out of the address bar (history, screenshots, a pasted URL).
  useEffect(() => {
    invite.current = parseInvite(window.location.hash);
    if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!invite.current) { setPhase('failed'); setMessage('This link is missing its invite. Ask your friend to send it again.'); }
  }, []);

  const join = useCallback(async () => {
    const inv = invite.current;
    if (!inv) return;
    setPhase('joining');
    try {
      await api.friend.join(inv.roomId, inv.secret, await getAuthHeaders());
      saveRoom(inv.roomId);
      router.replace(dojoUrl(inv.roomId));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not join';
      // Your own link (you're the host): just go back to your lobby.
      if (/your own invite/i.test(msg)) { saveRoom(inv.roomId); router.replace(dojoUrl(inv.roomId)); return; }
      setPhase('failed');
      setMessage(/not valid|not found/i.test(msg) ? 'This invite has expired or was already used. Ask your friend for a new link.' : msg);
    }
  }, [getAuthHeaders, router]);

  // Join as soon as we know who we are: a guest (minted here, silently) or a wallet with a live session.
  useEffect(() => {
    if (started.current || resolving || !invite.current) return;
    if (kind === 'wallet' && !hasLiveSession()) { setPhase('needs-sign-in'); return; }
    started.current = true;
    void join();
  }, [resolving, kind, hasLiveSession, join]);

  return (
    <BattleBackdrop kind="dojo">
      <div className="friend-join" data-testid="friend-join" data-phase={phase}>
        <h1>Battle Friends</h1>
        {phase === 'joining' && <p>Joining your friend&apos;s battle…</p>}
        {phase === 'needs-sign-in' && (
          <>
            <p>Your wallet is connected. Sign in once to join your friend.</p>
            <button type="button" data-testid="friend-join-sign-in" onClick={() => { started.current = true; void join(); }}>Sign in to join</button>
          </>
        )}
        {phase === 'failed' && (
          <>
            <p data-testid="friend-join-error">{message}</p>
            <Link href="/dojo?vs=friend" data-testid="friend-join-dojo">Go to the Dojo</Link>
          </>
        )}
      </div>
    </BattleBackdrop>
  );
}
