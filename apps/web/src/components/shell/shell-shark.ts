/**
 * The ambient shark — Nzib's `components/shell-shark.js` (baseline 3295433): a single straight pass, then a
 * randomized quiet interval. Horizontal one-way passes, randomized starting side and height within the approved
 * upper band, behind the room artwork (prepended at z 0). Sprite loop 1.2 s (CSS), travel 24–36 s, 4–9 s gaps.
 * Never vertical wandering.
 */
const SOURCE = '/ui/shell/Shark.png';

export function mountShellShark(room: HTMLElement): () => void {
  const shark = document.createElement('div');
  shark.className = 'shell-shark';
  shark.setAttribute('aria-hidden', 'true');
  const sprite = document.createElement('span');
  sprite.className = 'shell-shark-sprite';
  sprite.style.backgroundImage = `url("${SOURCE}")`;
  shark.append(sprite);
  // Same z-index as shell-art; earlier paint order keeps every artwork above it.
  room.prepend(shark);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer: number | undefined;
  let swim: Animation | undefined;
  let disposed = false;
  const random = (min: number, max: number) => min + Math.random() * (max - min);
  function schedule(delay: number) {
    window.clearTimeout(timer);
    if (!disposed && !reduced.matches) timer = window.setTimeout(spawn, delay);
  }
  function spawn() {
    if (disposed || reduced.matches) return;
    const { width, height } = room.getBoundingClientRect();
    const scale = Math.min(parseFloat(getComputedStyle(room).getPropertyValue('--shell-art-scale')) || 1, width / 320);
    const spriteWidth = 96 * scale;
    const fromLeft = Math.random() < 0.5;
    const left = width * random(0.10, 0.18);
    const right = width * random(0.82, 0.90) - spriteWidth;
    const start = fromLeft ? left : right;
    const end = fromLeft ? right : left;
    shark.style.setProperty('--shark-scale', String(scale));
    // Keep the whole sprite within the upper band marked in the reference.
    const minTop = height * 0.02;
    const maxTop = Math.max(minTop, height * 0.24 - 48 * scale);
    shark.style.top = `${random(minTop, maxTop)}px`;
    shark.dataset.direction = fromLeft ? 'right' : 'left';
    shark.dataset.start = String(start);
    shark.dataset.end = String(end);
    sprite.style.transform = fromLeft ? 'none' : 'scaleX(-1)';
    shark.hidden = false;
    swim = shark.animate([
      { transform: `translateX(${start}px)`, opacity: 0, offset: 0 },
      { transform: `translateX(${start + (end - start) * 0.08}px)`, opacity: 1, offset: 0.08 },
      { transform: `translateX(${start + (end - start) * 0.90}px)`, opacity: 1, offset: 0.90 },
      { transform: `translateX(${end}px)`, opacity: 0, offset: 1 },
    // 30 % faster than Nzib's 24–36 s pass (owner 2026-10-28): the same path in 18.5–27.7 s.
    ], { duration: random(18500, 27700), easing: 'linear', fill: 'forwards' });
    swim.finished.then(() => {
      if (disposed) return;
      shark.hidden = true;
      schedule(random(4000, 9000));
    }).catch(() => {});
  }
  function reset() {
    window.clearTimeout(timer);
    swim?.cancel();
    shark.hidden = true;
    schedule(1500);
  }
  const resize = new ResizeObserver(reset);
  resize.observe(room);
  reduced.addEventListener('change', reset);
  reset();
  return () => {
    disposed = true;
    window.clearTimeout(timer);
    swim?.cancel();
    resize.disconnect();
    reduced.removeEventListener('change', reset);
    shark.remove();
  };
}
