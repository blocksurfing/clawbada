'use client';

import './dojo.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { PixelPanel } from '@/components/shell/pixel-panel';
import { PIXEL_SCALE_EVENT, pixelScale } from '@/components/pixel/pixel-assets';
import { BOT_CATALOG, botInfo, type BotName } from '@/lib/bot-catalog';
import { DojoSign } from './dojo-sign';
import { anchorFighter, cssPx, drawClass, loadClassSheet } from './dojo-sprites';
import {
  EMPTY_SLOTS, INVENTORY_PAGE_SIZE, builderSummary, dropOnSlot, ownedSummary, pageCount, purityDescription,
  removeFromSlots, slotsComplete, toggleSlot, type Slots,
} from './dojo-model';

/**
 * Nzib's Dojo (design/website 5cb6655 + 72d1135, workbench pages/dojo.html + components/dojo.js), wired to the game:
 * the dark dojo backdrop, the hanging sign, Your Team and Opponent lineups standing over two dark wooden cards, and
 * the gold Battle button between them.
 *
 * - Your Team › My lobsters: the wallet's own lobsters as portrait tiles (pages of ten), a saved-team select, click
 *   or drag into the lineup (drag replaces, swaps or — dropped back on the tiles — removes; Escape cancels).
 * - Your Team › Build a team: any three classes at any tier and purity (the API's `team_*` preset).
 * - Opponent › Bot: the bot and its guide, mirror or random roster, the board. Fight with friend: "Coming soon".
 *
 * Owner decisions 2026-10-26: wallets land on My lobsters (guests and wallets with fewer than three on Build a team);
 * friend play shown disabled; the drop's fake bits (650 ms "Starting…", preview dialog, Resume) are not ported — the
 * Battle press starts the real entry sequence inside the click (fullscreen and audio need the gesture).
 * Everything about starting a battle stays in the page (`app/(game)/dojo/page.tsx`); this is the view.
 */

export const DOJO_CLASSES = ['bulwark', 'mantis', 'leviathan', 'tempest', 'specter', 'sentinel', 'reaver', 'abyss', 'kraken', 'ember'] as const;
export const DOJO_TIERS = ['evolved', 'elite', 'apex'] as const;
export type DojoTier = (typeof DOJO_TIERS)[number];
export type DojoArena = 'match' | 'dojo' | DojoTier;
const ARENA_CHOICES: readonly [DojoArena, string][] = [['dojo', 'Dojo'], ['match', 'Team tier'], ['evolved', 'Evolved'], ['elite', 'Elite'], ['apex', 'Apex']];

export interface DojoLobster { id: string; classIndex: number; className: string; tierName: string; /** 0 Base … 3 Apex */ tier: number }
export interface DojoTeam { id: string; lobsterIds: string[] }
export type DojoChoice = { mode: 'owned'; teamId: string | null; lobsterIds: string[] } | { mode: 'builder' };

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lobsterName = (l: DojoLobster) => `${l.className} #${l.id}`;

interface DojoRoomProps {
  /** Wallet lobsters and saved teams (empty for a guest). */
  lobsters: DojoLobster[];
  teams: DojoTeam[];
  /** Which tab to open on: decided by the page once the wallet's lobsters are known. */
  initialMode: 'owned' | 'builder' | null;
  isWallet: boolean;
  onConnectWallet: () => void;
  team: string[]; onTeam: (team: string[]) => void;
  tier: DojoTier; onTier: (tier: DojoTier) => void;
  purity: number; onPurity: (purity: number) => void;
  bot: BotName; onBot: (bot: BotName) => void;
  opponent: 'mirror' | 'random'; onOpponent: (o: 'mirror' | 'random') => void;
  arena: DojoArena; onArena: (a: DojoArena) => void;
  busy: boolean;
  /** A blocking state (the signature gate) keeps Battle off. */
  blocked: boolean;
  error: string | null;
  onBattle: (choice: DojoChoice) => void;
  /** Extra status content: who you train as, the sign-in gate. */
  identity: ReactNode;
  gate: ReactNode;
  /** Dev-only presets drawer. */
  devTools?: ReactNode;
}

