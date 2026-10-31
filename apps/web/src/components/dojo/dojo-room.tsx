'use client';

import './dojo.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { PixelPanel } from '@/components/shell/pixel-panel';
import { PIXEL_SCALE_EVENT, pixelScale } from '@/components/pixel/pixel-assets';
import { BOT_CATALOG, botInfo, type BotName } from '@/lib/bot-catalog';
import { playUiClick } from '@/lib/site-sfx';
import { ENTRY_IRIS_CLOSE_MS, getEntryState, reducedMotion, useBattleEntry } from '@/lib/battle-entry';
/** How far the scene eases back while the iris closes (owner 2026-10-27: "a looney tunes style zoom out"). */
const ENTRY_ZOOM = 0.92;
import { DojoSign } from './dojo-sign';
import { DojoSmoke } from './dojo-smoke';
import { anchorFighter, anchorShadow, cssPx, drawClass, drawIdleFrame, idleSheetSrc, IDLE_FRAMES, loadTierSheets, onIdleTick } from './dojo-sprites';
import { loadPixelImage } from '@/components/pixel/pixel-assets';
import { DojoSquirrel } from './dojo-squirrel';
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
 * - Opponent › Bot: the bot and its guide, mirror or random roster, the board.
 * - Opponent › Fight with friend (Battle Friends, 2026-10-28): the invite lobby the page renders (`friendPanel`); the
 *   friend's team stays hidden — their fighters are silhouettes until the battle — and teams are built ones only.
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
  /** Who you fight: the bot, or a friend by invite link (the page owns the lobby). */
  vs: 'bot' | 'friend';
  onVs: (vs: 'bot' | 'friend') => void;
  /** The Fight with friend panel: create / share the link, the lobby's status. */
  friendPanel: ReactNode;
  /** The friend, as far as you may know: joined, team locked in. Null = no friend yet. */
  friendOpponent: { joined: boolean; lockedIn: boolean } | null;
  /** In a lobby with your friend and not locked in yet: Battle locks your team in. */
  friendCanBattle: boolean;
}

/** His design window: the composition is laid out at this size (at the 3 px pixel) and scaled to fit. */
export const DOJO_DESIGN = { width: 1920, height: 955 } as const;
/** The mobile bottom nav below lg (game-shell.tsx). */
const MOBILE_NAV = 64;

/** Fit the stage: one uniform scale for the whole composition, centred in the window. Phones keep the unscaled
 *  small-screen layout. Returns the stage's `--pixel` (3 on the stage, the chrome's on a phone). */
