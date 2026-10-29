'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useModal } from 'connectkit';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { formatAddress } from '@/lib/format';
import { rememberPracticeOwner } from '@/lib/practice-owner';
import { DEFAULT_BOT, botInfo, type BotName } from '@/lib/bot-catalog';
import { exitBattleFullscreen, requestBattleFullscreen } from '@/lib/battle-fullscreen';
import { primeAudio } from '@/lib/audio-graph';
import { cancelBattleEntry, entryRevealed, originOf, startBattleEntry, windup } from '@/lib/battle-entry';
import { DojoRoom, type DojoChoice, type DojoLobster, type DojoTeam } from '@/components/dojo/dojo-room';
import { FriendLobby } from '@/components/dojo/friend-lobby';
import {
  canNativeShare, copyText, forgetRoom, inviteUrl, isRoomId, isTerminal, rememberBattleRoom, saveRoom, savedInvite, savedRoomId, shareInvite, useFriendRoom,
} from '@/lib/friend-room';
import type { ArenaTier } from '@/lib/arena-music.generated';

/** Dev review rosters (moved here from the old /game/battle Practice tab when Battle became a modal on the Shell,
 *  2026-10-11): every Special whose VFX is finished, random/fixed trios per tier, and the storm-review trio. The
 *  API resolves `trio_<class>_<tier>` and the named ids. Gated like before. */
const REVIEW_PRESETS = [
  { id: 'specials', label: 'Live specials · Bulwark/Tempest/Specter (Elite)' },
  { id: 'specials_evolved', label: 'Live specials · Evolved' },
  { id: 'specials_apex', label: 'Live specials · Apex' },
  { id: 'random_evolved', label: 'Random team · Evolved' },
  { id: 'random_elite', label: 'Random team · Elite' },
  { id: 'random_apex', label: 'Random team · Apex' },
  { id: 'evolved_mix', label: 'Evolved trio' },
  { id: 'elite_mix', label: 'Elite trio' },
  { id: 'apex_mix', label: 'Apex trio' },
  { id: 'team_kraken_ember_abyss_elite', label: 'Kraken · Ember · Abyss (Elite)' },
  { id: 'team_kraken_ember_abyss_apex', label: 'Kraken · Ember · Abyss (Apex)' },
  ...(['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'] as const).map((c) => ({ id: `trio_${c.toLowerCase()}`, label: `Trio · ${c} (Elite)` })),
  // Three Tempests on the Evolved arena: a Maelstrom every few turns under the gulls — the storm reaction review.
  { id: 'trio_tempest_evolved', label: 'Trio · Tempest (Evolved) · storm review' },
] as const;
/** The "Review presets (dev)" block and its ?preset= deep link: local dev only (`next dev`, where the browser harness
 *  runs). Hidden from every deployed build for now (owner 2026-10-24), whatever NEXT_PUBLIC_PRACTICE_PRESETS says —
 *  to bring it back on a deployed review stack, restore `process.env.NEXT_PUBLIC_PRACTICE_PRESETS === 'true' ||`. */
const presetsAllowed = process.env.NODE_ENV !== 'production';

/**
 * The dojo: fight a bot with your own lobsters or with any three-class team at any tier and purity. The view is
 * Nzib's Dojo (components/dojo/dojo-room.tsx, design/website 5cb6655); everything about starting a battle is here.
 *
 * Off-chain like every practice battle — no stakes, no rating, no repair. It speaks the API's
 * `team_<a>_<b>_<c>_<tier>` preset plus `purity`, which the API keeps open even when the dev
 * presets are switched off. The review presets block below (dev only) is what the harness and the
 * designer's `?preset=` deep links use since practice moved here from the old /game/battle page.
 *
 * No wallet needed (owner decision 2026-10-18, the community's "come try it" hook): without one, the
 * first Battle press mints a guest session (POST /api/auth/guest) that the API accepts for practice battles
 * only. A connected wallet always wins, and adds My lobsters: its own lobsters (teamId / lobsterIds), which
 * fight with the tier and purity in their DNA.
 *
 * Bots come from lib/bot-catalog.ts: easiest first, each with how it plays and what it teaches.
 *
 * Fight with friend (Battle Friends, owner 2026-10-28): the opponent card's second tab. Create invite link → the link
 * (lib/friend-room.ts) → the friend opens it, is joined as a guest on /battle-friends/join and lands HERE on the same
 * tab (?room=r_…). Both build a team and press Battle; the second press starts the battle and both enter it. No
 * wallet on either side — the guest session is minted by the first action, exactly like a bot battle.
 *
 * Deep links: ?class=kraken (three of one class) or ?team=kraken,ember,abyss, plus
 * ?tier= ?purity= ?bot= ?arena= ?opponent=. Review params ?auto= ?speed= ?stay= are carried
 * through to the battle page.
 */

