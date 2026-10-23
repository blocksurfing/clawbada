import { loadingFrame } from './loading-timeline.js';
const sources = import.meta.glob('../../site/Loading Screen/*.png', { eager: true, query: '?url', import: 'default' });
const order = ['BG','Clouds','Hill','Rock','Tree','Back_Leaves','Tree_Leaves','Shifu','Front_Leaves'];
const sheets = new Set(['Back_Leaves','Shifu','Front_Leaves']);
export async function prepareWebLoading() {
  const root = document.querySelector('#web-loading');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const images = {};
  await Promise.all(Object.entries(sources).map(async ([path,url]) => {
    const image = new Image(); image.src = url;
    await image.decode(); images[path.split('/').pop().replace('.png','')] = image;
  }));
  let raf = 0;
  const label = root.querySelector('.web-loading-label');
  label.innerHTML = 'LOADING<span style="display:inline-block;width:1.5em;text-align:left" aria-hidden="true">...</span>';
  const dots = label.querySelector('span');
  const dotSequence = ['...', '..', '.', '..'];
  const start = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function paint(now) {
    const frame = reduced ? 0 : loadingFrame(now - start);
    const dotText = dotSequence[reduced ? 0 : Math.floor((now - start) / 400) % dotSequence.length];
    if (dots.textContent !== dotText) dots.textContent = dotText;
    ctx.clearRect(0,0,320,180);
    for (const name of order) {
      const image = images[name === 'Hill' ? `Hill${frame + 1}` : name];
      if (!image) throw new Error(`Missing loading layer: ${name}`);
      ctx.drawImage(image, sheets.has(name) ? frame * 320 : 0, 0, 320, 180, 0, 0, 320, 180);
    }
    root.dataset.frame = String(frame);
    raf = requestAnimationFrame(paint);
  }
  paint(start);
  return async () => {
    root.classList.add('web-loading--leaving');
    await new Promise(resolve => setTimeout(resolve, reduced ? 0 : 220));
    cancelAnimationFrame(raf);
    root.remove();
    document.querySelector('#app').inert = false;
    document.body.classList.remove('web-is-loading');
  };
}