function useStage(stageRef: RefObject<HTMLDivElement | null>) {
  const [unit, setUnit] = useState(3);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let last = '';
    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight - (vw < 1024 ? MOBILE_NAV : 0);
      // The real sidebar (lg+): his composition is drawn for the COMPACT pole. When the pole opens, the whole
      // composition shrinks and moves right as one piece (owner 2026-10-26: the fighters looked oversized when the
      // open sidebar squeezed only the cards), instead of reflowing.
      const rootStyle = getComputedStyle(document.documentElement);
      const n = parseFloat(rootStyle.getPropertyValue('--pixel-n')) || 3;
      const progress = vw >= 1024 ? Math.min(1, Math.max(0, parseFloat(rootStyle.getPropertyValue('--sidebar-expand-progress')) || 0)) : 0;
      const key = `${vw}x${vh}@${n}:${progress}`;
      if (key === last) return;
      // During a battle entry the scene holds still: the fullscreen request resizes the window under the closing iris,
      // and a re-fit there was a visible jump (owner 2026-10-27). It re-fits when the entry ends or is cancelled.
      if (last && getEntryState().phase !== 'idle') return;
      last = key;
      const extra = 80 * n * progress;   // the pole's growth from 96 to 128 art px, plus his 48 px compact offset
      const avail = vw - extra;
      const scale = vw < 700 ? 1 : Math.min(avail / DOJO_DESIGN.width, vh / DOJO_DESIGN.height);
      const tx = vw < 700 ? 0 : extra + (avail - DOJO_DESIGN.width * scale) / 2;
      const ty = vw < 700 ? 0 : Math.max(0, (vh - DOJO_DESIGN.height * scale) / 2);
      // The page clears the compact sidebar (his placeholders.css: 48 art px in from its 96), in stage px.
      const contentLeft = vw >= 1024 ? Math.max(0, (48 * n + extra - tx) / scale) : 0;
      stage.style.setProperty('--dojo-content-left', `${contentLeft}px`);
      stage.style.setProperty('--dojo-stage-scale', String(scale));
      // The wallet chip belongs to his composition too (owner 2026-10-26): on the Dojo it scales with the room.
      document.documentElement.style.setProperty('--dojo-stage-scale', String(scale));
      document.documentElement.setAttribute('data-dojo-stage', '');
      stage.style.setProperty('--dojo-stage-tx', `${tx}px`);
      stage.style.setProperty('--dojo-stage-ty', `${ty}px`);
      setUnit(pixelScale(stage));
      window.dispatchEvent(new CustomEvent(DOJO_STAGE_EVENT, { detail: scale }));
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener(PIXEL_SCALE_EVENT, fit);
    // The sidebar roll writes --sidebar-expand-progress on <html> every frame; follow it.
    const roll = new MutationObserver(fit);
    roll.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => {
      roll.disconnect();
      window.removeEventListener('resize', fit); window.removeEventListener(PIXEL_SCALE_EVENT, fit);
      document.documentElement.style.removeProperty('--dojo-stage-scale');
      document.documentElement.removeAttribute('data-dojo-stage');
    };
  }, [stageRef]);
  return unit;
}
export const DOJO_STAGE_EVENT = 'clawbada:dojo-stage';
/** The stage's current scale (1 when unscaled). */
export function stageScale(el: Element): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--dojo-stage-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** The four tier sheets (0 Base … 3 Apex), once loaded. */
function useTierSheets() {
  const [sheets, setSheets] = useState<HTMLImageElement[] | null>(null);
  useEffect(() => { let live = true; loadTierSheets().then((imgs) => { if (live) setSheets(imgs); }).catch(console.error); return () => { live = false; }; }, []);
  return sheets;
}
const TIER_INDEX: Record<DojoTier, number> = { evolved: 1, elite: 2, apex: 3 };

