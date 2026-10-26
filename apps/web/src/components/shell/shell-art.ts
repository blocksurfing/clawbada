/**
 * The Shell room's art geometry and the stage lighting — Nzib's `components/shell-art.js` (baseline 3295433)
 * bound to the React-rendered room. The shared proportional cover scale preserves alignment across all seven
 * exports: `unit = max(width/640, height/360)`, centred horizontally, bottom-aligned so the Rock foreground stays
 * inside the viewport; NOT integer-cover zoom. The three stages sit in the FREE BAND between the sidebar's cloth
 * and the right-hand column (Battle button, Queue/Active/History) — centred there, `--stage-unit = min(unit,
 * band/456)` — so neither covers a stage at any window size (owner 2026-10-25: on a 13" MacBook at 100 % the
 * sidebar hid the first stage and Battle the third label). The scenery itself stays full-bleed behind them. Each stage has a beam (`.stage-lighting`, a child
 * of the room, Overlay-blended) that plays its eight entrance frames once (350 ms, steps(7)) and keeps the full
 * beam; a replacement plays the exit in reverse first; clearing plays the exit and hides it.
 */
import { mountShellShark } from './shell-shark';
import { mountShellBubbles } from './shell-bubbles';

/** Clear space between the lineup and the sidebar / right-hand column, px. */
const BAND_GAP = 24;

const SEAWEED = ['/ui/shell/seaweed-1.png', '/ui/shell/seaweed-2.png'];

export interface ShellArt {
  /** A stage's pick changes: exit beam if one was lit, `commit` (React state), entrance beam if a pick remains. */
  select(slot: number, hasPick: boolean, commit: () => void): void;
  /** Re-run the cover maths (the art does it on resize by itself). */
  update(): void;
  dispose(): void;
}

export function mountShellArt(room: HTMLElement, onStageUnit?: (stageUnit: number, unit: number) => void): ShellArt {
  room.querySelectorAll<HTMLElement>('[data-seaweed]').forEach((plant) => {
    plant.style.backgroundImage = `url("${SEAWEED[Number(plant.dataset.seaweed) - 1] ?? SEAWEED[0]}")`;
  });
  const slots = [...room.querySelectorAll<HTMLElement>('.lobby-slot')];
  const beams = slots.map((slot) => ({
    slot,
    light: room.querySelector<HTMLElement>(`.shell-room > .stage-lighting[data-slot="${slot.dataset.slot}"]`),
    token: 0,
    animation: null as Animation | null,
    lit: false,
  }));
  let disposed = false;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function play(beam: (typeof beams)[number], from: string, to: string, phase: 'out' | 'in'): Promise<boolean> {
    const { light } = beam;
    if (!light) return false;
    const token = beam.token;
    light.style.display = 'block';
    light.dataset.phase = phase;
    beam.animation = light.animate([{ backgroundPositionX: from }, { backgroundPositionX: to }], {
      duration: reduced() ? 0 : 350, easing: 'steps(7)', fill: 'forwards',
    });
    try { await beam.animation.finished; } catch { return false; }
    return !disposed && beam.token === token;
  }

  const select = async (index: number, hasPick: boolean, commit: () => void) => {
    const beam = beams[index];
    if (!beam || !beam.light) { commit(); return; }
    const token = (beam.token = beam.token + 1);
    const currentFrame = getComputedStyle(beam.light).backgroundPositionX;
    beam.animation?.cancel();
    if (beam.lit) {
      if (!await play(beam, currentFrame, '0px', 'out')) return;
    }
    if (disposed || beam.token !== token) return;
    commit();
    if (!hasPick) {
      beam.animation?.cancel();
      beam.light.style.display = 'none';
      beam.light.dataset.phase = 'off';
      beam.lit = false;
      return;
    }
    beam.lit = true;
    if (await play(beam, '0px', 'calc(-1344 * var(--stage-unit))', 'in')) beam.light.dataset.phase = 'on';
  };

  let observer: ResizeObserver | null = null;
  let watchedPanel: Element | null = null;
  const update = () => {
    if (disposed) return;
    const { width, height } = room.getBoundingClientRect();
    if (!width || !height) return;
    const unit = Math.max(width / 640, height / 360);
    const left = (width - 640 * unit) / 2;
    const top = height - 360 * unit;
    // The free band: right of the sidebar's cloth (#panel — its pole and logo only reach the top of the room), left of
    // the Battle button and the tabs. Hidden chrome (below the desktop breakpoint) frees the whole width.
    const roomRect = room.getBoundingClientRect();
    const visible = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null ? el.getBoundingClientRect() : null;
    const panelEl = document.querySelector('.pixel-chrome #panel');
    if (panelEl && panelEl !== watchedPanel && observer) { observer.observe(panelEl); watchedPanel = panelEl; }   // the chrome may mount after the room
    const cloth = visible(panelEl);
    const bandLeft = (cloth ? Math.max(0, cloth.right - roomRect.left) : 0) + BAND_GAP;
    const rightEdges = ['.shell-battle', '.shell-tabs'].map((s) => visible(room.querySelector(s))).filter((r): r is DOMRect => !!r).map((r) => r.left - roomRect.left);
    const bandRight = Math.min(width, ...rightEdges) - BAND_GAP;
    const band = Math.max(160, bandRight - bandLeft);
    const stageUnit = Math.min(unit, band / 456);
    const values: Record<string, string> = {
      '--stage-unit': `${stageUnit}px`,
      '--shell-art-scale': String(unit),
      '--shell-scene-width': `${640 * unit}px`,
      '--shell-scene-height': `${360 * unit}px`,
      '--shell-scene-left': `${left}px`,
      '--shell-scene-top': `${top}px`,
      '--shell-center': `${left + 320 * unit}px`,
      '--shell-ground': `${top + 278 * unit}px`,
      // The slot controls must remain on-screen even when the scenery is cropped.
      '--shell-lineup-width': `${456 * stageUnit}px`,
      '--shell-lineup-center': `${bandLeft + band / 2}px`,
      '--shell-lineup-height': `${Math.max(132, 110 * unit)}px`,
    };
    for (const [name, value] of Object.entries(values)) room.style.setProperty(name, value);
    beams.forEach(({ slot, light }) => {
      const stage = slot.querySelector('.character-stage');
      if (!stage || !light) return;
      const r = stage.getBoundingClientRect();
      light.style.left = `${r.left - roomRect.left + 14 * stageUnit}px`;
      light.style.top = `${r.bottom - roomRect.top - 278 * stageUnit}px`;
    });
    onStageUnit?.(stageUnit, unit);
  };
  update();
  const disposeShark = mountShellShark(room);
  const disposeBubbles = mountShellBubbles(room);
  observer = new ResizeObserver(update);
  observer.observe(room);
  // The band moves when the sidebar rolls open or closed (its #panel is watched from update()), or the chrome rescales.
  room.querySelectorAll('.shell-battle, .shell-tabs').forEach((el) => observer.observe(el));
  return {
    select: (slot, hasPick, commit) => { void select(slot, hasPick, commit); },
    update,
    dispose() {
      disposed = true;
      disposeShark();
      disposeBubbles();
      observer.disconnect();
      beams.forEach((b) => { b.animation?.cancel(); if (b.light) { b.light.style.display = 'none'; b.light.dataset.phase = 'off'; } });
    },
  };
}
