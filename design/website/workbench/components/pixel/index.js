import { pixelAssets } from '../../pixel-assets.js';
import { gridTracks, tileAxis, frameRect } from './geometry.js';

const images = new Map();
function loadImage(src) {
  if (!images.has(src)) images.set(src, new Promise((resolve,reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Pixel asset failed to load: ${src}`));
    image.src = src;
  }));
  return images.get(src);
}

// Called once per page render. Cleanup prevents detached observers on navigation.
export function mountPixelUI(root) {
  let disposed = false, scheduled = 0;
  const scale = () => {
    const value = parseFloat(getComputedStyle(root).getPropertyValue('--pixel'));
    if (!Number.isInteger(value) || value<1) throw new Error('Pixel scale must be a positive integer');
    return value;
  };
  const panels = [...root.querySelectorAll('[data-pixel-panel]')].map(element => {
    const asset = pixelAssets[element.dataset.pixelPanel];
    if (!asset || asset.kind !== 'panel') throw new Error('Unknown pixel panel');
    element.classList.add('pixel-panel');
    element.style.setProperty('--panel-tile', asset.tile);
    const canvas = document.createElement('canvas');
    canvas.className = 'pixel-panel-art';
    canvas.setAttribute('aria-hidden','true');
    element.prepend(canvas);
    const entry = {element,asset,canvas,image:null};
    loadImage(asset.src).then(image => { if (!disposed) { entry.image=image; schedule(); } }).catch(console.error);
    return entry;
  });
  for (const element of root.querySelectorAll('[data-pixel-sprite]')) {
    const asset = pixelAssets[element.dataset.pixelSprite];
    if (!asset || asset.kind !== 'sprite') throw new Error('Unknown pixel sprite');
    const frame = frameRect(asset, Number(element.dataset.frame || 0));
    element.classList.add('pixel-sprite');
    element.style.setProperty('--sprite-width', frame.width);
    element.style.setProperty('--sprite-height', frame.height);
    const canvas = document.createElement('canvas');
    canvas.width=frame.width; canvas.height=frame.height;
    canvas.setAttribute('aria-hidden','true');
    element.append(canvas);
    loadImage(asset.src).then(image => {
      if (disposed) return;
      const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false;
      ctx.drawImage(image,frame.x,frame.y,frame.width,frame.height,0,0,frame.width,frame.height);
    }).catch(console.error);
  }
  const grids = [...root.querySelectorAll('[data-pixel-grid]')];
  const snapElements = [...root.querySelectorAll('[data-pixel-panel], .pixel-button, [data-pixel-sprite]')];
  function update() {
    scheduled=0;
    if (disposed) return;
    const unit=scale();
    for (const grid of grids) {
      const gap=parseFloat(getComputedStyle(grid).columnGap) || 0;
      const {columns,width}=gridTracks(grid.clientWidth,unit,gap,Number(grid.dataset.minWidth || 270),Number(grid.dataset.columns || 3));
      const value=`repeat(${columns}, ${width}px)`;
      if (grid.style.gridTemplateColumns!==value) grid.style.gridTemplateColumns=value;
    }
    // Snap paint positions to the content-origin grid, including fractional grid/text geometry.
    const parentStyle=getComputedStyle(root);
    const origin=root.getBoundingClientRect();
    const originX=Math.round(origin.left+parseFloat(parentStyle.paddingLeft));
    const originY=Math.round(origin.top+parseFloat(parentStyle.paddingTop)-root.scrollTop);
    for (const element of snapElements) {
      const oldX=Number(element.dataset.snapX || 0), oldY=Number(element.dataset.snapY || 0);
      const rect=element.getBoundingClientRect();
      const x=rect.left-oldX, y=rect.top-oldY;
      const dx=originX+Math.round((x-originX)/unit)*unit-x;
      const dy=originY+Math.round((y-originY)/unit)*unit-y;
      element.style.translate=`${dx}px ${dy}px`;
      element.dataset.snapX=dx; element.dataset.snapY=dy;
    }
    for (const {element,asset,canvas,image} of panels) {
      if (!image) continue;
      const rect=element.getBoundingClientRect();
      const width=Math.round(rect.width/unit), height=Math.round(rect.height/unit);
      // Canvas resolution is in source pixels. CSS displays exactly unit x source dimensions.
      if (canvas.width===width && canvas.height===height && element.dataset.pixelReady==='true') continue;
      canvas.width=width; canvas.height=height;
      canvas.style.width=`${width*unit}px`; canvas.style.height=`${height*unit}px`;
      const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false;
      const [sx,sy]=asset.region;
      for (const row of tileAxis(height,asset.tile)) for (const col of tileAxis(width,asset.tile)) {
        ctx.drawImage(image,sx+col.source,sy+row.source,col.size,row.size,col.dest,row.dest,col.size,row.size);
      }
      element.dataset.pixelReady='true';
    }
  }
  function schedule() { if (!disposed && !scheduled) scheduled=requestAnimationFrame(update); }
  const observer=new ResizeObserver(schedule);
  observer.observe(root);
  [...grids,...snapElements,root.querySelector('.page-header')].filter(Boolean).forEach(e=>observer.observe(e));
  root.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  document.fonts.ready.then(schedule);
  schedule();
  return () => {
    disposed=true; cancelAnimationFrame(scheduled); observer.disconnect();
    root.removeEventListener('scroll',schedule); window.removeEventListener('resize',schedule);
  };
}
