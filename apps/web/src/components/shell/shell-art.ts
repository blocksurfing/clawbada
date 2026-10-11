/**
 * The Shell room's art geometry and the stage lighting — Nzib's `components/shell-art.js` (baseline 3295433)
 * bound to the React-rendered room. The shared proportional cover scale preserves alignment across all seven
 * exports: `unit = max(width/640, height/360)`, centred horizontally, bottom-aligned so the Rock foreground stays
 * inside the viewport; NOT integer-cover zoom. The three stages share `--stage-unit = min(unit, (width−48)/456)`
 * so the lineup stays on screen when the scenery is cropped. Each stage has a beam (`.stage-lighting`, a child
 * of the room, Overlay-blended) that plays its eight entrance frames once (350 ms, steps(7)) and keeps the full
 * beam; a replacement plays the exit in reverse first; clearing plays the exit and hides it.
 */
import { mountShellShark } from './shell-shark';
import { mountShellBubbles } from './shell-bubbles';

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

  const update = () => {
    if (disposed) return;
    const { width, height } = room.getBoundingClientRect();
    if (!width || !height) return;
    const unit = Math.max(width / 640, height / 360);
    const left = (width - 640 * unit) / 2;
    const top = height - 360 * unit;
    const stageUnit = Math.min(unit, (width - 48) / 456);
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
      '--shell-lineup-height': `${Math.max(132, 110 * unit)}px`,
    };
    for (const [name, value] of Object.entries(values)) room.style.setProperty(name, value);
    const roomRect = room.getBoundingClientRect();
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
  const observer = new ResizeObserver(update);
  observer.observe(room);
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