/** The global `--pixel`, kept current across the 3 / 2.5 / 2 chrome scales. */
function usePixel() {
  const [unit, setUnit] = useState(3);
  useEffect(() => {
    const read = () => setUnit(pixelScale());
    read();
    window.addEventListener(PIXEL_SCALE_EVENT, read);
    return () => window.removeEventListener(PIXEL_SCALE_EVENT, read);
  }, []);
  return unit;
}

function useClassSheet() {
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  useEffect(() => { let live = true; loadClassSheet().then((img) => { if (live) setSheet(img); }).catch(console.error); return () => { live = false; }; }, []);
  return sheet;
}

/** One lineup fighter (a diagonal slot with its shadow). */
function Fighter({ side, slot, classIndex, unknown, sheet, label, ghost }: {
  side: 'team' | 'opponent'; slot: number; classIndex: number | null; unknown?: boolean; sheet: HTMLImageElement | null; label: string;
  ghost?: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current, figure = figureRef.current;
    if (!canvas || !figure || !sheet || classIndex === null) return;
    anchorFighter(canvas, drawClass(canvas, sheet, classIndex, cssPx(figure, '--dojo-selected-pixel', 4)), side);
  }, [sheet, classIndex, side]);
  useLayoutEffect(() => {
    const canvas = ghostRef.current, figure = figureRef.current;
    if (!canvas || !figure || !sheet || ghost == null) return;
    anchorFighter(canvas, drawClass(canvas, sheet, ghost, cssPx(figure, '--dojo-selected-pixel', 4)), 'team');
  }, [sheet, ghost]);
  const filled = classIndex !== null;
  return (
    <figure ref={figureRef} className="dojo-fighter" data-fighter={side} data-slot={slot} data-unknown={unknown ? 'true' : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="dojo-shadow" src="/ui/dojo/Character_Shadow.png" width={64} height={32} alt="" draggable={false} hidden={!filled} />
      <canvas ref={canvasRef} role="img" aria-label={filled ? label : undefined} hidden={!filled} data-class={filled ? DOJO_CLASSES[classIndex] : undefined} />
      {ghost != null && (
        <div data-drag-preview="" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="dojo-shadow" src="/ui/dojo/Character_Shadow.png" alt="" draggable={false} />
          <canvas ref={ghostRef} />
        </div>
      )}
    </figure>
  );
}

/** A portrait tile in the owned inventory, drawn at the global pixel. */
function InventoryTile({ lobster, slot, sheet, unit, hidden, onClick }: {
  lobster: DojoLobster; slot: number; sheet: HTMLImageElement | null; unit: number; hidden: boolean; onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvasRef.current && sheet) drawClass(canvasRef.current, sheet, lobster.classIndex, unit);
  }, [sheet, lobster.classIndex, unit]);
  const picked = slot >= 0;
  return (
    <button
      type="button" className="dojo-inventory-tile" data-owned-id={lobster.id} aria-pressed={picked} hidden={hidden} onClick={onClick}
      aria-label={`${lobsterName(lobster)}, ${lobster.tierName}${picked ? `, slot ${slot + 1}, click to remove` : ', click to add'}`}
    >
      <i className="dojo-portrait-clip" aria-hidden="true"><canvas ref={canvasRef} width={64} height={64} /></i>
      <span title={`${lobsterName(lobster)} · ${lobster.tierName}`}>{lobster.className}</span>
      <span data-slot-badge="" hidden={!picked} aria-hidden="true">{picked ? slot + 1 : ''}</span>
      <i className="dojo-selected-corners" aria-hidden="true"><i /><i /><i /><i /></i>
    </button>
  );
}