/** One lineup fighter (a diagonal slot with its shadow). */
function Fighter({ side, slot, classIndex, unknown, sheet, label, ghost, ghostSheet }: {
  side: 'team' | 'opponent'; slot: number; classIndex: number | null; unknown?: boolean; sheet: HTMLImageElement | null; label: string;
  ghostSheet?: HTMLImageElement | null;
  ghost?: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const shadowRef = useRef<HTMLImageElement>(null);
  const ghostShadowRef = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current, figure = figureRef.current;
    if (!canvas || !figure || !sheet || classIndex === null) return;
    const crop = drawClass(canvas, sheet, classIndex, cssPx(figure, '--dojo-selected-pixel', 4));
    anchorFighter(canvas, crop, side);
    if (shadowRef.current) anchorShadow(shadowRef.current, crop);
  }, [sheet, classIndex, side]);
  // The battle's Idle, once its sheet has loaded (the still frame shows until then, and stays under reduced motion).
  useEffect(() => {
    const canvas = canvasRef.current, figure = figureRef.current;
    const src = sheet ? idleSheetSrc(sheet) : null;
    if (!canvas || !figure || !src || classIndex === null || reducedMotion()) return;
    let off: (() => void) | null = null, live = true;
    loadPixelImage(src).then((idle) => {
      if (!live) return;
      const phase = Math.floor(Math.random() * IDLE_FRAMES);
      off = onIdleTick((tick) => {
        // Re-anchored every frame too (a few style writes): the stage's pixel changes when the window resizes.
        const crop = drawIdleFrame(canvas, idle, classIndex, tick + phase, cssPx(figure, '--dojo-selected-pixel', 4));
        anchorFighter(canvas, crop, side);
        if (shadowRef.current) anchorShadow(shadowRef.current, crop);
      });
    }).catch(() => { /* no idle sheet: the still frame stays */ });
    return () => { live = false; off?.(); };
  }, [sheet, classIndex, side]);
  useLayoutEffect(() => {
    const canvas = ghostRef.current, figure = figureRef.current;
    if (!canvas || !figure || !ghostSheet || ghost == null) return;
    const crop = drawClass(canvas, ghostSheet, ghost, cssPx(figure, '--dojo-selected-pixel', 4));
    anchorFighter(canvas, crop, 'team');
    if (ghostShadowRef.current) anchorShadow(ghostShadowRef.current, crop);
  }, [ghostSheet, ghost]);
  const filled = classIndex !== null;
  return (
    <figure ref={figureRef} className="dojo-fighter" data-fighter={side} data-slot={slot} data-unknown={unknown ? 'true' : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={shadowRef} className="dojo-shadow" src="/ui/dojo/Character_Shadow.png" width={64} height={32} alt="" draggable={false} hidden={!filled} />
      <canvas ref={canvasRef} role="img" aria-label={filled ? label : undefined} hidden={!filled} data-class={filled ? DOJO_CLASSES[classIndex] : undefined} />
      {ghost != null && (
        <div data-drag-preview="" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={ghostShadowRef} className="dojo-shadow" src="/ui/dojo/Character_Shadow.png" alt="" draggable={false} />
          <canvas ref={ghostRef} />
        </div>
      )}
    </figure>
  );
}

/** A portrait tile (an owned lobster, or a class in Build a team), drawn at the stage's pixel. */
function InventoryTile({ id, classIndex, name, detail, slot, sheet, unit, hidden, onClick }: {
  id: string; classIndex: number; name: string; detail: string; slot: number; sheet: HTMLImageElement | null; unit: number; hidden?: boolean; onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvasRef.current && sheet) drawClass(canvasRef.current, sheet, classIndex, unit);
  }, [sheet, classIndex, unit]);
  const picked = slot >= 0;
  return (
    <button
      type="button" className="dojo-inventory-tile" data-owned-id={id} aria-pressed={picked} hidden={hidden} onClick={onClick}
      aria-label={`${detail}${picked ? `, slot ${slot + 1}, click to remove` : ', click to add'}`}
    >
      <i className="dojo-portrait-clip" aria-hidden="true"><canvas ref={canvasRef} width={64} height={64} /></i>
      <span title={detail}>{name}</span>
      <span data-slot-badge="" hidden={!picked} aria-hidden="true">{picked ? slot + 1 : ''}</span>
      <i className="dojo-selected-corners" aria-hidden="true"><i /><i /><i /><i /></i>
    </button>
  );
}

