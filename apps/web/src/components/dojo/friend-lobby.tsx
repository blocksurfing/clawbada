'use client';

import { useEffect, useState } from 'react';
import type { FriendRoomView } from '@/lib/api';

/**
 * The Fight with friend panel (Battle Friends, owner 2026-10-28) — the view only; the Dojo page owns the room.
 * No room: one button makes an invite link. Host before the friend arrives: the link, Copy / Share, the time left.
 * In the lobby: who is where (the friend's team is never shown — only whether it is locked in), and Leave.
 * Back from a battle (`after`, 2026-10-29): Good game! → one-tap Rematch, or the friend's offer → Accept / No thanks.
 * Nothing here mentions a wallet: neither side needs one.
 */
export interface FriendLobbyProps {
  roomId: string | null;
  view: FriendRoomView | null;
  /** The finished room you just came back from (no current room), watched for a rematch. */
  after: FriendRoomView | null;
  /** The host's full invite URL (null for the guest, or after a lost tab). */
  inviteLink: string | null;
  busy: boolean;
  error: string | null;
  /** A closing note: "the invite expired", "your friend left". */
  note: string | null;
  shareLabel: string | null;
  canShare: boolean;
  onCreate: () => void;
  onCopy: () => void;
  onShare: () => void;
  onLeave: () => void;
  onRematch: () => void;
  onDeclineRematch: () => void;
}

function useCountdown(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso) return null;
  const left = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function FriendLobby(p: FriendLobbyProps) {
  const { view } = p;
  const left = useCountdown(view && (view.status === 'open' || view.status === 'seated') ? view.expiresAt : undefined);

  if (!p.roomId && p.after && p.after.status === 'ended') {
    const offer = p.after.rematch;
    const offered = offer && offer.offeredBy === 'opponent' && offer.status === 'seated';
    const declined = offer && offer.offeredBy === 'you' && offer.status === 'cancelled';
    return (
      <div className="dojo-friend" data-testid="friend-lobby" data-state="after" data-rematch={offered ? 'offered' : declined ? 'declined' : 'none'}>
        <p className="dojo-friend-headline">{offered ? 'Your friend wants a rematch!' : 'Good game!'}</p>
        <p className="dojo-help">
          {offered ? 'Same friend, sides swapped. Pick a new team — they won’t see it until the fight.'
            : declined ? 'Your friend said no thanks this time. Send a new link to play again.'
              : 'Play your friend again — one tap, sides swapped, new teams.'}
        </p>
        {p.error && <p className="dojo-friend-note" data-tone="error" data-testid="friend-error">{p.error}</p>}
        <div className="dojo-friend-actions">
          {!declined && (
            <button type="button" className="dojo-choice dojo-friend-primary" data-testid="friend-rematch" disabled={p.busy} onClick={p.onRematch}>
              {p.busy ? 'Opening…' : offered ? 'Accept' : 'Rematch'}
            </button>
          )}
          {offered
            ? <button type="button" className="dojo-choice" data-testid="friend-decline" disabled={p.busy} onClick={p.onDeclineRematch}>No thanks</button>
            : <button type="button" className="dojo-choice" data-testid="friend-create" disabled={p.busy} onClick={p.onCreate}>New invite link</button>}
        </div>
      </div>
    );
  }

  if (!p.roomId) {
    return (
      <div className="dojo-friend" data-testid="friend-lobby" data-state="none">
        <p className="dojo-help">Battle a friend: make a link and send it. They open it and they&apos;re in — no wallet, no sign-up.</p>
        {p.note && <p className="dojo-friend-note" data-testid="friend-note">{p.note}</p>}
        {p.error && <p className="dojo-friend-note" data-tone="error" data-testid="friend-error">{p.error}</p>}
        <div className="dojo-friend-actions">
          <button type="button" className="dojo-choice dojo-friend-primary" data-testid="friend-create" disabled={p.busy} onClick={p.onCreate}>
            {p.busy ? 'Making your link…' : 'Create invite link'}
          </button>
        </div>
      </div>
    );
  }

  if (!view) {
    return <div className="dojo-friend" data-testid="friend-lobby" data-state="loading"><p className="dojo-help">Opening the lobby…</p></div>;
  }

  const host = view.role === 'host';
  const opp = view.opponent;
  const oppState = !opp.joined ? 'none' : opp.ready ? 'ready' : opp.lockedIn ? 'locked' : 'picking';
  const youState = view.you.ready ? 'ready' : 'picking';

  return (
    <div className="dojo-friend" data-testid="friend-lobby" data-state={view.status} data-role={view.role}>
      {view.status === 'open' && host && (
        <>
          <p className="dojo-help">Send this link to a friend. Whoever opens it first joins you.</p>
          <div className="dojo-friend-link">
            <input data-testid="friend-link" readOnly value={p.inviteLink ?? ''} placeholder="Your link was made in another tab" aria-label="Invite link"
              onFocus={(e) => e.currentTarget.select()} />
          </div>
          <div className="dojo-friend-actions">
            <button type="button" className="dojo-choice dojo-friend-primary" data-testid="friend-copy" disabled={!p.inviteLink} onClick={p.onCopy}>Copy link</button>
            {p.canShare && <button type="button" className="dojo-choice" data-testid="friend-share" disabled={!p.inviteLink} onClick={p.onShare}>Share</button>}
            <button type="button" className="dojo-choice" data-testid="friend-cancel" onClick={p.onLeave}>Cancel</button>
          </div>
          <p className="dojo-friend-note" data-testid="friend-status" data-opponent="none" data-you={youState} role="status" aria-live="polite">
            {p.shareLabel ?? 'Waiting for your friend…'}{left && <span className="dojo-friend-time"> · link expires in {left}</span>}
          </p>
        </>
      )}
      {(view.status === 'seated' || view.status === 'in_battle') && (
        <>
          <p className="dojo-friend-headline">{view.rematchOf ? 'Rematch!' : host ? 'Your friend is here!' : 'You’re in! Battle your friend.'}</p>
          <ul className="dojo-friend-roster" data-testid="friend-status" data-opponent={oppState} data-you={youState} role="status" aria-live="polite">
            <li><span>Your friend</span><b>{oppState === 'ready' ? 'Ready' : oppState === 'locked' ? 'Locked in' : 'Picking a team…'}</b></li>
            <li><span>You</span><b>{view.status === 'in_battle' ? 'Starting…' : youState === 'ready' ? 'Locked in' : 'Picking a team…'}</b></li>
          </ul>
          <p className="dojo-help">
            {view.status === 'in_battle' ? 'Here we go!'
              : youState === 'ready' ? 'Waiting for your friend to press Battle…'
                : 'Pick three classes, a tier and purity, then press Battle. Your friend won’t see your team until the fight.'}
          </p>
          {left && view.status === 'seated' && <p className="dojo-friend-note dojo-friend-time">Lobby closes in {left}</p>}
          {view.status === 'seated' && (
            <div className="dojo-friend-actions">
              <button type="button" className="dojo-choice" data-testid="friend-cancel" onClick={p.onLeave}>Leave</button>
            </div>
          )}
        </>
      )}
      {p.error && <p className="dojo-friend-note" data-tone="error" data-testid="friend-error">{p.error}</p>}
    </div>
  );
}
