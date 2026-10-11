'use client';

import './shell.css';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { api, type LobsterData, type TeamData } from '@/lib/api';
import { useQueueState } from '@/hooks/use-queue-state';
import { AnimatedLobster } from '@/components/game/animated-lobster';
import { QueueRadiusBar } from '@/components/game/queue-radius-bar';
import { MatchFoundHud } from '@/components/game/match-found-hud';
import { formatGoldWei } from '@/lib/format';
import { mountShellArt, type ShellArt } from './shell-art';
import { mountShellTabs, type ShellTabs } from './shell-tabs';
import { BattleModal, type BattleEligibility } from './battle-modal';

/**
 * The Shell — Nzib's basecamp (design/website/workbench/pages/dashboard.html, baseline 3295433): the fullscreen
 * room, three stages with a lobster picker, the Battle button and its setup modal, the Queue / Active / History
 * overlays, the ambient shark, bubbles and seaweed. Dashboard and Battle live here now; Practice is the Dojo.
 *
 * Wired to the game (user, 2026-10-11): the picker lists the wallet's own lobsters and each stage shows that
 * lobster's own idle sprite; the lineup is remembered per wallet; Find Match is live when the three picks form
 * one of the player's teams and joins the real queue (`useQueueState`) with a stake bracket; the Queue overlay
 * is the live queue and the match-found flow; Active and History come from the battle history. With no lobsters
 * on a dev stack (`NEXT_PUBLIC_PRACTICE_PRESETS`), his sample classes stand in, labelled as such.
 */
const CLASSES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'] as const;
const TIER_NAMES = ['Base', 'Evolved', 'Elite', 'Apex'] as const;
const PHASE_LABELS: Record<number, string> = { 1: 'Deposit', 2: 'Team commit', 3: 'Team reveal', 4: 'In battle', 5: 'In review', 6: 'Settled', 7: 'Cancelled' };
const AUTO_SKIP_MS_BY_BRACKET = [3000, 5000, 7000] as const;
const SAMPLE_SHEET = '/ui/shell/apex-class-sheet.png';
const devSamples = process.env.NEXT_PUBLIC_PRACTICE_PRESETS === 'true' || process.env.NODE_ENV !== 'production';

interface Pick { id: string; name: string; classIndex: number; lobster?: LobsterData }
const samplePick = (name: string): Pick => ({ id: `sample:${name}`, name, classIndex: CLASSES.indexOf(name as (typeof CLASSES)[number]) });
const lobsterPick = (l: LobsterData): Pick => ({ id: l.tokenId, name: l.className, classIndex: l.class, lobster: l });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const lineupKey = (address: string) => `clawbada.shell.lineup.${address.toLowerCase()}`;

type HistoryItem = Awaited<ReturnType<typeof api.combat.history>>['battles'][number];