export function DojoRoom(props: DojoRoomProps) {
  const { lobsters, teams, initialMode, isWallet, team, tier, purity, bot, opponent, arena, busy, blocked, error } = props;
  const unit = usePixel();
  const sheet = useClassSheet();
  const rootRef = useRef<HTMLDivElement>(null);
  const inventoryRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<'owned' | 'builder'>('builder');
  const [modeTouched, setModeTouched] = useState(false);
  useEffect(() => { if (initialMode && !modeTouched) setMode(initialMode); }, [initialMode, modeTouched]);
  const pickMode = (m: 'owned' | 'builder') => { setMode(m); setModeTouched(true); };

  const [panel, setPanel] = useState<'team' | 'opponent'>('team');
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  const [savedTeam, setSavedTeam] = useState<string>('');
  const [feedback, setFeedback] = useState('');
  const [page, setPage] = useState(0);
  const [drag, setDrag] = useState<{ id: string; slot: number } | null>(null);

  const byId = useMemo(() => new Map(lobsters.map((l) => [l.id, l])), [lobsters]);
  const usableTeams = useMemo(() => teams.filter((t) => t.lobsterIds.length === 3 && t.lobsterIds.every((id) => byId.has(id))), [teams, byId]);

  // A wallet opens on its first saved team, else empty slots. Lobsters that leave the wallet leave the lineup.
  const seeded = useRef(false);
  useEffect(() => {
    if (!lobsters.length) return;
    if (!seeded.current) {
      seeded.current = true;
      const first = usableTeams[0];
      if (first) { setSavedTeam(first.id); setSlots([first.lobsterIds[0], first.lobsterIds[1], first.lobsterIds[2]]); }
      return;
    }
    setSlots((s) => { const next = s.map((id) => (byId.has(id) ? id : '')) as unknown as Slots; return next.some((id, i) => id !== s[i]) ? next : s; });
  }, [lobsters, usableTeams, byId]);

  const pages = pageCount(lobsters.length);
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);

  // Portrait size: five per row across the inventory's width (gap 9 px × 4), as in the drop.
  useEffect(() => {
    const el = inventoryRef.current;
    if (!el) return;
    const fit = () => { el.style.setProperty('--portrait-size', `${Math.max(0, (el.clientWidth - 36) / 5)}px`); el.style.gridTemplateColumns = 'repeat(5, var(--portrait-size))'; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, lobsters.length]);

  const ownedReady = mode === 'owned' && slotsComplete(slots);
  const valid = mode === 'builder' ? team.length === 3 : ownedReady;
  const botLabel = botInfo(bot)?.label ?? bot;
  const summary = mode === 'builder'
    ? builderSummary(team, tier, purity, botLabel)
    : ownedReady ? ownedSummary(slots.map((id) => lobsterName(byId.get(id)!)), savedTeam || null, botLabel)
      : isWallet ? 'Pick three lobsters for your team.' : 'Connect a wallet to train with your own lobsters, or build a team.';

  const editSlots = (next: Slots) => { setSlots(next); setSavedTeam(''); setFeedback(''); };
  const clickTile = (id: string) => {
    const r = toggleSlot(slots, id);
    if (r.full) { setFeedback('Team full — remove a lobster first.'); return; }
    editSlots(r.slots);
  };

  // ── drag (pointer capture keeps mouse, pen and touch drags alive outside the source) ──
  const live = useRef({ slots, mode, byId, unit, sheet });
  live.current = { slots, mode, byId, unit, sheet };
  const editRef = useRef(editSlots);
  editRef.current = editSlots;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    type Drag = { id: string; source: HTMLElement; fromLineup: boolean; pointerId: number; x: number; y: number; active: boolean; slot: number; follower?: HTMLCanvasElement };
    let d: Drag | null = null;
    let suppressClick = false;
    const teamFighters = () => [...root.querySelectorAll<HTMLElement>('[data-fighter="team"]')];
    const inside = (el: Element | null, x: number, y: number) => { if (!el) return false; const b = el.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; };
    // The diagonal slot boxes decide the target, never the overlapping transparent art.
    const targetSlot = (x: number, y: number) => teamFighters().findIndex((f) => inside(f, x, y));
    const inventory = () => root.querySelector('[data-owned-inventory]');
    const down = (e: PointerEvent) => {
      suppressClick = false;
      if (d || e.button !== 0 || !e.isPrimary || live.current.mode !== 'owned') return;
      const source = (e.target as Element).closest<HTMLElement>('[data-owned-id], [data-fighter="team"]');
      if (!source) return;
      const fromLineup = source.matches('[data-fighter="team"]');
      const id = fromLineup ? live.current.slots[Number(source.dataset.slot)] : source.dataset.ownedId;
      if (!id) return;
      d = { id, source, fromLineup, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, slot: -1 };
      source.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      const { byId: ids, sheet: img, unit: u } = live.current;
      if (!d.active && img) {
        const follower = document.createElement('canvas');
        follower.dataset.dragFollower = '';
        follower.setAttribute('aria-hidden', 'true');
        drawClass(follower, img, ids.get(d.id)?.classIndex ?? 0, d.fromLineup ? cssPx(root, '--dojo-selected-pixel', 4) : u);
        // On body: the page is transformed, which would capture a fixed child.
        document.body.append(follower);
        d.follower = follower;
      }
      d.active = true;
      if (d.follower) { d.follower.style.left = `${e.clientX}px`; d.follower.style.top = `${e.clientY}px`; }
      e.preventDefault();
      const slot = targetSlot(e.clientX, e.clientY);
      if (slot !== d.slot) setDrag(slot >= 0 ? { id: d.id, slot } : null);
      d.slot = slot;
      inventory()?.toggleAttribute('data-drop-remove', slot < 0 && d.fromLineup && inside(inventory(), e.clientX, e.clientY));
    };
    const finish = (e: PointerEvent | KeyboardEvent | FocusEvent | { type: string }) => {
      if (!d || ('pointerId' in e && e.pointerId !== undefined && e.pointerId !== d.pointerId)) return;
      const cur = d;
      d = null;
      cur.follower?.remove();
      inventory()?.removeAttribute('data-drop-remove');
      setDrag(null);
      if (cur.source.hasPointerCapture(cur.pointerId)) cur.source.releasePointerCapture(cur.pointerId);
      if (!cur.active) return;
      suppressClick = true;
      if (e.type !== 'pointerup') return;
      const pe = e as PointerEvent;
      const slot = targetSlot(pe.clientX, pe.clientY);
      const s = live.current.slots;
      if (slot >= 0) editRef.current(dropOnSlot(s, cur.id, slot));
      else if (cur.fromLineup && inside(inventory(), pe.clientX, pe.clientY)) editRef.current(removeFromSlots(s, cur.id));
    };
    const blockClick = (e: MouseEvent) => {
      if (!suppressClick || e.detail === 0) return;
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const cancel = (e: Event) => {
      if (e.type === 'keydown' && (e as globalThis.KeyboardEvent).key !== 'Escape') return;
      if (d) { e.preventDefault(); finish({ type: e.type }); }
    };
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', finish);
    root.addEventListener('pointercancel', finish);
    root.addEventListener('lostpointercapture', finish);
    root.addEventListener('click', blockClick, true);
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      finish({ type: 'unmount' });
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', finish);
      root.removeEventListener('pointercancel', finish);
      root.removeEventListener('lostpointercapture', finish);
      root.removeEventListener('click', blockClick, true);
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  const tabKeys = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'owned' : e.key === 'End' ? 'builder' : mode === 'owned' ? 'builder' : 'owned';
    pickMode(next);
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-team-mode="${next}"]`)?.focus();
  };

  const classOf = (name: string) => DOJO_CLASSES.indexOf(name as (typeof DOJO_CLASSES)[number]);
  const teamClasses: (number | null)[] = mode === 'builder' ? team.map(classOf) : slots.map((id) => (id ? byId.get(id)?.classIndex ?? null : null));
  const teamLabels = mode === 'builder' ? team.map(title) : slots.map((id) => (id && byId.get(id) ? lobsterName(byId.get(id)!) : ''));

  const battle = () => {
    if (!valid || busy || blocked) return;
    props.onBattle(mode === 'builder' ? { mode: 'builder' } : { mode: 'owned', teamId: savedTeam || null, lobsterIds: [...slots] });
  };

  return (
    <>
      <div className="dojo-arena" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ui/dojo/Dojo_Dark.png" alt="" width={640} height={360} draggable={false} />
      </div>
      <div id="page-content" data-page="dojo" ref={rootRef}>
        <div className="dojo-team-headings"><h2 id="dojo-team-title">Your Team</h2><h2 id="dojo-opponent-title">Opponent</h2></div>
        <DojoSign title="The Dojo" />
        <section className="dojo" aria-label="Practice setup">
          <p className="dojo-intro">Build any team and train against a bot. No stakes, no rating, no repair.</p>
          <nav className="dojo-panel-switch" aria-label="Setup panel">
            {(['team', 'opponent'] as const).map((p) => (
              <button key={p} type="button" data-dojo-panel={p} aria-pressed={panel === p} onClick={() => setPanel(p)}>{p === 'team' ? 'Your team' : 'Opponent'}</button>
            ))}
          </nav>
          <div className="dojo-cards pixel-grid" data-active-panel={panel}>
            <div className="dojo-side" data-side="team">
              <div className="dojo-lineup" data-lineup="team" aria-label="Your selected three lobsters">
                {[0, 1, 2].map((i) => (
                  <Fighter key={i} side="team" slot={i} classIndex={teamClasses[i] ?? null} sheet={sheet} label={`${teamLabels[i]}, slot ${i + 1}`}
                    ghost={drag && drag.slot === i ? byId.get(drag.id)?.classIndex ?? null : null} />
                ))}
              </div>
              <PixelPanel asset="dojoDarkPanel" className="dojo-card" aria-labelledby="dojo-team-title">
                <div className="dojo-tabs" role="tablist" aria-label="Team source">
                  {(['owned', 'builder'] as const).map((m) => (
                    <button key={m} id={`dojo-${m}-tab`} type="button" role="tab" aria-selected={mode === m} aria-controls={`dojo-${m}`} tabIndex={mode === m ? 0 : -1}
                      data-team-mode={m} onClick={() => pickMode(m)} onKeyDown={tabKeys}>
                      {m === 'owned' ? 'My lobsters' : 'Build a team'}
                    </button>
                  ))}
                </div>
                <div id="dojo-owned" role="tabpanel" aria-labelledby="dojo-owned-tab" hidden={mode !== 'owned'}>
                  {lobsters.length ? (
                    <div data-owned-controls="">
                      <label className="dojo-field">Saved team
                        <select data-saved-team="" aria-label="Saved team" value={savedTeam} onChange={(e) => {
                          const t = usableTeams.find((x) => x.id === e.target.value);
                          setSavedTeam(e.target.value);
                          setFeedback('');
                          if (t) setSlots([t.lobsterIds[0], t.lobsterIds[1], t.lobsterIds[2]]);
                        }}>
                          <option value="">Choose individually</option>
                          {usableTeams.map((t) => (
                            <option key={t.id} value={t.id}>Team #{t.id} · {t.lobsterIds.map((id) => byId.get(id)!.className).join(' / ')}</option>
                          ))}
                        </select>
                      </label>
                      <p className="dojo-selection-feedback" role="status" aria-live="polite">{feedback}</p>
                      <div className="dojo-inventory" data-owned-inventory="" ref={inventoryRef} aria-label="Your lobsters" data-testid="dojo-inventory">
                        {lobsters.map((l, i) => (
                          <InventoryTile key={l.id} lobster={l} slot={slots.indexOf(l.id)} sheet={sheet} unit={unit}
                            hidden={Math.floor(i / INVENTORY_PAGE_SIZE) !== page} onClick={() => clickTile(l.id)} />
                        ))}
                      </div>
                      <div className="dojo-inventory-pager">
                        <button type="button" aria-label="Previous lobsters" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
                        <span>{page + 1} / {pages}</span>
                        <button type="button" aria-label="Next lobsters" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>›</button>
                      </div>
                    </div>
                  ) : (
                    <p className="dojo-empty" data-testid="dojo-owned-empty">
                      {isWallet ? 'No lobsters yet. ' : <>Training as a guest. <button type="button" className="dojo-link" onClick={props.onConnectWallet}>Connect a wallet</button> to train with your own lobsters. </>}
                      <button type="button" className="dojo-link" onClick={() => pickMode('builder')}>Build a team</button> to try any composition.
                    </p>
                  )}
                </div>
                <div id="dojo-builder" role="tabpanel" aria-labelledby="dojo-builder-tab" hidden={mode !== 'builder'}>
                  <div className="dojo-slots" data-testid="dojo-classes">
                    {[0, 1, 2].map((i) => (
                      <label key={i} className="dojo-field">Slot {i + 1}
                        <select aria-label={`Lobster ${i + 1} class`} value={team[i]} onChange={(e) => props.onTeam(team.map((c, j) => (j === i ? e.target.value : c)))}>
                          {DOJO_CLASSES.map((c) => <option key={c} value={c}>{title(c)}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <fieldset className="dojo-options"><legend>Tier</legend>
                    <div data-choices="tier" data-testid="dojo-tier">
                      {DOJO_TIERS.map((t) => <button key={t} type="button" className="dojo-choice" aria-pressed={tier === t} onClick={() => props.onTier(t)}>{title(t)}</button>)}
                    </div>
                  </fieldset>
                  <fieldset className="dojo-options" aria-describedby="dojo-purity-help" title={purityDescription(purity)}><legend>Purity</legend>
                    <div data-choices="purity" data-testid="dojo-purity">
                      {[0, 1, 2, 3, 4, 5, 6].map((p) => <button key={p} type="button" className="dojo-choice" aria-pressed={purity === p} onClick={() => props.onPurity(p)}>{p}</button>)}
                    </div>
                  </fieldset>
                  <p id="dojo-purity-help" className="dojo-help" data-purity-description="">{purityDescription(purity)}</p>
                </div>
              </PixelPanel>
            </div>
            <div className="dojo-side" data-side="opponent">
              <div className="dojo-lineup" data-lineup="opponent" aria-label={opponent === 'random' ? 'Opponent: three random classes' : 'Opponent: a mirror of your team'}>
                {[0, 1, 2].map((i) => (
                  <Fighter key={i} side="opponent" slot={i} sheet={sheet} unknown={opponent === 'random'}
                    classIndex={opponent === 'random' ? [8, 0, 3][i] : teamClasses[i] ?? null}
                    label={opponent === 'random' ? `Random class, slot ${i + 1}` : `Mirror of ${teamLabels[i]}, slot ${i + 1}`} />
                ))}
              </div>
              <PixelPanel asset="dojoDarkPanel" className="dojo-card" aria-labelledby="dojo-opponent-title">
                <div className="dojo-tabs dojo-opponent-tabs" role="tablist" aria-label="Opponent type">
                  <button id="dojo-bot-tab" type="button" role="tab" aria-selected="true" aria-controls="dojo-bot">Bot</button>
                  <button id="dojo-friend-tab" type="button" role="tab" aria-selected="false" aria-disabled="true" tabIndex={-1} title="Fight with friend — coming soon"
                    data-testid="dojo-friend-tab" onClick={(e) => e.preventDefault()}>
                    Fight with friend<small className="dojo-soon">Coming soon</small>
                  </button>
                </div>
                <div id="dojo-bot" role="tabpanel" aria-labelledby="dojo-bot-tab">
                  <label className="dojo-field">Training bot
                    <select data-testid="dojo-bot" aria-label="Training bot" value={bot} onChange={(e) => props.onBot(e.target.value as BotName)}>
                      {BOT_CATALOG.map((b) => <option key={b.name} value={b.name}>{b.label} · {b.difficulty}</option>)}
                    </select>
                  </label>
                  <details className="dojo-guide">
                    <summary>Bot guide</summary>
                    {botInfo(bot) && (
                      <div className="dojo-bot-notes" data-testid="dojo-bot-info">
                        <p><strong>Plays</strong><span>{botInfo(bot)!.plays}</span></p>
                        <p><strong>Lesson</strong><span>{botInfo(bot)!.teaches}</span></p>
                      </div>
                    )}
                  </details>
                  <fieldset className="dojo-options"><legend>Roster</legend>
                    <div data-choices="opponent">
                      {(['mirror', 'random'] as const).map((o) => (
                        <button key={o} type="button" className="dojo-choice" data-choice="opponent" aria-pressed={opponent === o} onClick={() => props.onOpponent(o)}>
                          {o === 'mirror' ? 'Mirror mine' : 'Random classes'}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="dojo-options"><legend>Arena</legend>
                    <div data-choices="arena" data-testid="dojo-arena">
                      {ARENA_CHOICES.map(([a, text]) => (
                        <button key={a} type="button" className="dojo-choice" data-choice="arena" data-value={a} aria-pressed={arena === a} onClick={() => props.onArena(a)}>{text}</button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </PixelPanel>
            </div>
          </div>
          <div className="dojo-footer">
            <button className="dojo-battle" type="button" aria-label={busy ? 'Starting…' : 'Battle'} title={busy ? 'Starting…' : 'Battle'} data-testid="dojo-battle"
              aria-busy={busy} disabled={busy || blocked || !valid} onClick={battle} />
            <div className="dojo-status" role="status" data-testid="dojo-status">
              {/* The sign-in gate takes the summary's place, so its button stays above the fold on short windows. */}
              {props.gate ? props.gate : error ? <p data-tone="error">{error}</p> : <p data-testid="dojo-summary">{busy ? 'Starting…' : summary}</p>}
              {props.identity}
            </div>
          </div>
          {props.devTools}
        </section>
      </div>
    </>
  );
}
