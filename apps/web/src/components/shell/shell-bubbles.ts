/**
 * The bubbles — Nzib's `components/shell-bubbles.js` (baseline 3295433): a sequential, vertically spaced
 * right-side stream with a gentle curved upward travel; no synchronized fan/burst and no pile-up at the endpoint.
 * Small and Medium use separate original sheets (352×32, eleven 32 px frames: 3 spawn, 5 idle, 3 out), never a
 * CSS resize of one variant. Clicking an exposed bubble plays its Out frames and removes it. The layer sits in
 * `.shell-art` above the sand and below the foreground Rock.
 */
const SOURCES = {
  medium: '/ui/shell/bubble-sheet.png',
  small: '/ui/shell/bubble-small-sheet.png',
};

interface Bubble {
  el: HTMLElement; hit: HTMLElement; start: number; life: number; x: number; y: number; speed: number; boost: number;
  decay: number; amp: number; phase: number; size: number; scale: number; w: number;
}

export function mountShellBubbles(room: HTMLElement): () => void {
  const art = room.querySelector('.shell-art');
  if (!art) return () => {};
  const layer = document.createElement('div');
  layer.className = 'shell-bubbles';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'absolute', inset: '0', zIndex: '5', pointerEvents: 'none', overflow: 'hidden' });
  art.append(layer); // Above sand, below foreground Rock (z-index 6).
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const bubbles = new Set<Bubble>();
  let closePair = false;
  let raf = 0;
  let next = 0;
  let disposed = false;
  const random = (a: number, b: number) => a + Math.random() * (b - a);
  function spawn(now: number) {
    const { width: w, height: h } = room.getBoundingClientRect();
    const scale = Math.min(parseFloat(getComputedStyle(room).getPropertyValue('--shell-art-scale')) || 1, w / 320);
    const size = 32 * scale;
    const el = document.createElement('span');
    el.className = 'shell-bubble';
    const variant = Math.random() < 0.5 ? 'small' : 'medium';
    el.dataset.variant = variant;
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: `${size}px`, height: `${size}px`, backgroundImage: `url("${SOURCES[variant]}")`, backgroundSize: `${352 * scale}px ${size}px`, backgroundRepeat: 'no-repeat', imageRendering: 'pixelated' });
    layer.append(el);
    const hit = document.createElement('span');
    hit.className = 'shell-bubble-hit';
    Object.assign(hit.style, { position: 'absolute', inset: variant === 'small' ? '32%' : '25%', pointerEvents: 'auto', cursor: 'pointer' });
    el.append(hit);
    const bubble: Bubble = { el, hit, start: now, life: random(3800, 4900), x: w * random(0.92, 0.96), y: h * random(0.84, 0.88), speed: h * random(0.038, 0.044), boost: h * random(0.095, 0.11), decay: random(0.55, 0.70), amp: random(3, 6) * scale, phase: random(0, Math.PI * 2), size, scale, w };
    hit.addEventListener('click', (event) => {
      event.stopPropagation();
      if (el.dataset.phase === 'out' || !bubbles.has(bubble)) return;
      bubble.life = Math.min(bubble.life, performance.now() - bubble.start);
      el.dataset.phase = 'out';
      el.dataset.frame = '8';
      el.style.backgroundPosition = `${-8 * 32 * scale}px 0`;
      hit.style.pointerEvents = 'none';
    });
    bubbles.add(bubble);
  }
  function reset() { for (const b of bubbles) b.el.remove(); bubbles.clear(); closePair = false; next = performance.now() + 500; }
  function tick(now: number) {
    if (disposed) return;
    if (reduced.matches && bubbles.size) reset();
    if (!reduced.matches) {
      if (now >= next) {
        spawn(now);
        // A continuous stream; occasional close pairs, never a whole volley.
        const pair = !closePair && Math.random() < 0.18;
        next = now + (pair ? random(220, 340) : random(650, 1050));
        closePair = pair;
      }
      for (const b of bubbles) {
        const age = now - b.start;
        if (age >= b.life + 300) { b.el.remove(); bubbles.delete(b); continue; }
        const phase = age >= b.life ? 'out' : age < 300 ? 'spawn' : 'idle';
        if (phase === 'out') b.hit.style.pointerEvents = 'none';
        const frame = phase === 'spawn' ? Math.floor(age / 100) : phase === 'idle' ? 3 + Math.floor((age - 300) / 100) % 5 : 8 + Math.min(2, Math.floor((age - b.life) / 100));
        const seconds = age / 1000;
        const t = seconds / 4;
        // Integrate speed + a decaying launch impulse. No endpoint or zero-speed stop, including during Out.
        const rise = b.speed * seconds + b.boost * b.decay * (1 - Math.exp(-seconds / b.decay));
        const dx = b.amp * (Math.sin(t * 7 + b.phase) - Math.sin(b.phase)) + b.amp * 0.4 * (Math.sin(t * 13 + b.phase) - Math.sin(b.phase));
        const x = Math.max(b.size / 2, Math.min(b.w - b.size / 2, b.x + dx));
        b.el.style.transform = `translate(${x - b.size / 2}px,${b.y - rise - b.size / 2}px)`;
        b.el.style.backgroundPosition = `${-frame * 32 * b.scale}px 0`;
        b.el.dataset.phase = phase;
        b.el.dataset.frame = String(frame);
      }
    }
    raf = requestAnimationFrame(tick);
  }
  const resize = new ResizeObserver(reset);
  resize.observe(room);
  reduced.addEventListener('change', reset);
  raf = requestAnimationFrame(tick);
  return () => { disposed = true; cancelAnimationFrame(raf); resize.disconnect(); reduced.removeEventListener('change', reset); layer.remove(); bubbles.clear(); };
}
