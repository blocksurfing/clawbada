// Ambient shark: a single straight pass, then a randomized quiet interval.
import '../styles/shell-shark.css';
const source = new URL('../../site/The Shell/Shark.png', import.meta.url).href;
export function mountShellShark(room) {
  const shark = document.createElement('div');
  shark.className = 'shell-shark';
  shark.setAttribute('aria-hidden', 'true');
  const sprite = document.createElement('span');
  sprite.className = 'shell-shark-sprite';
  sprite.style.backgroundImage = `url("${source}")`;
  shark.append(sprite);
  // Same z-index as shell-art; earlier paint order keeps every artwork above it.
  room.prepend(shark);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let timer, swim, disposed = false;
  const random = (min, max) => min + Math.random() * (max - min);
  function schedule(delay) {
    clearTimeout(timer);
    if (!disposed && !reduced.matches) timer = setTimeout(spawn, delay);
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
    shark.style.setProperty('--shark-scale', scale);
    // Keep the whole sprite within the upper band marked in the reference.
    const minTop = height * 0.02;
    const maxTop = Math.max(minTop, height * 0.24 - 48 * scale);
    shark.style.top = `${random(minTop, maxTop)}px`;
    shark.dataset.direction = fromLeft ? 'right' : 'left';
    shark.dataset.start = start;
    shark.dataset.end = end;
    sprite.style.transform = fromLeft ? 'none' : 'scaleX(-1)';
    shark.hidden = false;
    swim = shark.animate([
      { transform:`translateX(${start}px)`, opacity:0, offset:0 },
      { transform:`translateX(${start + (end-start)*0.08}px)`, opacity:1, offset:0.08 },
      { transform:`translateX(${start + (end-start)*0.90}px)`, opacity:1, offset:0.90 },
      { transform:`translateX(${end}px)`, opacity:0, offset:1 }
    ], { duration:random(24000,36000), easing:'linear', fill:'forwards' });
    swim.finished.then(() => {
      if (disposed) return;
      shark.hidden = true;
      schedule(random(4000,9000));
    }).catch(() => {});
  }
  function reset() {
    clearTimeout(timer);
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
    clearTimeout(timer);
    swim?.cancel();
    resize.disconnect();
    reduced.removeEventListener('change', reset);
    shark.remove();
  };
}
