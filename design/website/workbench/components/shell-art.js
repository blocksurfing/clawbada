// Shared proportional cover scale preserves alignment across all exports.
// Bottom alignment keeps the Rock foreground inside the viewport.
import { pixelAssets } from '../pixel-assets.js';
import { mountShellShark } from './shell-shark.js';
import { mountShellBubbles } from './shell-bubbles.js';

export function mountShellArt(root) {
  const room = root.querySelector('.shell-room');
  if (!room) return () => {};
  for (const plant of room.querySelectorAll('[data-seaweed]')) {
    plant.style.backgroundImage = `url("${pixelAssets[`shellSeaweed${plant.dataset.seaweed}`].src}")`;
  }
  for (const character of room.querySelectorAll('.slot-character')) {
    character.style.backgroundImage = `url("${pixelAssets.apexClassSheet.src}")`;
  }
  // Blend beams against the room, outside the isolated slot/lineup.
  const beams = [...room.querySelectorAll('.lobby-slot')].map(slot => {
    const light = slot.querySelector('.stage-lighting');
    room.append(light);
    light.dataset.slot = slot.dataset.slot;
    return { slot, light };
  });
  let disposed = false;
  const onSelection = async event => {
    const beam = beams.find(item => item.slot === event.target);
    if (!beam) return;
    event.preventDefault();
    const { slot, light } = beam;
    const token = beam.token = (beam.token || 0) + 1;
    const currentFrame = getComputedStyle(light).backgroundPositionX;
    beam.animation?.cancel();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const play = async (from, to, phase) => {
      light.style.display = 'block';
      light.dataset.phase = phase;
      beam.animation = light.animate([
        { backgroundPositionX:from }, { backgroundPositionX:to }
      ], { duration:reduced ? 0 : 350, easing:'steps(7)', fill:'forwards' });
      try { await beam.animation.finished; } catch { return false; }
      return !disposed && beam.token === token;
    };
    if (slot.dataset.selected === 'true') {
      if (!await play(currentFrame, '0px', 'out')) return;
    }
    if (disposed || beam.token !== token) return;
    event.detail.commit();
    if (!event.detail.name) {
      beam.animation?.cancel();
      light.style.display = 'none';
      light.dataset.phase = 'off';
      return;
    }
    if (await play('0px', 'calc(-1344 * var(--stage-unit))', 'in')) light.dataset.phase = 'on';
  };
  room.addEventListener('shell-selection', onSelection);
  const update = () => {
    const { width, height } = room.getBoundingClientRect();
    const unit = Math.max(width / 640, height / 360);
    const left = (width - 640 * unit) / 2;
    const top = height - 360 * unit;
    const stageUnit = Math.min(unit, (width - 48) / 456);
    const values = {
      '--stage-unit': `${stageUnit}px`,
      '--shell-art-scale': String(unit),
      '--shell-scene-width': `${640 * unit}px`,
      '--shell-scene-height': `${360 * unit}px`,
      '--shell-scene-left': `${left}px`,
      '--shell-scene-top': `${top}px`,
      '--shell-center': `${left + 320 * unit}px`,
      '--shell-ground': `${top + 278 * unit}px`,
      // Mock slot controls must remain on-screen even when the scenery is cropped.
      '--shell-lineup-width': `${456 * stageUnit}px`,
      '--shell-lineup-height': `${Math.max(132, 110 * unit)}px`,
    };
    for (const [name, value] of Object.entries(values)) room.style.setProperty(name, value);
    const roomRect = room.getBoundingClientRect();
    beams.forEach(({ slot, light }) => {
      const stage = slot.querySelector('.character-stage').getBoundingClientRect();
      light.style.left = `${stage.left - roomRect.left + 14 * stageUnit}px`;
      light.style.top = `${stage.bottom - roomRect.top - 278 * stageUnit}px`;
    });
  };
  update();
  const disposeShark = mountShellShark(room);
  const disposeBubbles = mountShellBubbles(room);
  const observer = new ResizeObserver(update);
  observer.observe(room);
  return () => { disposed = true; disposeShark(); disposeBubbles(); observer.disconnect(); room.removeEventListener('shell-selection', onSelection); beams.forEach(({ light, animation }) => { animation?.cancel(); light.remove(); }); };
}