export function DojoRoom(props: DojoRoomProps) {
  const { lobsters, teams, initialMode, isWallet, team, tier, purity, bot, opponent, arena, busy, blocked, error } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const unit = useStage(stageRef);
  const entry = useBattleEntry();
  // The iris (owner 2026-10-27): while it closes on the Battle button, the scene eases back to 92 % around that button.
  useEffect(() => {
    const page = rootRef.current, backdrop = arenaRef.current;
    if (!page || !backdrop) return;
    if (entry.phase === 'web' && entry.origin && !reducedMotion()) {
      const s = stageScale(page), box = page.getBoundingClientRect();
      page.style.transformOrigin = `${(entry.origin.x - box.left) / s}px ${(entry.origin.y - box.top) / s}px`;
      backdrop.style.transformOrigin = `${entry.origin.x}px ${entry.origin.y}px`;
      const raf = requestAnimationFrame(() => {
        for (const el of [page, backdrop]) {
          el.style.transition = `scale ${ENTRY_IRIS_CLOSE_MS}ms cubic-bezier(0.55, 0, 1, 0.45)`;
          el.style.scale = String(ENTRY_ZOOM);
        }
      });
      return () => cancelAnimationFrame(raf);
    }
    if (entry.phase === 'idle') {
      for (const el of [page, backdrop]) { el.style.transition = ''; el.style.scale = ''; el.style.transformOrigin = ''; }
      window.dispatchEvent(new Event('resize'));   // re-fit to whatever the window is now
    }
  }, [entry.phase, entry.origin]);
  const sheets = useTierSheets();
  const rootRef = useRef<HTMLDivElement>(null);
  const inventoryRef = useRef<HTMLDivElement>(null);
  const classGridRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<'owned' | 'builder'>('builder');
  const [modeTouched, setModeTouched] = useState(false);
  useEffect(() => { if (initialMode && !modeTouched) setMode(initialMode); }, [initialMode, modeTouched]);
  /** A tab change taps (owner 2026-10-27); pressing the tab you are on changes nothing and stays silent. */
  const pickMode = (m: 'owned' | 'builder') => { if (m !== mode) playUiClick(); setMode(m); setModeTouched(true); setFeedback(''); };

  const [panel, setPanel] = useState<'team' | 'opponent'>('team');
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  const [savedTeam, setSavedTeam] = useState<string>('');
  const [feedback, setFeedback] = useState('');
  const [page, setPage] = useState(0);
  const [drag, setDrag] = useState<{ id: string; slot: number } | null>(null);

  const byId = useMemo(() => new Map(lobsters.map((l) => [l.id, l])), [lobsters]);
  const usableTeams = useMemo(() => teams.filter((t) => t.lobsterIds.length === 3 && t.lobsterIds.every((id) => byId.has(id))), [teams, byId]);

  // The Dojo opens with nobody picked (owner 2026-10-26); lobsters that leave the wallet leave the lineup.
  useEffect(() => {
    setSlots((s) => { const next = s.map((id) => (byId.has(id) ? id : '')) as unknown as Slots; return next.some((id, i) => id !== s[i]) ? next : s; });
  }, [byId]);

  const pages = pageCount(lobsters.length);
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);

  // Portrait size: five per row across the inventory's width (gap 9 px × 4), as in the drop.
  useEffect(() => {
    const grids = [inventoryRef.current, classGridRef.current].filter((g): g is HTMLDivElement => !!g);
    const fit = (el: HTMLDivElement) => { el.style.setProperty('--portrait-size', `${Math.max(0, (el.clientWidth - 36) / 5)}px`); el.style.gridTemplateColumns = 'repeat(5, var(--portrait-size))'; };
    grids.forEach(fit);
    const ro = new ResizeObserver(() => grids.forEach(fit));
    grids.forEach((g) => ro.observe(g));
    return () => ro.disconnect();
  }, [mode, lobsters.length]);

  const vsFriend = props.vs === 'friend';
  // A friend battle is a built team (classes, tier, purity): My lobsters waits for on-chain teams.
  useEffect(() => { if (vsFriend && mode !== 'builder') setMode('builder'); }, [vsFriend, mode]);
  const ownedReady = mode === 'owned' && slotsComplete(slots);
  const builtSlots: Slots = [team[0] ?? '', team[1] ?? '', team[2] ?? ''];
  const builderReady = builtSlots.every(Boolean);
  const valid = vsFriend ? builderReady && props.friendCanBattle : mode === 'builder' ? builderReady : ownedReady;
  const activeSlots = mode === 'owned' ? slots : builtSlots;
  const botLabel = botInfo(bot)?.label ?? bot;
  const summary = vsFriend
    ? builderReady ? builderSummary(team, tier, purity, 'your friend') : 'Pick three classes for your team.'
    : mode === 'builder'
    ? builderReady ? builderSummary(team, tier, purity, botLabel) : 'Pick three classes for your team.'
    : ownedReady ? ownedSummary(slots.map((id) => lobsterName(byId.get(id)!)), savedTeam || null, botLabel)
      : isWallet ? 'Pick three lobsters for your team.' : 'Connect a wallet to train with your own lobsters, or build a team.';

  /** One edit path for both tabs: owned picks are lobster ids, built picks are class names (the page's `team`). */
  const editSlots = (next: Slots) => {
    setFeedback('');
    if (mode === 'builder') { props.onTeam([...next]); return; }
    setSlots(next); setSavedTeam('');
  };
  const clickTile = (id: string) => {
    const r = toggleSlot(activeSlots, id);
    if (r.full) { setFeedback(`Team full — remove a ${mode === 'builder' ? 'class' : 'lobster'} first.`); return; }
    editSlots(r.slots);
  };

  // ── drag (pointer capture keeps mouse, pen and touch drags alive outside the source) ──
  const classOf = (name: string) => DOJO_CLASSES.indexOf(name as (typeof DOJO_CLASSES)[number]);
  const classIndexOf = (id: string) => (mode === 'builder' ? classOf(id) : byId.get(id)?.classIndex ?? -1);
  /** Built teams show the chosen tier's art; own lobsters show their own tier. */
  const sheetFor = (id: string) => sheets?.[mode === 'builder' ? TIER_INDEX[tier] : Math.min(3, Math.max(0, byId.get(id)?.tier ?? 1))] ?? null;
  const builderSheet = sheets?.[TIER_INDEX[tier]] ?? null;
  const live = useRef({ slots: activeSlots, classIndexOf, sheetFor, unit });
  live.current = { slots: activeSlots, classIndexOf, sheetFor, unit };
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
    const inventory = () => root.querySelector('[role="tabpanel"]:not([hidden]) [data-owned-inventory]');
    const down = (e: PointerEvent) => {
      suppressClick = false;
      if (d || e.button !== 0 || !e.isPrimary) return;
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
      const { classIndexOf: indexOf, sheetFor: sheetOf, unit: u } = live.current;
      const img = sheetOf(d.id);
      if (!d.active && img) {
        const follower = document.createElement('canvas');
        follower.dataset.dragFollower = '';
        follower.setAttribute('aria-hidden', 'true');
        drawClass(follower, img, Math.max(0, indexOf(d.id)), (d.fromLineup ? cssPx(root, '--dojo-selected-pixel', 4) : u) * stageScale(root));
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

  const teamClasses: (number | null)[] = mode === 'builder' ? builtSlots.map((c) => (c ? classOf(c) : null)) : slots.map((id) => (id ? byId.get(id)?.classIndex ?? null : null));
  const teamSheets = activeSlots.map((id) => (id ? sheetFor(id) : null));
  const teamLabels = mode === 'builder' ? builtSlots.map((c) => (c ? title(c) : '')) : slots.map((id) => (id && byId.get(id) ? lobsterName(byId.get(id)!) : ''));

  const battle = () => {
    if (!valid || busy || blocked) return;
    props.onBattle(mode === 'builder' ? { mode: 'builder' } : { mode: 'owned', teamId: savedTeam || null, lobsterIds: [...slots] });
  };

  return (
    <>
      <div className="dojo-arena" aria-hidden="true" ref={arenaRef}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ui/dojo/Dojo_Dark.png" alt="" width={640} height={360} draggable={false} />
      </div>
      <DojoSquirrel />
      <div className="dojo-stage" ref={stageRef}>
      <div id="page-content" data-page="dojo" ref={rootRef}>
        <div className="dojo-team-headings"><h2 id="dojo-team-title">Your Team</h2><h2 id="dojo-opponent-title">Opponent</h2></div>
        <DojoSign title="The Dojo" />
        <section className="dojo" aria-label="Practice setup">
          <p className="dojo-intro">{vsFriend ? 'Build any team and battle a friend. No wallet, no stakes, no rating.' : 'Build any team and train against a bot. No stakes, no rating, no repair.'}</p>
          <nav className="dojo-panel-switch" aria-label="Setup panel">
            {(['team', 'opponent'] as const).map((p) => (
              <button key={p} type="button" data-dojo-panel={p} aria-pressed={panel === p} onClick={() => setPanel(p)}>{p === 'team' ? 'Your team' : 'Opponent'}</button>
            ))}
          </nav>
          <div className="dojo-cards pixel-grid" data-active-panel={panel}>
            <div className="dojo-side" data-side="team">
              <div className="dojo-lineup" data-lineup="team" aria-label="Your selected three lobsters">
                {[0, 1, 2].map((i) => (
                  <Fighter key={i} side="team" slot={i} classIndex={teamClasses[i] ?? null} sheet={teamSheets[i]} label={`${teamLabels[i]}, slot ${i + 1}`}
                    ghostSheet={drag ? sheetFor(drag.id) : null}
                    ghost={drag && drag.slot === i && classIndexOf(drag.id) >= 0 ? classIndexOf(drag.id) : null} />
                ))}
              </div>
              <PixelPanel asset="dojoDarkPanel" className="dojo-card" aria-labelledby="dojo-team-title">
                <div className="dojo-tabs" role="tablist" aria-label="Team source">
                  {(['owned', 'builder'] as const).map((m) => (
                    <button key={m} id={`dojo-${m}-tab`} type="button" role="tab" aria-selected={mode === m} aria-controls={`dojo-${m}`} tabIndex={mode === m ? 0 : -1}
                      data-team-mode={m} aria-disabled={vsFriend && m === 'owned' ? true : undefined} title={vsFriend && m === 'owned' ? 'Friend battles use a built team' : undefined}
                      onClick={() => { if (!(vsFriend && m === 'owned')) pickMode(m); }} onKeyDown={tabKeys}>
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
                      <p className="dojo-selection-feedback" role="status" aria-live="polite">{mode === 'owned' ? feedback : ''}</p>
                      <div className="dojo-inventory" data-owned-inventory="" ref={inventoryRef} aria-label="Your lobsters" data-testid="dojo-inventory">
                        {lobsters.map((l, i) => (
                          <InventoryTile key={l.id} id={l.id} classIndex={l.classIndex} name={l.className} detail={`${lobsterName(l)} · ${l.tierName}`}
                            slot={slots.indexOf(l.id)} sheet={sheets?.[Math.min(3, Math.max(0, l.tier))] ?? null} unit={unit}
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
                  {/* Nzib 2026-10-26: Build a team works like My lobsters — the ten classes as tiles, Tier and Purity compact. */}
                  <div data-owned-controls="">
                    <div className="dojo-compact" title={purityDescription(purity)}>
                      <fieldset className="dojo-compact-group"><legend>Tier</legend>
                        <div data-choices="tier" data-testid="dojo-tier">
                          {DOJO_TIERS.map((t) => <button key={t} type="button" className="dojo-choice" aria-pressed={tier === t} onClick={() => props.onTier(t)}>{title(t)}</button>)}
                        </div>
                      </fieldset>
                      <fieldset className="dojo-compact-group" aria-describedby="dojo-purity-help"><legend>Purity</legend>
                        <div data-choices="purity" data-testid="dojo-purity">
                          {[0, 1, 2, 3, 4, 5, 6].map((p) => <button key={p} type="button" className="dojo-choice" aria-pressed={purity === p} onClick={() => props.onPurity(p)}>{p}</button>)}
                        </div>
                      </fieldset>
                    </div>
                    <p id="dojo-purity-help" className="dojo-help" data-purity-description="">{purityDescription(purity)}</p>
                    <p className="dojo-selection-feedback" role="status" aria-live="polite">{mode === 'builder' ? feedback : ''}</p>
                    <div className="dojo-inventory" data-owned-inventory="" ref={classGridRef} aria-label="Classes" data-testid="dojo-classes">
                      {DOJO_CLASSES.map((c, i) => (
                        <InventoryTile key={c} id={c} classIndex={i} name={title(c)} detail={`${title(c)}, ${title(tier)}, purity ${purity}`}
                          slot={builtSlots.indexOf(c)} sheet={builderSheet} unit={unit} onClick={() => clickTile(c)} />
                      ))}
                    </div>
                  </div>
                </div>
              </PixelPanel>
            </div>
            <div className="dojo-side" data-side="opponent">
              {vsFriend ? (
                /* The friend's team is secret until the battle: silhouettes once they have joined, nobody before. */
                <div className="dojo-lineup" data-lineup="opponent" data-testid="dojo-friend-lineup"
                  data-friend={props.friendOpponent?.lockedIn ? 'locked' : props.friendOpponent?.joined ? 'picking' : 'none'}
                  aria-label={props.friendOpponent?.joined ? `Your friend's team: ${props.friendOpponent.lockedIn ? 'locked in' : 'still picking'}, hidden until the battle` : 'Waiting for your friend'}>
                  {[0, 1, 2].map((i) => (
                    <Fighter key={i} side="opponent" slot={i} sheet={builderSheet} unknown
                      classIndex={props.friendOpponent?.joined ? [8, 0, 3][i] : null} label={`Your friend's fighter ${i + 1}, hidden`} />
                  ))}
                </div>
              ) : (
              <div className="dojo-lineup" data-lineup="opponent" aria-label={opponent === 'random' ? 'Opponent: three random classes' : 'Opponent: a mirror of your team'}>
                {[0, 1, 2].map((i) => (
                  <Fighter key={i} side="opponent" slot={i} sheet={teamSheets[i] ?? builderSheet} unknown={opponent === 'random'}
                    classIndex={opponent === 'random' ? [8, 0, 3][i] : teamClasses[i] ?? null}
                    label={opponent === 'random' ? `Random class, slot ${i + 1}` : `Mirror of ${teamLabels[i]}, slot ${i + 1}`} />
                ))}
              </div>
              )}
              <PixelPanel asset="dojoDarkPanel" className="dojo-card" aria-labelledby="dojo-opponent-title">
                <div className="dojo-tabs dojo-opponent-tabs" role="tablist" aria-label="Opponent type">
                  {(['bot', 'friend'] as const).map((v) => (
                    <button key={v} id={`dojo-${v}-tab`} type="button" role="tab" aria-selected={props.vs === v} aria-controls={`dojo-${v}`} tabIndex={props.vs === v ? 0 : -1}
                      data-testid={`dojo-${v}-tab`} disabled={busy}
                      onClick={() => { if (props.vs !== v) { playUiClick(); props.onVs(v); } }}>
                      {v === 'bot' ? 'Bot' : 'Fight with friend'}
                    </button>
                  ))}
                </div>
                <div id="dojo-friend" role="tabpanel" aria-labelledby="dojo-friend-tab" hidden={!vsFriend} data-testid="dojo-friend">
                  {props.friendPanel}
                </div>
                <div id="dojo-bot" role="tabpanel" aria-labelledby="dojo-bot-tab" hidden={vsFriend}>
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
              data-launching={busy && !error ? 'true' : undefined}
              aria-busy={busy} disabled={busy || blocked || !valid} onClick={battle} />
            {busy && !error && <DojoSmoke />}
            <div className="dojo-status" role="status" data-testid="dojo-status">
              {/* The sign-in gate takes the summary's place, so its button stays above the fold on short windows. */}
              {props.gate ? props.gate : error ? <p data-tone="error">{error}</p> : <p data-testid="dojo-summary">{busy ? 'Starting…' : summary}</p>}
              {props.identity}
            </div>
          </div>
        </section>
      </div>
      </div>
      {/* Dev-only, outside the scaled stage: a plain corner drawer in window px. */}
      {props.devTools}
    </>
  );
}
