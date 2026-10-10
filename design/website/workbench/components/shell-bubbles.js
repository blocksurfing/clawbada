const sources = {
  medium: new URL('../assets/bubble-sheet.png', import.meta.url).href,
  small: new URL('../assets/bubble-small-sheet.png', import.meta.url).href,
};
export function mountShellBubbles(room) {
  const art = room.querySelector('.shell-art');
  const layer = document.createElement('div');
  layer.className = 'shell-bubbles';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {position:'absolute', inset:'0', zIndex:'5', pointerEvents:'none', overflow:'hidden'});
  art.append(layer); // Above sand, below foreground Rock (z-index 6).
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const bubbles = new Set();
  let closePair = false;
  let raf, next = 0, disposed = false;
  const random = (a,b) => a + Math.random()*(b-a);
  function spawn(now) {
    const {width:w,height:h} = room.getBoundingClientRect();
    const scale = Math.min(parseFloat(getComputedStyle(room).getPropertyValue('--shell-art-scale')) || 1, w/320);
    const size = 32*scale;
    const el = document.createElement('span');
    el.className = 'shell-bubble';
    const variant = Math.random()<0.5 ? 'small' : 'medium';
    const source = sources[variant];
    el.dataset.variant = variant;
    Object.assign(el.style,{position:'absolute',left:'0',top:'0',width:`${size}px`,height:`${size}px`,backgroundImage:`url("${source}")`,backgroundSize:`${352*scale}px ${size}px`,backgroundRepeat:'no-repeat',imageRendering:'pixelated'});
    layer.append(el);
    const bubble = {el,start:now,life:random(3800,4900),x:w*random(.92,.96),y:h*random(.84,.88),speed:h*random(.038,.044),boost:h*random(.095,.11),decay:random(.55,.70),amp:random(3,6)*scale,phase:random(0,Math.PI*2),size,scale,w};
    const hit = document.createElement('span');
    hit.className = 'shell-bubble-hit';
    Object.assign(hit.style,{position:'absolute',inset:variant==='small'?'32%':'25%',pointerEvents:'auto',cursor:'pointer'});
    el.append(hit);
    bubble.hit = hit;
    hit.addEventListener('click', event => {
      event.stopPropagation();
      if (el.dataset.phase==='out' || !bubbles.has(bubble)) return;
      bubble.life = Math.min(bubble.life, performance.now()-bubble.start);
      el.dataset.phase='out';
      el.dataset.frame='8';
      el.style.backgroundPosition=`${-8*32*scale}px 0`;
      hit.style.pointerEvents='none';
    });
    bubbles.add(bubble);
  }
  function tick(now) {
    if (disposed) return;
    if (reduced.matches && bubbles.size) reset();
    if (!reduced.matches) {
      if (now >= next) {
        spawn(now);
        // A continuous stream; occasional close pairs, never a whole volley.
        const pair = !closePair && Math.random()<0.18;
        next=now+(pair ? random(220,340) : random(650,1050));
        closePair=pair;
      }
      for (const b of bubbles) {
        const age=now-b.start;
        if (age>=b.life+300) { b.el.remove(); bubbles.delete(b); continue; }
        const phase=age>=b.life?'out':age<300?'spawn':'idle';
        if (phase==='out') b.hit.style.pointerEvents='none';
        const frame=phase==='spawn'?Math.floor(age/100):phase==='idle'?3+Math.floor((age-300)/100)%5:8+Math.min(2,Math.floor((age-b.life)/100));
        const seconds=age/1000;
        const t=seconds/4;
        // Integrate speed + a decaying launch impulse. No endpoint or zero-speed stop,
        // including during Out; lifetimes determine where bubbles pop independently.
        const rise=b.speed*seconds+b.boost*b.decay*(1-Math.exp(-seconds/b.decay));
        const dx=b.amp*(Math.sin(t*7+b.phase)-Math.sin(b.phase)) + b.amp*.4*(Math.sin(t*13+b.phase)-Math.sin(b.phase));
        const x=Math.max(b.size/2,Math.min(b.w-b.size/2,b.x+dx));
        b.el.style.transform=`translate(${x-b.size/2}px,${b.y-rise-b.size/2}px)`;
        b.el.style.backgroundPosition=`${-frame*32*b.scale}px 0`;
        b.el.dataset.phase=phase;
        b.el.dataset.frame=frame;
      }
    }
    raf=requestAnimationFrame(tick);
  }
  function reset() { for(const b of bubbles)b.el.remove(); bubbles.clear(); closePair=false; next=performance.now()+500; }
  const resize = new ResizeObserver(reset); resize.observe(room);
  reduced.addEventListener('change',reset);
  raf=requestAnimationFrame(tick);
  return () => { disposed=true;cancelAnimationFrame(raf);resize.disconnect();reduced.removeEventListener('change',reset);layer.remove();bubbles.clear(); };
}