export function ShellRoom() {
  const router = useRouter();
  const { address } = useAccount();
  const { data: lobstersData } = useQuery({ queryKey: ['lobsters', address], queryFn: () => api.agent.lobsters(address!), enabled: !!address });
  const { data: teamsData } = useQuery({ queryKey: ['teams', address], queryFn: () => api.teams.list(address!), enabled: !!address, refetchInterval: 30_000 });
  const { data: stakes } = useQuery({ queryKey: ['stakes'], queryFn: () => api.combat.stakes(), refetchInterval: 60_000, staleTime: 30_000 });
  const { data: historyData } = useQuery({ queryKey: ['battle-history', address], queryFn: () => api.combat.history(address!, 30), enabled: !!address, refetchInterval: 15_000 });
  const lobsters = useMemo(() => lobstersData?.lobsters ?? [], [lobstersData]);
  const teams: TeamData[] = useMemo(() => teamsData?.teams ?? [], [teamsData]);
  const { state: queueState, joinQueue, leaveQueue, reset } = useQueueState();

  const roomRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<HTMLDialogElement>(null);
  const battleButtonRef = useRef<HTMLButtonElement>(null);
  const artRef = useRef<ShellArt | null>(null);
  const tabsRef = useRef<ShellTabs | null>(null);
  const [slots, setSlots] = useState<(Pick | null)[]>([null, null, null]);
  const [picker, setPicker] = useState<number | null>(null);
  const [stageUnit, setStageUnit] = useState(2);
  const [battleOpen, setBattleOpen] = useState(false);
  const [bracket, setBracket] = useState(0);
  const [pressing, setPressing] = useState(false);

  // The room, its lighting and the ambient life; the overlays' motion.
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    document.documentElement.setAttribute('data-shell', '');
    const art = mountShellArt(room, (su) => setStageUnit(su));
    const tabs = mountShellTabs(room);
    artRef.current = art;
    tabsRef.current = tabs;
    return () => { art.dispose(); tabs.dispose(); artRef.current = null; tabsRef.current = null; document.documentElement.removeAttribute('data-shell'); };
  }, []);

  // The legacy Battle URL (/game/battle → /game?battle=1) opens the setup modal on the Shell.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('battle') === '1') { setBattleOpen(true); window.history.replaceState(null, '', '/game'); }
  }, []);

  // The lineup is remembered per wallet (token ids), re-checked against what the wallet still owns.
  useEffect(() => {
    if (!address) { setSlots([null, null, null]); return; }
    if (!lobstersData) return;
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(lineupKey(address)) ?? '[]'); } catch { /* ignore */ }
    const byId = new Map(lobsters.map((l) => [l.tokenId, l]));
    setSlots((current) => {
      const next: (Pick | null)[] = [0, 1, 2].map((i) => {
        const keep = current[i];
        if (keep && !keep.lobster) return keep;              // a dev sample survives
        const id = saved[i];
        const l = id ? byId.get(id) : undefined;
        return l ? lobsterPick(l) : null;
      });
      return next;
    });
  }, [address, lobstersData, lobsters]);
  useEffect(() => {
    if (!address) return;
    const ids = slots.map((p) => (p?.lobster ? p.lobster.tokenId : null));
    try { localStorage.setItem(lineupKey(address), JSON.stringify(ids)); } catch { /* private mode */ }
  }, [address, slots]);

  // A match found while the overlay is closed brings it up.
  useEffect(() => { if (queueState.kind === 'matched') tabsRef.current?.open('queue'); }, [queueState.kind]);

  const openPicker = (slot: number) => {
    setPicker(slot);
    const dialog = pickerRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  };
  const closePicker = () => { pickerRef.current?.close(); };
  const choose = useCallback((pick: Pick | null) => {
    const slot = picker;
    if (slot === null) return;
    closePicker();
    roomRef.current?.querySelector<HTMLElement>(`.lobby-slot[data-slot="${slot}"]`)?.focus({ preventScroll: true });
    const commit = () => setSlots((s) => s.map((p, i) => (i === slot ? pick : p)));
    if (artRef.current) artRef.current.select(slot, !!pick, commit);
    else commit();
  }, [picker]);

  const picks = slots.filter((p): p is Pick => !!p);
  const anyPick = picks.length > 0;
  const usedIds = new Set(picks.map((p) => p.id));
  const options: Pick[] = lobsters.length > 0 ? lobsters.map(lobsterPick) : devSamples ? CLASSES.map(samplePick) : [];
  const usingSamples = lobsters.length === 0 && devSamples;

  // Eligibility from the real rules; the modal shows the reason.
  const eligibility: BattleEligibility = useMemo(() => {
    if (!address) return { ok: false, reason: 'Connect your wallet to find a match.' };
    if (picks.length < 3) return { ok: false, reason: 'Pick three lobsters — one on each stage.' };
    if (picks.some((p) => !p.lobster)) return { ok: false, reason: 'Sample classes cannot queue. Pick your own lobsters.' };
    const real = picks.map((p) => p.lobster!);
    const low = real.find((l) => l.evolutionTier < 1);
    if (low) return { ok: false, reason: `${low.className} #${low.tokenId} is Base tier — all three must be Evolved or higher.` };
    const hurt = real.find((l) => l.damage >= 80);
    if (hurt) return { ok: false, reason: `${hurt.className} #${hurt.tokenId} needs repair first (damage ${hurt.damage}).` };
    const ids = new Set(real.map((l) => l.tokenId));
    const team = teams.find((t) => t.lobsterIds.length === 3 && t.lobsterIds.every((id) => ids.has(id)));
    if (!team) return { ok: false, reason: 'These three are not a team yet.', teamsLink: true };
    if (team.active) return { ok: false, reason: `Team #${team.teamId} is busy — mining or in a battle.` };
    return { ok: true, reason: `Team #${team.teamId} is ready.`, teamId: team.teamId };
  }, [address, picks, teams]);

  const joining = queueState.kind === 'joining';
  const findMatch = useCallback(async () => {
    if (!eligibility.ok || !eligibility.teamId) return;
    setBattleOpen(false);
    tabsRef.current?.open('queue');
    await joinQueue(eligibility.teamId, bracket);
  }, [eligibility, bracket, joinQueue]);

  // Battle button: hover −2 px (CSS), press +2 px with the pressed artwork, then the modal.
  const pressBattle = async () => {
    const button = battleButtonRef.current;
    if (!button || button.disabled || pressing) return;
    setPressing(true);
    const motion = button.animate([{ translate: '0 0' }, { translate: '0 2px', offset: 0.4 }, { translate: '0 0' }], { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160, easing: 'ease-out' });
    try { await motion.finished; if (button.isConnected) setBattleOpen(true); } catch { /* cancelled by navigation */ }
    finally { setPressing(false); }
  };

  const [tickNow, setTickNow] = useState(() => Date.now());
  useEffect(() => {
    if (queueState.kind !== 'queued') return;
    setTickNow(Date.now());
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [queueState.kind]);
  const stakeLabel = (idx: number) => { const w = stakes?.brackets[idx]?.stakeWei; return w ? `${formatGoldWei(BigInt(w))} $GOLD` : '…'; };
  const bracketName = (idx: number) => ['Low', 'Mid', 'High'][idx] ?? `#${idx}`;

  const battles: HistoryItem[] = historyData?.battles ?? [];
  const active = battles.filter((b) => b.phase >= 1 && b.phase <= 5);
  const past = battles.filter((b) => b.phase === 6 || b.phase === 7);
  const me = address?.toLowerCase();
  const opponentOf = (b: HistoryItem) => (b.playerA.toLowerCase() === me ? b.playerB : b.playerA);
  const resultOf = (b: HistoryItem) => (b.phase === 7 ? 'Cancelled' : !b.winner ? 'Draw' : b.winner.toLowerCase() === me ? 'Win' : 'Loss');

  const charPx = Math.max(32, Math.round(80 * stageUnit));

  return (
    <div className="shell-page" data-page="dashboard">
      <section ref={roomRef} aria-label="Shell basecamp" className="shell-room">
        <div aria-hidden="true" className="shell-art">
          <div className="shell-art-layer" data-shell-layer="background-rock-2" />
          <div className="shell-art-layer" data-shell-layer="background-rock" />
          <div className="shell-art-layer" data-shell-layer="coral" />
          <div className="shell-art-layer" data-shell-layer="back-sand" />
          <div className="shell-art-layer" data-shell-layer="shell" />
          <div className="shell-art-layer" data-shell-layer="sand" />
        </div>
        <div aria-hidden="true" className="shell-art-layer" data-shell-layer="rock" />
        <div aria-hidden="true" className="shell-seaweed shell-seaweed--left" data-seaweed="1" />
        <div aria-hidden="true" className="shell-seaweed shell-seaweed--right" data-seaweed="2" />
        {[0, 1, 2].map((i) => <span key={i} aria-hidden="true" className="stage-lighting" data-slot={i} />)}

        <nav aria-label="Shell panels" className="shell-tabs">
          <button aria-controls="shell-queue" aria-expanded="false" className="pixel-button" data-shell-tab="queue" id="shell-tab-queue" type="button">Queue</button>
          <button aria-controls="shell-active" aria-expanded="false" className="pixel-button" data-shell-tab="active" id="shell-tab-active" type="button">Active</button>
          <button aria-controls="shell-history" aria-expanded="false" className="pixel-button" data-shell-tab="history" id="shell-tab-history" type="button">History</button>
        </nav>

        <div aria-label="Arena" className="shell-arena" id="shell-arena">
          <div aria-label="Your battle lineup" className="shell-lineup">
            {slots.map((pick, i) => (
              <button
                key={i}
                aria-haspopup="dialog"
                aria-label={`${pick ? `Change ${pick.name}` : 'Choose lobster'} for slot ${i + 1}`}
                className="lobby-slot"
                data-picker-active={picker === i ? 'true' : undefined}
                data-selected={String(!!pick)}
                data-slot={i}
                onClick={() => openPicker(i)}
                type="button"
              >
                <span aria-hidden="true" className="character-stage" />
                {pick?.lobster ? (
                  <span aria-hidden="true" className="slot-character slot-character--lobster" data-class={pick.name}>
                    <AnimatedLobster displaySize={charPx} dna={pick.lobster.dna} evolutionTier={pick.lobster.evolutionTier} frameSize={80} frames={16} />
                  </span>
                ) : pick ? (
                  <span aria-hidden="true" className="slot-character" data-class={pick.name} style={{ '--character-frame': pick.classIndex, backgroundImage: `url("${SAMPLE_SHEET}")` } as CSSProperties} />
                ) : (
                  <span aria-hidden="true" className="slot-character" hidden />
                )}
                <span className="slot-name">
                  {pick ? (
                    <>
                      <span aria-hidden="true" className="class-icon" style={{ '--class-frame': pick.classIndex, backgroundImage: 'url("/ui/shell/class-badges.png")' } as CSSProperties} />
                      {pick.name}
                    </>
                  ) : 'Choose Lobster'}
                </span>
              </button>
            ))}
          </div>
          <footer className="shell-hud">
            <button
              ref={battleButtonRef}
              aria-haspopup="dialog"
              aria-label="Battle"
              className="shell-battle"
              data-pressed={pressing ? 'true' : undefined}
              disabled={!anyPick}
              onClick={() => void pressBattle()}
              title={anyPick ? 'Battle' : 'Choose a character first'}
              type="button"
            />
          </footer>
        </div>

        <section aria-labelledby="shell-tab-queue" className="shell-records" hidden id="shell-queue" role="region" tabIndex={0}>
          <h2>Battle queue</h2>
          {!address ? (
            <>
              <p className="shell-records-label">Not connected</p>
              <p>Connect your wallet to queue for a battle.</p>
            </>
          ) : queueState.kind === 'idle' ? (
            <>
              <p className="shell-records-label">Not in queue</p>
              <p>Put three lobsters that form a team on the stages, press Battle and find a match.</p>
            </>
          ) : queueState.kind === 'joining' ? (
            <p>Joining the queue…</p>
          ) : queueState.kind === 'queued' ? (
            <>
              <p className="shell-records-label">Searching for an opponent · <span className="shell-queue-elapsed">{Math.floor((tickNow - queueState.since) / 60000)}:{String(Math.floor((tickNow - queueState.since) / 1000) % 60).padStart(2, '0')}</span></p>
              <p>{bracketName(queueState.bracket)} bracket · stake {stakeLabel(queueState.bracket)} · team power {queueState.power}</p>
              <QueueRadiusBar ownPower={queueState.power} radius={queueState.radius} />
              <div className="shell-queue-actions">
                <button className="pixel-button" onClick={() => void leaveQueue()} type="button">Cancel &amp; refund</button>
              </div>
            </>
          ) : queueState.kind === 'matched' ? (
            <MatchFoundHud
              autoSkipMs={AUTO_SKIP_MS_BY_BRACKET[queueState.bracket] ?? AUTO_SKIP_MS_BY_BRACKET[0]}
              match={queueState}
              onApprove={() => router.push(`/battle/${queueState.battleId}`)}
              onWalkAway={reset}
            />
          ) : queueState.kind === 'cancelling' ? (
            <p>Cancelling…</p>
          ) : queueState.kind === 'cancelled' ? (
            <>
              <p className="shell-records-label">Queue cancelled</p>
              <p>{queueState.reason.replace(/_/g, ' ')}</p>
              <div className="shell-queue-actions"><button className="pixel-button" onClick={reset} type="button">Back</button></div>
            </>
          ) : (
            <>
              <p className="shell-records-label">Could not join the queue</p>
              <p>{queueState.error}</p>
              <div className="shell-queue-actions"><button className="pixel-button" onClick={reset} type="button">Try again</button></div>
            </>
          )}
        </section>

        <section aria-labelledby="shell-tab-active" className="shell-records" hidden id="shell-active" role="region" tabIndex={0}>
          <h2>Active battles</h2>
          {!address ? (
            <><p className="shell-records-label">Not connected</p><p>Connect your wallet to see your battles.</p></>
          ) : active.length === 0 ? (
            <p>No battle in progress.</p>
          ) : (
            <ul>
              {active.map((b) => (
                <li key={b.battleId}>
                  <span className="shell-record-id">#{b.battleId.slice(0, 8)}</span>
                  <span>{PHASE_LABELS[b.phase] ?? `Phase ${b.phase}`}</span>
                  <span>vs {short(opponentOf(b))}</span>
                  <span>{bracketName(b.stakeBracket)} · {formatGoldWei(BigInt(b.stakeAmount || '0'))} $GOLD</span>
                  <Link href={`/battle/${b.battleId}`}>Open</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="shell-tab-history" className="shell-records" hidden id="shell-history" role="region" tabIndex={0}>
          <h2>Battle history</h2>
          {!address ? (
            <><p className="shell-records-label">Not connected</p><p>Connect your wallet to see your results.</p></>
          ) : past.length === 0 ? (
            <p>No battles yet.</p>
          ) : (
            <ul>
              {past.map((b) => {
                const result = resultOf(b);
                return (
                  <li key={b.battleId}>
                    <span className="shell-record-id">#{b.battleId.slice(0, 8)}</span>
                    <span className={result === 'Win' ? 'shell-record-win' : result === 'Loss' ? 'shell-record-loss' : undefined}>{result}</span>
                    <span>vs {short(opponentOf(b))}</span>
                    <span>{bracketName(b.stakeBracket)} · {formatGoldWei(BigInt(b.stakeAmount || '0'))} $GOLD</span>
                    <Link href={`/battle/${b.battleId}`}>Details</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </section>

      <dialog ref={pickerRef} aria-labelledby="picker-title" className="lobster-picker" onClose={() => setPicker(null)}>
        <header className="picker-heading">
          <h2 id="picker-title">Choose Lobster{picker !== null ? ` · Slot ${picker + 1}` : ''}</h2>
          <button aria-label="Close lobster picker" className="picker-close" onClick={closePicker} type="button">Close</button>
        </header>
        {usingSamples ? (
          <p>Sample classes (dev) — this wallet owns no lobsters.</p>
        ) : address ? (
          <p>Your lobsters. One per stage.</p>
        ) : (
          <p>Connect your wallet to pick your lobsters.</p>
        )}
        {options.length === 0 ? (
          <p className="picker-empty">
            {address ? <>No lobsters in this wallet yet. <Link href="/faucet">Claim starter lobsters</Link> or <Link href="/market">browse the market</Link>.</> : 'Nothing to pick yet.'}
          </p>
        ) : (
          <div className="picker-options">
            {options.map((opt) => {
              const current = picker !== null ? slots[picker] : null;
              const elsewhere = usedIds.has(opt.id) && current?.id !== opt.id;
              return (
                <button key={opt.id} aria-pressed={current?.id === opt.id} data-class={opt.name} disabled={elsewhere} onClick={() => choose(opt)} type="button">
                  <span aria-hidden="true" className="class-icon" style={{ '--class-frame': opt.classIndex, backgroundImage: 'url("/ui/shell/class-badges.png")' } as CSSProperties} />
                  {opt.name}
                  {opt.lobster && <span className="picker-meta">{TIER_NAMES[opt.lobster.evolutionTier] ?? opt.lobster.tierName} · #{opt.lobster.tokenId}{elsewhere ? ' · on a stage' : ''}</span>}
                </button>
              );
            })}
          </div>
        )}
        <button className="picker-clear" onClick={() => choose(null)} type="button">Clear slot</button>
      </dialog>

      <BattleModal
        bracket={bracket}
        eligibility={eligibility}
        joining={joining}
        lineup={picks.map((p) => ({ name: p.name, classIndex: p.classIndex, tier: p.lobster ? TIER_NAMES[p.lobster.evolutionTier] : undefined }))}
        onBracket={setBracket}
        onClose={() => setBattleOpen(false)}
        onFindMatch={() => void findMatch()}
        open={battleOpen}
        stakes={stakes}
      />
    </div>
  );
}