const CLASSES = CLASS_NAMES_LIST.map((n) => n.toLowerCase());
const TIERS = ['evolved', 'elite', 'apex'] as const;
type Tier = (typeof TIERS)[number];
/** Boards: the Dojo (Nzib's training ground — the practice default since 2026-10-21), the three tier arenas for art
 *  review, or 'match' = the team's own tier. */
const ARENAS = ['dojo', ...TIERS] as const;
type Arena = 'match' | (typeof ARENAS)[number];

/** Nobody picked until the player chooses (owner 2026-10-26); deep links (?team ?class) still pre-fill. */
const DEFAULT_TEAM = ['', '', ''];
// Showcase by default (user decision 2026-09-21): Apex rigs are the best-looking assets and
// purity 6 fires the enhanced Special about one cast in three (5% + 5% × purity = 35%).
const DEFAULT_TIER: Tier = 'apex';
const DEFAULT_PURITY = 6;

export default function DojoPage() {
  const router = useRouter();
  const { getAuthHeaders, getSessionToken, hasLiveSession, address: identity, kind, resolving, walletStatus } = useAuth({ allowGuest: true });
  const { setOpen: openWalletPicker } = useModal();
  /** The signature gate (owner spec 2026-10-21): a wallet whose session has expired must sign BEFORE anything goes
   *  fullscreen or fades — 'expired' shows the prompt, 'signing' is the wallet popup, 'ready' offers Enter Training. */
  const [gate, setGate] = useState<'none' | 'expired' | 'signing' | 'ready'>('none');
  const [gateErr, setGateErr] = useState<string | null>(null);
  const [team, setTeam] = useState<string[]>(DEFAULT_TEAM);
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [purity, setPurity] = useState(DEFAULT_PURITY);
  const [bot, setBot] = useState<BotName>(DEFAULT_BOT);
  const [opponent, setOpponent] = useState<'mirror' | 'random'>('mirror');
  const [arena, setArena] = useState<Arena>('dojo');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Review presets (dev review stack + the browser harness): /dojo?preset=trio_tempest_evolved&auto=1.
  const [preset, setPreset] = useState('');

  // ── Fight with friend ──
  const [vs, setVs] = useState<'bot' | 'friend'>('bot');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendErr, setFriendErr] = useState<string | null>(null);
  const [friendNote, setFriendNote] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(canNativeShare()); }, []);
  // The lobby never asks a wallet to sign: it polls only while the session needs no prompt (guests always).
  const lobbyAuth = useCallback(async () => {
    if (!hasLiveSession()) throw new Error('session expired');
    return getAuthHeaders();
  }, [hasLiveSession, getAuthHeaders]);
  const { view: room, setView: setRoom, error: roomErr } = useFriendRoom(roomId, lobbyAuth);
  /** Just back from a friend battle (?after=<room>): the finished room, watched for a rematch (owner 2026-10-29). */
  const [afterId, setAfterId] = useState<string | null>(null);
  const { view: after } = useFriendRoom(roomId ? null : afterId, lobbyAuth, { untilRematch: true });
  /** The battle this page is already entering — the press that started it and the poll that sees it race. */
  const entering = useRef<string | null>(null);
  const closeRoom = useCallback((note: string | null) => {
    forgetRoom(roomId);
    setRoomId(null); setInviteLink(null); setShareLabel(null); setFriendNote(note);
    const q = new URLSearchParams(window.location.search);
    if (q.has('room')) { q.delete('room'); window.history.replaceState(null, '', `${window.location.pathname}${q.size ? `?${q}` : ''}`); }
  }, [roomId]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const one = q.get('class');
    const many = q.get('team')?.split(',');
    if (one && CLASSES.includes(one)) setTeam([one, one, one]);
    else if (many?.length === 3 && many.every((c) => CLASSES.includes(c))) setTeam(many);
    const t = q.get('tier');
    if (t && (TIERS as readonly string[]).includes(t)) setTier(t as Tier);
    const p = Number(q.get('purity'));
    if (q.has('purity') && Number.isInteger(p) && p >= 0 && p <= 6) setPurity(p);
    const b = q.get('bot');
    if (b && botInfo(b)) setBot(b as BotName);
    const a = q.get('arena');
    if (a && (a === 'match' || (ARENAS as readonly string[]).includes(a))) setArena(a as Arena);
    const o = q.get('opponent');
    if (o === 'mirror' || o === 'random') setOpponent(o);
    // Back from a friend battle: offer the rematch.
    const af = q.get('after');
    if (isRoomId(af)) { setAfterId(af); setVs('friend'); }
    // A friend's lobby: ?room= (the join page sends the friend here), or the one this tab was in before a refresh.
    const r = q.get('room');
    const rid = isRoomId(r) ? r : savedRoomId();
    if (rid) {
      saveRoom(rid);
      setRoomId(rid);
      setVs('friend');
      const inv = savedInvite(rid);
      if (inv) setInviteLink(inviteUrl(inv));
    } else if (q.get('vs') === 'friend') setVs('friend');
    const pr = q.get('preset');
    if (presetsAllowed && pr && REVIEW_PRESETS.some((x) => x.id === pr)) { setPreset(pr); if (pr.startsWith('random_')) setOpponent('random'); }
  }, []);

  // The wallet's own lobsters and saved teams for My lobsters (none for a guest).
  const wallet = kind === 'wallet' ? identity : null;
  const { data: lobstersData, isFetched: lobstersFetched } = useQuery({ queryKey: ['lobsters', wallet], queryFn: () => api.agent.lobsters(wallet!), enabled: !!wallet });
  const { data: teamsData } = useQuery({ queryKey: ['teams', wallet], queryFn: () => api.teams.list(wallet!), enabled: !!wallet });
  const lobsters: DojoLobster[] = useMemo(() => (lobstersData?.lobsters ?? []).map((l) => ({ id: l.tokenId, classIndex: l.class, className: l.className, tierName: l.tierName, tier: l.evolutionTier })), [lobstersData]);
  const teams: DojoTeam[] = useMemo(() => (teamsData?.teams ?? []).map((t) => ({ id: t.teamId, lobsterIds: t.lobsterIds })), [teamsData]);
  /** Wallets with three or more lobsters open on My lobsters, everyone else on Build a team (owner 2026-10-26); a deep
   *  link to a built team (?team ?class ?tier ?purity) always opens the builder. Null until the answer is known. */
  const [deepLinked, setDeepLinked] = useState(false);
  const initialMode = deepLinked || (resolving === false && kind !== 'wallet') ? 'builder'
    : kind === 'wallet' && lobstersFetched ? (lobsters.length >= 3 ? 'owned' : 'builder') : null;
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (['team', 'class', 'tier', 'purity'].some((k) => q.has(k))) setDeepLinked(true);
  }, []);

  /**
   * The entry sequence, shared by the Battle button and the dev presets:
   *   1. a wallet whose session needs a signature is stopped HERE — the gate panel asks it to sign first, so no
   *      wallet prompt ever lands inside a fullscreen fade (the owner's complaint of 2026-10-21);
   *   2. inside the click: the audio engine is primed and the practice start goes out;
   *   3. the Battle button winds up for 2 s (owner 2026-10-27; dojo-room shows it while `busy`) — a start that fails
   *      in that time shows its error and nothing else happens;
   *   4. then fullscreen (still within the browser's few seconds after the click) and the iris into the loading
   *      screen (lib/battle-entry.ts), which the battle page keeps up until the arena is built;
   *   5. the navigation, once the loading loop is fully open. A failure drops it all.
   * `teamTier` is the board 'match' resolves to (the music starts before the API answers).
   */
  const launch = useCallback(async (body: Parameters<typeof api.combat.createPractice>[0], failMessage: string, teamTier: Tier) => {
    if (kind === 'wallet' && !hasLiveSession()) { setGate('expired'); setGateErr(null); return; }
    primeAudio();   // start the shared audio engine inside the click: the entry's fades then run on the audio thread
    setBusy(true);
    setErr(null);
    // The iris will close on the Battle button (owner 2026-10-27) — where it is now, before the scene moves.
    const origin = originOf(document.querySelector('[data-testid=dojo-battle]'));
    const start = (async () => {
      const auth = await getAuthHeaders();
      return api.combat.createPractice(arena === 'match' ? body : { ...body, arena }, auth);
    })();
    let failed: unknown = null;
    start.catch((e: unknown) => { failed = e; });
    await windup();
    if (failed) { setErr(failed instanceof Error ? failed.message : failMessage); setBusy(false); return; }
    requestBattleFullscreen();
    // The arena's music starts with the loading screen's breeze and plays on into the battle (owner 2026-10-25).
    startBattleEntry({ kind: 'practice', arena: arena === 'match' ? teamTier : arena, origin });
    try {
      const res = await start;
      rememberPracticeOwner(res.battleId, res.snapshot?.session?.playerA);
      const q = new URLSearchParams(window.location.search);
      const carry = new URLSearchParams();
      for (const k of ['auto', 'speed', 'stay']) { const v = q.get(k); if (v) carry.set(k, v); }
      // Navigate once the loading loop is fully open, so the page switch (a main-thread freeze) never lands mid-iris.
      await entryRevealed();
      router.push(`/battle/${res.battleId}${carry.size ? `?${carry}` : ''}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : failMessage);
      setBusy(false);
      cancelBattleEntry();
      exitBattleFullscreen();
    }
  }, [kind, hasLiveSession, arena, getAuthHeaders, router]);

  const startPreset = useCallback(() => {
    if (!preset) return;
    return launch({ preset, bot, opponent }, 'Could not start the practice battle', tier);
  }, [preset, bot, opponent, tier, launch]);

  /**
   * Into a friend battle: the same entry as a bot battle (iris, loading loop, then the battle page). `gesture` = we are
   * inside the Battle press (the second player to press), so fullscreen can open; the first player arrives here from
   * the lobby poll with no gesture — the entry plays in the window, and the battle page's Full screen button is there.
   */
  const enterFriendBattle = useCallback(async (battleId: string, gesture: boolean, origin?: { x: number; y: number }) => {
    if (entering.current) return;
    entering.current = battleId;
    setBusy(true);
    try {
      if (gesture) requestBattleFullscreen();
      startBattleEntry({ kind: 'practice', arena: (room?.arena ?? 'dojo') as ArenaTier, origin: origin ?? originOf(document.querySelector('[data-testid=dojo-battle]')) });
      // The battle page plays as this identity (a guest stays the guest even if a wallet connects meanwhile).
      rememberPracticeOwner(battleId, identity ?? undefined);
      if (roomId) rememberBattleRoom(battleId, roomId);   // the way back offers a rematch from this room
      forgetRoom(roomId);
      const q = new URLSearchParams(window.location.search);
      const carry = new URLSearchParams();
      for (const k of ['auto', 'speed', 'stay']) { const v = q.get(k); if (v) carry.set(k, v); }
      await entryRevealed();
      router.push(`/battle/${battleId}${carry.size ? `?${carry}` : ''}`);
    } catch (e) {
      entering.current = null;
      setErr(e instanceof Error ? e.message : 'Could not start the friend battle');
      setBusy(false);
      cancelBattleEntry();
      exitBattleFullscreen();
    }
  }, [room?.arena, identity, roomId, router]);

  /** The friend Battle press: lock the team in. The second press starts the battle (its answer carries the id). */
  const launchFriend = useCallback(async () => {
    if (!roomId) return;
    if (kind === 'wallet' && !hasLiveSession()) { setGate('expired'); setGateErr(null); return; }
    primeAudio();
    setBusy(true);
    setErr(null);
    const origin = originOf(document.querySelector('[data-testid=dojo-battle]'));
    const start = (async () => {
      const auth = await getAuthHeaders();
      await api.friend.setTeam(roomId, { classes: team, tier, purity }, auth);
      return api.friend.ready(roomId, auth);
    })();
    let failed: unknown = null;
    start.catch((e: unknown) => { failed = e; });
    await windup();
    if (failed) { setErr(failed instanceof Error ? failed.message : 'Could not lock your team in'); setBusy(false); return; }
    const v = await start;
    setRoom(v);
    if (v.battleId) await enterFriendBattle(v.battleId, true, origin);
    else setBusy(false);   // locked in; the lobby poll brings the battle when the friend presses
  }, [roomId, kind, hasLiveSession, getAuthHeaders, team, tier, purity, setRoom, enterFriendBattle]);

  // The lobby's news: the battle started (the friend pressed second), or the room closed.
  useEffect(() => {
    if (roomErr) { closeRoom('That lobby is closed. Make a new link to play again.'); return; }
    if (!room) return;
    if (room.status === 'in_battle' && room.battleId) { void enterFriendBattle(room.battleId, false); return; }
    if (isTerminal(room.status) && !entering.current) {
      closeRoom(room.status === 'expired' ? 'The invite expired. Make a new link to play.'
        : room.status === 'cancelled' ? (room.opponent.joined ? 'The lobby was closed.' : null)
          : null);
    }
  }, [room, roomErr, closeRoom, enterFriendBattle]);

  /** One tap: ask for (or accept) the rematch. Both asks land in the same new room — sides swapped, both seated. */
  const rematch = useCallback(async () => {
    if (!afterId) return;
    if (kind === 'wallet' && !hasLiveSession()) { setGate('expired'); setGateErr(null); return; }
    setFriendBusy(true); setFriendErr(null); setFriendNote(null);
    try {
      const next = await api.friend.rematch(afterId, await getAuthHeaders());
      saveRoom(next.id);
      setAfterId(null);
      setInviteLink(null);
      setRoom(next);
      setRoomId(next.id);
      const q = new URLSearchParams(window.location.search);
      q.delete('after'); q.set('room', next.id);
      window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
    } catch (e) {
      setFriendErr(e instanceof Error ? e.message : 'Could not start the rematch');
    } finally {
      setFriendBusy(false);
    }
  }, [afterId, kind, hasLiveSession, getAuthHeaders, setRoom]);

  /** "No thanks" to the friend's rematch: close it, and offer a fresh link instead. */
  const declineRematch = useCallback(async () => {
    const offer = after?.rematch;
    setAfterId(null);
    setFriendNote(null);
    const q = new URLSearchParams(window.location.search);
    if (q.has('after')) { q.delete('after'); window.history.replaceState(null, '', `${window.location.pathname}${q.size ? `?${q}` : ''}`); }
    if (!offer) return;
    try { await api.friend.cancel(offer.roomId, await lobbyAuth()); } catch { /* already gone */ }
  }, [after, lobbyAuth]);

  const createLink = useCallback(async () => {
    if (kind === 'wallet' && !hasLiveSession()) { setGate('expired'); setGateErr(null); return; }
    setFriendBusy(true); setFriendErr(null); setFriendNote(null);
    setAfterId(null);
    try {
      const created = await api.friend.createRoom(await getAuthHeaders());
      saveRoom(created.roomId, created.invite);
      setInviteLink(inviteUrl(created.invite));
      setRoomId(created.roomId);
    } catch (e) {
      setFriendErr(e instanceof Error ? e.message : 'Could not make a link');
    } finally {
      setFriendBusy(false);
    }
  }, [kind, hasLiveSession, getAuthHeaders]);

  const leaveRoom = useCallback(async () => {
    const id = roomId;
    closeRoom(null);
    if (!id) return;
    try { await api.friend.cancel(id, await lobbyAuth()); } catch { /* already gone */ }
  }, [roomId, closeRoom, lobbyAuth]);

  const copyLink = useCallback(async () => {
    if (!inviteLink) return;
    setShareLabel((await copyText(inviteLink)) ? 'Link copied — send it to your friend. Waiting for them…' : 'Select the link and copy it.');
  }, [inviteLink]);
  const shareLink = useCallback(async () => {
    if (!inviteLink) return;
    const r = await shareInvite(inviteLink);
    if (r === 'copied') setShareLabel('Link copied — send it to your friend. Waiting for them…');
    else if (r === 'shared') setShareLabel('Link sent. Waiting for your friend…');
  }, [inviteLink]);

  /** The Battle press. Own lobsters fight with the tier and purity in their DNA; a saved team goes by its id. */
  const [lastChoice, setLastChoice] = useState<DojoChoice | null>(null);
  const start = useCallback((choice: DojoChoice) => {
    setLastChoice(choice);
    if (vs === 'friend') return launchFriend();
    if (choice.mode === 'builder') return launch({ preset: `team_${team.join('_')}_${tier}`, purity, bot, opponent }, 'Could not start the dojo battle', tier);
    const picked = choice.lobsterIds.map((id) => lobsters.find((l) => l.id === id));
    const lowest = Math.min(...picked.map((l) => l?.tier ?? 1));
    const teamTier: Tier = lowest >= 3 ? 'apex' : lowest === 2 ? 'elite' : 'evolved';
    const roster = choice.teamId ? { teamId: choice.teamId } : { lobsterIds: choice.lobsterIds };
    return launch({ ...roster, bot, opponent }, 'Could not start the dojo battle', teamTier);
  }, [vs, launchFriend, team, tier, purity, bot, opponent, lobsters, launch]);

  /** The gate's Sign in: the wallet prompt, with nothing else moving. Success turns the button into Enter Training. */
  const signIn = useCallback(async () => {
    setGate('signing');
    setGateErr(null);
    try {
      await getSessionToken();
      setGate('ready');
    } catch (e) {
      setGate('expired');
      setGateErr(e instanceof Error ? e.message : 'The wallet did not sign');
    }
  }, [getSessionToken]);

  return (
    <DojoRoom
      lobsters={lobsters}
      teams={teams}
      initialMode={initialMode}
      isWallet={kind === 'wallet'}
      onConnectWallet={() => openWalletPicker(true)}
      team={team} onTeam={setTeam}
      tier={tier} onTier={setTier}
      purity={purity} onPurity={setPurity}
      bot={bot} onBot={setBot}
      opponent={opponent} onOpponent={setOpponent}
      arena={arena} onArena={setArena}
      busy={busy}
      blocked={gate !== 'none'}
      error={err}
      onBattle={(choice) => { void start(choice); }}
      vs={vs}
      onVs={(v) => { setVs(v); setErr(null); }}
      friendOpponent={room && (room.status === 'seated' || room.status === 'in_battle') ? { joined: room.opponent.joined, lockedIn: room.opponent.lockedIn } : null}
      friendCanBattle={!!room && room.status === 'seated' && room.opponent.joined && !room.you.ready}
      friendPanel={
        <FriendLobby roomId={roomId} view={room} after={roomId ? null : after} inviteLink={inviteLink} busy={friendBusy} error={friendErr} note={friendNote}
          onRematch={() => { void rematch(); }} onDeclineRematch={() => { void declineRematch(); }}
          shareLabel={shareLabel} canShare={canShare}
          onCreate={() => { void createLink(); }} onCopy={() => { void copyLink(); }} onShare={() => { void shareLink(); }} onLeave={() => { void leaveRoom(); }} />
      }
      identity={
        /* The data attributes are for probes; wagmi's status differs between the server render and the client, hence the suppression. */
        <p className="dojo-identity" data-testid="dojo-identity" data-kind={kind ?? 'none'} data-resolving={resolving ? '1' : '0'} data-wallet-status={walletStatus} suppressHydrationWarning>
          {kind === 'wallet' && identity ? (
            <>Training as {formatAddress(identity)}</>
          ) : (
            <>Training as a guest · <button type="button" className="dojo-link" onClick={() => openWalletPicker(true)}>Connect a wallet</button></>
          )}
        </p>
      }
      gate={gate !== 'none' && (
        <div className="dojo-gate" data-testid="dojo-gate" data-gate={gate}>
          <p>{gate === 'ready' ? 'Signed in.' : gateErr ?? 'Session expired. Sign in to train.'}</p>
          {gate === 'ready' ? (
            <button type="button" onClick={() => { setGate('none'); if (lastChoice) void start(lastChoice); }}>Enter Training</button>
          ) : (
            <button type="button" onClick={signIn} disabled={gate === 'signing'}>{gate === 'signing' ? 'Waiting for the wallet…' : 'Sign in'}</button>
          )}
        </div>
      )}
      devTools={presetsAllowed && (
        <details className="dojo-presets" data-testid="dojo-presets" open={!!preset}>
          <summary>Review presets (dev)</summary>
          <select aria-label="Review preset" value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value.startsWith('random_')) setOpponent('random'); }}>
            <option value="">Preset (dev only)</option>
            {REVIEW_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button type="button" onClick={startPreset} disabled={busy || !preset}>{busy ? 'Starting…' : 'Start practice'}</button>
        </details>
      )}
    />
  );
}
