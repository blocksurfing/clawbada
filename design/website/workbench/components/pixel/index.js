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
      // Hidden panels have zero bounds. Their ResizeObserver schedules a repaint
      // when shown; never pass zero dimensions into the fixed-corner tiler.
      if (!rect.width || !rect.height) continue;
      const width=Math.round(rect.width/unit), height=Math.round(rect.height/unit);
      // Responsive layout can briefly leave nonzero bounds below the fixed
      // corners. Keep the last paint until ResizeObserver supplies usable bounds.
      const minimum=(asset.sliceSpan ?? asset.tile)*2;
      if (width<minimum || (!asset.horizontal && height<minimum)) continue;
      // Canvas resolution is in source pixels. CSS displays exactly unit x source dimensions.
      const pad=asset.identityJoins ? 2 : 0;
      if (canvas.width===width+pad*2 && canvas.height===height+pad*2 && element.dataset.pixelReady==='true') continue;
      canvas.width=width+pad*2; canvas.height=height+pad*2;
      canvas.style.width=`${canvas.width*unit}px`; canvas.style.height=`${canvas.height*unit}px`;
      if (pad) { canvas.style.top=`${-pad*unit}px`; canvas.style.left=`${-pad*unit}px`; }
      const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false;
      ctx.translate(pad,pad);
      const [sx,sy]=asset.region;
      const rows=asset.horizontal ? Array.from({length:asset.region[3]/asset.tile},(_,i)=>({source:i*asset.tile,dest:i*asset.tile,size:asset.tile})) : tileAxis(height,asset.tile,asset.sliceSpan);
      for (const row of rows) for (const col of tileAxis(width,asset.tile,asset.sliceSpan)) {
        ctx.drawImage(image,sx+col.source,sy+row.source,col.size,row.size,col.dest,row.dest,col.size,row.size);
      }
      if (asset.identityJoins) {
        const [x,y,w,h]=asset.identityJoins;
        // Only the top-left cream corner of this single tile is opaque.
        // Draw its visible 2x2 pixels outside each junction, not the full cross.
        ctx.drawImage(image,x,y,2,2,width,0,2,2);
        ctx.drawImage(image,x,y,2,2,0,height,2,2);
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
