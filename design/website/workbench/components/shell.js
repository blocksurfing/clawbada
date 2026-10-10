export function initShell(initialLabel, onNavigate) {

'use strict';
// 1. SETTINGS / ASSET CONTRACT
// Edit CSS tokens below :root for layout/timing. Source geometry stays on 16px tiles.
const cssTokens = getComputedStyle(document.documentElement);
const tokenNumber = name => parseFloat(cssTokens.getPropertyValue(name));
const CONFIG = Object.freeze({
  pixelScale: tokenNumber('--pixel'),
  panelSourceWidth: tokenNumber('--panel-source-width'),
  menuLeft: tokenNumber('--menu-left-units'),
  menuRight: tokenNumber('--menu-right-units'),
  menuTop: tokenNumber('--menu-top-units'),
  rollStepMs: tokenNumber('--roll-step-ms'),
  ribbonMs: tokenNumber('--ribbon-duration'),
  compactMs: tokenNumber('--compact-duration'),
  compactSettleMs: 20,
  mobileBreakpoint: 700,
  assets: Object.freeze({
    panel: new URL('../../site/sidebar/Banner.png', import.meta.url).href,
    pole: new URL('../../site/sidebar/Pole.png', import.meta.url).href,
    ribbon: new URL('../../site/sidebar/Ribbon.png', import.meta.url).href,
    separator: new URL('../../site/sidebar/Separator.png', import.meta.url).href
  })
});
// 2. DOM / STATE / CONTENT-DRIVEN GEOMETRY

const canvas = document.querySelector('#panel'),
  ctx = canvas.getContext('2d');
const pole = document.querySelector('#sidebar-pole');
const toggle = document.querySelector('#toggle');
const image = new Image();
const poleImage = new Image();
let poleFrame = 0;
let step = 0,
  busy = false,
  ready = false;
const sidebar = document.querySelector('#sidebar'),
  menuOverlay = document.querySelector('#menu-overlay'),
  menuList = document.querySelector('#menu-list');
let pixelScale = CONFIG.pixelScale;
let compact = true;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function layoutPixels() {
  const oldTotal = Number(canvas.dataset.total || 0),
    wasOpen = !ready || step === oldTotal;
  const oldStep = step;
  pixelScale = CONFIG.pixelScale;
  sidebar.style.setProperty('--pixel', `${pixelScale}px`);
  document.documentElement.style.setProperty('--pixel', `${pixelScale}px`);
  sidebar.dataset.pixelScale = String(pixelScale);
  // Two cloth tiles plus the original one-tile pole overhang.
  canvas.width = compact ? 48 : CONFIG.panelSourceWidth;
  // Measure the real menu, even while rolled up. Keep each source tile whole.
  const width = canvas.width * pixelScale;
  // Pole/brand footprint is independent of the two-tile compact cloth.
  pole.width = compact ? 96 : CONFIG.panelSourceWidth;
  document.documentElement.style.setProperty('--sidebar-expand-progress', String((pole.width - 96) / (CONFIG.panelSourceWidth - 96)));
  pole.style.width = `${pole.width * pixelScale}px`;
  pole.style.height = `${16 * pixelScale}px`;
  document.documentElement.style.setProperty('--sidebar-width', `${pole.width * pixelScale}px`);
  sidebar.style.width = `${pole.width * pixelScale}px`;
  sidebar.style.marginLeft = '0';
  menuOverlay.style.left = `${(compact ? 0 : CONFIG.menuLeft)*pixelScale}px`;
  menuOverlay.style.right = 'auto';
  menuOverlay.style.width = `${(compact ? 32 : canvas.width - CONFIG.menuLeft - CONFIG.menuRight)*pixelScale}px`;
  menuOverlay.style.top = `${CONFIG.menuTop*pixelScale}px`;
  menuOverlay.style.bottom = 'auto';
  const wasHidden = menuOverlay.hidden,
    oldVisibility = menuOverlay.style.visibility;
  menuOverlay.style.visibility = 'hidden';
  menuOverlay.hidden = false;
  const docs = menuList.querySelector('[data-menu="docs"]');
  const docsBottom = (docs.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top) / pixelScale;
  const menuEndRow = Math.ceil(docsBottom / 16);
  // After Docs: taper and bottom cap, with no extra empty body row.
  const taperExtraRows = compact ? 0 : (canvas.width / 16 - 4) / 2;
  const sourceHeight = (menuEndRow + 1 + taperExtraRows) * 16;
  sidebar.dataset.docsEndRow = String(Math.ceil(docsBottom / 16));
  sidebar.dataset.contentEndRow = String(menuEndRow);
  sidebar.dataset.emptyRows = '0';
  menuOverlay.hidden = wasHidden;
  menuOverlay.style.visibility = oldVisibility;
  if (canvas.height !== sourceHeight) canvas.height = sourceHeight;
  const height = canvas.height * pixelScale;
  sidebar.style.height = `${height}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (ready) {
    draw(wasOpen ? total() : Math.min(oldStep, total()));
    refreshRibbons();
  }
}
// 3. MENU / RIBBON / SEPARATOR
// Menu order also indexes the 12 source tiles in Icons.png. Keep them in sync.
const menuItems = ['Shell', 'Mining', 'Battle', 'Dojo', 'Breeding', 'Evolve', 'Repair', 'Teams', 'Market', 'Activity', 'Ranks', 'Docs'];
let selectedMenu = initialLabel;
const ribbonImage = new Image();
let ribbonReady = false,
  ribbonToken = 0;
const ribbonLevels = new Map(),
  ribbonCanvases = new Map();
// Cubic ease-in-out for raster step/ribbon progression.
const ribbonEase = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function paintRibbon(label, amount) {
  ribbonLevels.set(label, amount);
  const c = ribbonCanvases.get(label);
  if (!c || !ribbonReady) return;
  const button = c.parentElement;
  // Logical raster pixels always render at the SAME integer scale as panel/icons.
  // A narrow menu clips a natural-sized ribbon instead of squeezing its pixels.
  // Extend to the canvas's left edge, beyond the banner's inset wooden edge.
  // Keep the previous right edge INSIDE the menu/banner instead of stretching
  // outward on both sides. Text/icon positions remain unchanged.
  const leftExtension = Math.max(0, Math.round(button.getBoundingClientRect().left - sidebar.getBoundingClientRect().left));
  c.style.left = `${-leftExtension}px`;
  c.width = Math.max(1, Math.floor((button.clientWidth + leftExtension) / pixelScale));
  c.height = 16;
  c.style.width = `${c.width*pixelScale}px`;
  c.style.height = `${16*pixelScale}px`;
  const r = c.getContext('2d');
  r.imageSmoothingEnabled = false;
  r.clearRect(0, 0, c.width, 16);
  if (amount <= 0) return;
  const length = Math.max(1, Math.round(c.width * amount));
  if (length >= 48) {
    r.drawImage(ribbonImage, 0, 0, 16, 16, 0, 0, 16, 16);
    // Fixed endcaps; only center tile is repeated. Canvas clipping preserves
    // the endcap without stretching a texture or resizing the original PNG.
    r.save();
    r.beginPath();
    r.rect(16, 0, length - 32, 16);
    r.clip();
    for (let x = 16; x < length - 16; x += 16) r.drawImage(ribbonImage, 16, 0, 16, 16, x, 0, 16, 16);
    r.restore();
    r.drawImage(ribbonImage, 32, 0, 16, 16, length - 16, 0, 16, 16);
  } else {
    const lengths = [48, 40, 32, 24, 16, 9, 5];
    let frame = 0;
    for (let i = 1; i < lengths.length; i++)
      if (Math.abs(lengths[i] - length) < Math.abs(lengths[frame] - length)) frame = i;
    for (let col = 0; col < 3; col++) r.drawImage(ribbonImage, frame * 48 + col * 16, 0, 16, 16, col * 16, 0, 16, 16);
  }
}

function tweenRibbon(label, to, token) {
  const from = ribbonLevels.get(label) || 0,
    duration = reducedMotion() ? 0 : CONFIG.ribbonMs;
  return new Promise(resolve => {
    let start;

    function tick(now) {
      if (token !== ribbonToken) {
        resolve(false);
        return;
      }
      if (start === undefined) start = now;
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      paintRibbon(label, from + (to - from) * ribbonEase(t));
      if (t < 1) requestAnimationFrame(tick);
      else resolve(true);
    }
    requestAnimationFrame(tick);
  });
}
async function selectMenu(label) {
  if (selectedMenu === label) return;
  selectedMenu = label;
  onNavigate(label);
  const token = ++ribbonToken;
  // Rapid clicks cancel old tweens; shrink all visible ribbons before new one.
  const visible = [...ribbonLevels].filter(([, level]) => level > 0).map(([name]) => name);
  await Promise.all(visible.map(name => tweenRibbon(name, 0, token)));
  if (token !== ribbonToken) return;
  menuList.querySelectorAll('button').forEach(b => {
    if (b.dataset.menu === label.toLowerCase()) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // Route notification is emitted before the existing ribbon transition.
  await tweenRibbon(label, 1, token);
}
const separatorImage = new Image();

function paintSeparator() {
  const c = document.querySelector('.menu-separator canvas');
  if (!c || !separatorImage.complete || separatorImage.naturalWidth !== 48) return;
  // Compact joins the two end tiles directly; expanded retains its tiled center.
  const cols = compact ? 2 : Math.max(3, Math.floor(c.parentElement.clientWidth / (16 * pixelScale)) + 1);
  c.width = cols * 16;
  c.height = 16;
  c.style.width = `${c.width*pixelScale}px`;
  c.style.height = `${16*pixelScale}px`;
  const r = c.getContext('2d');
  r.imageSmoothingEnabled = false;
  for (let col = 0; col < cols; col++) r.drawImage(separatorImage, (col === 0 ? 0 : col === cols - 1 ? 2 : 1) * 16, 0, 16, 16, col * 16, 0, 16, 16);
}
separatorImage.onload = paintSeparator;
separatorImage.src = CONFIG.assets.separator;
menuItems.forEach((label, index) => {
  // Battle opens from Shell; retain source icon indices for other menu items.
  if (label === 'Battle') return;
  if (label === 'Activity') {
    const separator = document.createElement('li');
    separator.className = 'menu-separator';
    separator.setAttribute('role', 'separator');
    const art = document.createElement('canvas');
    art.setAttribute('aria-hidden', 'true');
    separator.append(art);
    menuList.append(separator);
  }
  const li = document.createElement('li');
  li.dataset.menu = label.toLowerCase();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-item';
  button.dataset.menu = label.toLowerCase();
  button.setAttribute('aria-label', label);
  button.title = label;
  if (label === selectedMenu) button.setAttribute('aria-current', 'page');
  const icon = document.createElement('span');
  icon.className = 'menu-icon';
  icon.style.setProperty('--icon', index);
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'menu-label';
  text.textContent = label;
  const ribbon = document.createElement('canvas');
  ribbon.className = 'active-ribbon';
  ribbon.setAttribute('aria-hidden', 'true');
  ribbon.width = 48;
  ribbon.height = 16;
  ribbonCanvases.set(label, ribbon);
  ribbonLevels.set(label, label === selectedMenu ? 1 : 0);
  button.append(ribbon, icon, text);
  button.addEventListener('click', () => selectMenu(label));
  li.append(button);
  menuList.append(li);
});

function refreshRibbons() {
  if (ribbonReady && !menuOverlay.hidden)
    for (const [label, level] of ribbonLevels) paintRibbon(label, level);
}
new ResizeObserver(refreshRibbons).observe(menuList);
ribbonImage.onload = () => {
  if (ribbonImage.naturalWidth !== 336 || ribbonImage.naturalHeight !== 16) {
    console.error('Ribbon.png must remain 336×16; update slicing if sheet changes.');
    return;
  }
  ribbonReady = true;
  refreshRibbons();
};
ribbonImage.onerror = () => {
  console.error('Ribbon.png failed to load. Check the asset path.');
};
ribbonImage.src = CONFIG.assets.ribbon;

function syncMenu() {
  const visible = ready && step > 0;
  const interactive = visible && !busy;
  if (!interactive && menuOverlay.contains(document.activeElement)) toggle.focus();
  // Keep the menu layer while rolling; hide each row only when the roll
  // reaches it. Visibility (not display) preserves all positions and spacing.
  menuOverlay.hidden = !visible;
  menuOverlay.inert = !interactive;
  if (visible) {
    const rollEdge = sidebar.getBoundingClientRect().top + Number(canvas.dataset.rollY) * pixelScale;
    for (const row of menuList.children) {
      const revealed = step === total() || row.getBoundingClientRect().bottom <= rollEdge;
      row.style.visibility = revealed ? 'visible' : 'hidden';
      row.setAttribute('aria-hidden', String(!revealed));
      row.inert = !revealed || busy;
    }
    refreshRibbons();
    paintSeparator();
  }
}
// 4. TILE RENDERER
// Every crop/destination uses the original 16×16 tile grid.
// Banner.png: five 48px-wide poses at x=0/64/128/192/256 (16px gutters).
// Open pose cap is y=48, rolling caps y=16/32. Gutters are not frame pixels.
// Extra diagonal pairs use y=64 (two tiles per side, never replace inner seams).
// Preserve transparent padding: never crop to the visible artwork bounds.
const TILE = 16;
const BANNER_POSE_X = [0, 64, 128, 192, 256];
const tileRows = () => canvas.height / TILE;
// Closed -> fixed roll travels down -> one partial pose -> fully open.
// Reverse to close: the two long-panel poses occur ONCE, at full length.
const total = () => tileRows() + 1;

function tile(pose, sourceCol, sourceRow, destRow, destCol) {
  ctx.drawImage(image, BANNER_POSE_X[pose] + sourceCol * TILE, sourceRow * TILE, TILE, TILE, destCol * TILE, destRow * TILE, TILE, TILE);
}

// Pole.png: four 64×16 poses. Repeat only tile #2, retaining both right tiles.
function drawPole() {
  const p = pole.getContext('2d');
  p.imageSmoothingEnabled = false;
  p.clearRect(0, 0, pole.width, pole.height);
  const sourceX = poleFrame * 64;
  p.drawImage(poleImage, sourceX, 0, TILE, TILE, 0, 0, TILE, TILE);
  // Clip the last repeated middle tile; both right tiles stay source-sized.
  const rightStart = pole.width - 2 * TILE;
  for (let x = TILE; x < rightStart; x += TILE) {
    const width = Math.min(TILE, rightStart - x);
    p.drawImage(poleImage, sourceX + TILE, 0, width, TILE, x, 0, width, TILE);
  }
  p.drawImage(poleImage, sourceX + 2 * TILE, 0, 2 * TILE, TILE, rightStart, 0, 2 * TILE, TILE);
  pole.dataset.frame = String(poleFrame);
}

function tileRow(pose, sourceRow, destRow, inset = 0) {
  // The canvas keeps its approved transparent overhang; cloth ends one tile earlier.
  const columns = canvas.width / TILE - 1 - 2 * inset;
  for (let col = 0; col < columns; col++) {
    const sourceCol = col === 0 ? 0 : col === columns - 1 ? 2 : 1;
    tile(pose, sourceCol, sourceRow, destRow, col + inset);
  }
}
// Extra sheet row supplies diagonal EDGES, not a complete footer image.
// Two inward steps leave three cloth tiles for the original flat-ended cap:
// its two corner tiles converge on one central, horizontal tile.
const taperDepth = () => Math.max(0, (canvas.width / TILE - 4) / 2);
const taperStart = () => tileRows() - 1 - taperDepth();

function taperRow(destRow, inset) {
  const rightCol = canvas.width / TILE - 2 - inset;
  // Each diagonal border spans TWO source tiles, including its inner seam.
  // Repeat plain fill only BETWEEN these edge pairs, never over the seam.
  for (let col = inset; col <= rightCol; col++) {
    const sourceCol = col === inset ? 0 : col === inset + 1 ? 1 : col === rightCol - 1 ? 2 : col === rightCol ? 3 : null;
    if (sourceCol === null) tile(0, 1, 1, destRow, col);
    else ctx.drawImage(image, sourceCol * TILE, 64, TILE, TILE, col * TILE, destRow * TILE, TILE, TILE);
  }
}

// Narrow composition omits the middle cloth tile, preserving both edges.
// The final canvas tile stays transparent; the pole is a separate image/layer.
function compactRow(pose, sourceRow, destRow) {
  [0, 2].forEach((sourceCol, destCol) => tile(pose, sourceCol, sourceRow, destRow, destCol));
}
function drawCompact() {
  const lastRow = tileRows() - 1;
  const frontRow = Math.min(step, lastRow);
  const pose = step === 0 ? 4 : step === 1 ? 3 : step <= lastRow ? 2 : step === lastRow + 1 ? 1 : 0;
  if (!step) compactRow(4, 0, 0);
  else {
    const bodyPose = pose === 1 ? 1 : 0;
    compactRow(bodyPose, 0, 0);
    for (let row = 1; row < frontRow; row++) compactRow(bodyPose, 1, row);
    compactRow(pose, pose === 0 ? 3 : pose === 3 ? 1 : 2, frontRow);
  }
  return { frontRow, pose };
}

function draw(n) {
  step = Math.max(0, Math.min(total(), Math.round(n)));
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPole();
  let frontRow = 0,
    pose = 4;
  if (compact) {
    ({ frontRow, pose } = drawCompact());
  } else if (step === 0) {
    tileRow(4, 0, 0);
  } else {
    const lastRow = tileRows() - 1;
    frontRow = Math.min(step, lastRow);
    // Pose 3's entire bottom tile row is the SAME cap at every travel step.
    // Poses 2 and 1 are only used after reaching full length, never per row.
    pose = step === 1 ? 3 : step <= lastRow ? 2 : step === lastRow + 1 ? 1 : 0;
    const bodyPose = pose === 1 ? 1 : 0;
    tileRow(bodyPose, 0, 0);
    for (let row = 1; row < frontRow; row++) {
      if (row >= taperStart()) taperRow(row, row - taperStart());
      else tileRow(bodyPose, 1, row);
    }
    const inset = Math.max(0, frontRow - taperStart());
    // Open pose's ornamented cap is at y=48; y=32 is a straight body row.
    // Rolling poses still use their original y=16 / y=32 cap rows.
    tileRow(pose, pose === 0 ? 3 : pose === 3 ? 1 : 2, frontRow, inset);
  }
  const label = step === 0 ? 'Tergulung' : step === total() ? 'Terbuka' : busy ? 'Animasi per tile' : 'Posisi manual';
  canvas.dataset.step = String(step);
  canvas.dataset.rollY = String(frontRow * TILE);
  canvas.dataset.total = String(total());
  canvas.dataset.pose = String(pose);
  canvas.setAttribute('aria-label', label);
  toggle.setAttribute('aria-label', compact ? 'Expand sidebar' : 'Collapse sidebar');
  toggle.setAttribute('aria-expanded', String(!compact));
  syncMenu();
}
// 5. MOTION SEQUENCING / INPUT
// Roll current width fully up, switch at the pole, then unroll the new width.
// Lock input throughout; menu visibility follows the roll edge, not separate timers.
function lock(value) {
  busy = value;
  toggle.disabled = value;
  syncMenu();
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function animatePole() {
  // Always left-to-right on either toggle. End on the artist's final rest pose
  // (frame 3 differs from frame 0 by one pixel); never reverse or reset the art.
  poleFrame = reducedMotion() ? 3 : 0;
  drawPole();
  if (reducedMotion()) return;
  const frameMs = total() * CONFIG.rollStepMs / 4;
  for (let frame = 1; frame < 4; frame++) {
    await wait(frameMs);
    poleFrame = frame;
    drawPole();
  }
}
const brandTrigger = document.querySelector('.brand-trigger');
brandTrigger.addEventListener('click', () => toggle.click());
async function animateTo(target) {
  const startStep = step,
    distance = Math.abs(target - startStep);
  if (!distance) return;
  if (reducedMotion()) { draw(target); return; }
  const duration = distance * CONFIG.rollStepMs;
  // Ease the existing whole-tile sequence; do not scale/morph the artwork.
  await new Promise(resolve => {
    let start;

    function tick(now) {
      if (start === undefined) start = now;
      const t = Math.min(1, (now - start) / duration);
      const next = Math.round(startStep + (target - startStep) * ribbonEase(t));
      if (next !== step) draw(next);
      if (t < 1) requestAnimationFrame(tick);
      else {
        draw(target);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}
async function resizePole(target) {
  const from = pole.width;
  const duration = reducedMotion() ? 0 : CONFIG.compactMs;
  pole.dataset.resizing = 'true';
  await new Promise(resolve => {
    let start;
    function tick(now) {
      if (start === undefined) start = now;
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      // One source pixel per snap = 3 CSS px. Never scale a rendered canvas.
      const width = Math.round(from + (target - from) * ribbonEase(t));
      if (pole.width !== width) {
        pole.width = width;
        document.documentElement.style.setProperty('--sidebar-expand-progress', String((width - 96) / (CONFIG.panelSourceWidth - 96)));
        pole.style.width = `${width * pixelScale}px`;
        document.documentElement.style.setProperty('--sidebar-width', `${width * pixelScale}px`);
        sidebar.style.width = `${width * pixelScale}px`;
        drawPole();
      }
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
  pole.dataset.resizing = 'false';
}
async function changeWidth() {
  sidebar.dataset.phase = 'rolling-up';
  await animateTo(0);
  // Keep one painted fully rolled frame before changing width.
  sidebar.dataset.phase = 'rolled';
  if (!reducedMotion()) await wait(CONFIG.rollStepMs);
  const previousPoleWidth = pole.width;
  compact = !compact;
  document.body.classList.toggle('sidebar-compact', compact);
  sidebar.dataset.mode = compact ? 'compact' : 'expanded';
  brandTrigger.tabIndex = -1;
  layoutPixels();
  draw(0);
  // Cloth switches width immediately; pole keeps its old length until its tween.
  const targetPoleWidth = pole.width;
  pole.width = previousPoleWidth;
  document.documentElement.style.setProperty('--sidebar-expand-progress', String((previousPoleWidth - 96) / (CONFIG.panelSourceWidth - 96)));
  pole.style.width = `${previousPoleWidth * pixelScale}px`;
  document.documentElement.style.setProperty('--sidebar-width', `${previousPoleWidth * pixelScale}px`);
  sidebar.style.width = `${previousPoleWidth * pixelScale}px`;
  drawPole();
  sidebar.dataset.phase = 'unrolling';
  await Promise.all([resizePole(targetPoleWidth), animateTo(total())]);
  sidebar.dataset.phase = 'idle';
}
async function run(action) {
  if (busy || !ready) return;
  const restorePoleFocus = document.activeElement === toggle;
  lock(true);
  try {
    await action();
  } finally {
    lock(false);
    draw(step);
    layoutPixels();
    if (restorePoleFocus) toggle.focus({
      preventScroll: true
    });
  }
}
toggle.addEventListener('click', () => run(() => Promise.all([animatePole(), changeWidth()])));
window.addEventListener('resize', () => {
  if (busy) return;
  layoutPixels();
});
async function loadSidebar() {
  const load = (img, src, width, height, name) => new Promise((resolve, reject) => {
    img.onload = () => img.naturalWidth === width && img.naturalHeight === height
      ? resolve() : reject(new Error(`${name} must remain ${width}×${height}; update slicing if sheet changes.`));
    img.onerror = () => reject(new Error(`${name} failed to load. Check the asset path.`));
    img.src = src;
  });
  await Promise.all([
    load(image, CONFIG.assets.panel, 304, 96, 'Banner.png'),
    load(poleImage, CONFIG.assets.pole, 256, 16, 'Pole.png')
  ]);
  // First load / reload opens the original expanded banner.
  // Wait for font metrics before measuring Docs and allocating whole tile rows.
  await document.fonts.ready;
  ready = true;
  document.body.classList.toggle('sidebar-compact', compact);
  sidebar.dataset.mode = compact ? 'compact' : 'expanded';
  layoutPixels();
  draw(0);
  await run(async () => {
    // Two frames ensure the initial rolled pose paints before unrolling.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await animateTo(total());
    sidebar.dataset.phase = 'idle';
  });
}
loadSidebar().catch(error => console.error(error));

// 6. MOBILE DRAWER (independent of the banner roll state)
const mobileMenu = document.querySelector('#mobile-menu'),
  scrim = document.querySelector('#scrim');

function setDrawer(open) {
  document.body.classList.toggle('drawer-open', open);
  mobileMenu.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
}
mobileMenu.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
scrim.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') setDrawer(false);
});
menuList.addEventListener('click', e => {
  if (e.target.closest('.menu-item') && innerWidth < CONFIG.mobileBreakpoint) setDrawer(false);
});
// 7. WALLET / PROFILE — local presentation only; no wallet provider calls.
// Avatar click: 360deg clockwise + retract; second click reverses both.
const USER_MOTION = Object.freeze({ durationMs: 450, openWidth: 96, rightEdge: 128 });
const userSectionImage = new Image();
const userArt = document.querySelector('#user-section-art');
const userWheel = document.querySelector('#user-avatar-frame');
const userAvatar = document.querySelector('.user-avatar-slot');
const connectWallet = document.querySelector('.connect-wallet');
let userOpen = true, userBusy = false;
function paintUserPanel(amount) {
  const paint = userArt.getContext('2d');
  paint.imageSmoothingEnabled = false;
  paint.clearRect(0, 0, userArt.width, userArt.height);
  const width = Math.round(USER_MOTION.openWidth * amount);
  const left = USER_MOTION.rightEdge - width;
  if (width > 0) {
    // Fixed caps + repeated middle, clipped at the retracting edge, never stretched.
    paint.save();
    paint.beginPath();paint.rect(left, 16, width, 32);paint.clip();
    paint.drawImage(userSectionImage, 0, 0, 16, 32, left, 16, 16, 32);
    for (let x = left + 16; x < USER_MOTION.rightEdge - 16; x += 16) {
      paint.drawImage(userSectionImage, 16, 0, 16, 32, x, 16, 16, 32);
    }
    paint.drawImage(userSectionImage, 32, 0, 16, 32, USER_MOTION.rightEdge - 16, 16, 16, 32);
    paint.restore();
  }
  // Text fades/slides on the same progress as the plank: no independent timers.
  // Reveal only once 55% open, reaching full opacity at the open endpoint.
  const textProgress = ribbonEase(Math.max(0, Math.min(1, (amount - 0.55) / 0.45)));
  connectWallet.style.opacity = String(textProgress);
  connectWallet.style.transform = `translateX(${12 * (1 - textProgress)}px)`;
  // Keep the existing edge mask so text never floats beyond the wooden backing.
  connectWallet.style.clipPath = `inset(0 0 0 ${Math.max(0, Math.min(68, left - 40)) * CONFIG.pixelScale}px)`;
  connectWallet.style.visibility = width ? 'visible' : 'hidden';
  userArt.dataset.amount = String(amount);
}
async function toggleUserPanel() {
  if (userBusy || userArt.dataset.ready !== 'true') return;
  const restoreAvatarFocus = document.activeElement === userAvatar;
  closeProfileMenu();
  userBusy = true;userAvatar.disabled = true;connectWallet.inert = true;
  const closing = userOpen;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : USER_MOTION.durationMs;
  await new Promise(resolve => {
    let start;
    function tick(now) {
      if (start === undefined) start = now;
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = ribbonEase(t);
      const amount = closing ? 1 - eased : eased;
      paintUserPanel(amount);
      const degrees = closing ? eased * 360 : (1 - eased) * 360;
      userWheel.style.transform = `rotate(${degrees}deg)`;
      userWheel.dataset.degrees = String(degrees);
      if (t < 1) requestAnimationFrame(tick);else resolve();
    }
    requestAnimationFrame(tick);
  });
  userOpen = !closing;
  userAvatar.setAttribute('aria-expanded', String(userOpen));
  userAvatar.setAttribute('aria-label', userOpen ? 'Collapse wallet panel' : 'Expand wallet panel');
  connectWallet.inert = !userOpen;
  userBusy = false;userAvatar.disabled = false;
  if (restoreAvatarFocus) userAvatar.focus({ preventScroll: true });
}
userAvatar.addEventListener('click', toggleUserPanel);
userSectionImage.onload = async () => {
  if (userSectionImage.naturalWidth !== 112 || userSectionImage.naturalHeight !== 80) {
    console.error('Wooden-panel.png must remain 112×80; review slicing if changed.');return;
  }
  const wheelPaint = userWheel.getContext('2d');
  wheelPaint.imageSmoothingEnabled = false;
  wheelPaint.drawImage(userSectionImage, 48, 0, 64, 64, 0, 0, 64, 64);
  // First load / reload: paint closed before replaying the normal open motion.
  userOpen = false;
  userAvatar.setAttribute('aria-expanded', 'false');
  userAvatar.setAttribute('aria-label', 'Expand wallet panel');
  connectWallet.inert = true;
  userWheel.style.transform = 'rotate(360deg)';
  userWheel.dataset.degrees = '360';
  paintUserPanel(0);
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  userArt.dataset.ready = 'true';
  await toggleUserPanel();
};
userSectionImage.onerror = () => console.error('Wooden-panel.png failed to load.');
userSectionImage.src = new URL('../../site/User Section/Wooden-panel.png', import.meta.url).href;
// 8. MUSIC TOGGLE — presentation state only until an audio source is supplied.
// Integration: listen for music-toggle and set the music player's muted state.
const musicToggle = document.querySelector('.music-toggle');
musicToggle.addEventListener('click', () => {
  const enabled = musicToggle.getAttribute('aria-pressed') !== 'true';
  musicToggle.setAttribute('aria-pressed', String(enabled));
  musicToggle.setAttribute('aria-label', enabled ? 'Turn music off' : 'Turn music on');
  musicToggle.title = enabled ? 'Music on' : 'Music off';
  musicToggle.dispatchEvent(new CustomEvent('music-toggle', { bubbles: true, detail: { enabled } }));
});
// 9. PROFILE ACTIONS / DEMO ADAPTER
// Integration boundaries:
// - Replace the demo connection delay with the wallet provider's promise.
// - Populate previewProfile from application state; persist edits outside this file.
// - Disconnect below only resets local preview state, not a real wallet session.
// - Sprite drawing works under file://: never export these canvases to data URLs.
const PROFILE_CONFIG = Object.freeze({
  buttonAsset: new URL('../../site/User Section/Button.png', import.meta.url).href,
  sheetWidth: 64,
  sheetHeight: 16,
  tileSize: 16,
  capWidth: 5,
  leftCapX: 11,
  middleX: 16,
  rightCapX: 32,
  demoDelayMs: 1500,
});
const profileMenu = document.querySelector('#profile-menu');
const profileEditor = document.querySelector('#profile-editor');
const profileName = document.querySelector('#profile-name');
const previewProfile = { connected: false, name: '', addressLabel: 'Demo…7K2p' };
let profileMenuOpen = false;
let profileMenuAnimation = null;
const PROFILE_MENU_MOTION = Object.freeze({ duration: 180, distance: 12 });
function setProfileMenu(open) {
  if (profileMenuOpen === open) return;
  profileMenuOpen = open;
  const current = getComputedStyle(profileMenu);
  const from = profileMenu.hidden
    ? { transform: `translateY(-${PROFILE_MENU_MOTION.distance}px)` }
    : { transform: current.transform };
  profileMenuAnimation?.cancel();
  profileMenu.hidden = false;
  profileMenu.inert = !open;
  connectWallet.setAttribute('aria-expanded', String(open));
  const animation = profileMenu.animate([from, {
    transform: `translateY(${open ? 0 : -PROFILE_MENU_MOTION.distance}px)`
  }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : PROFILE_MENU_MOTION.duration,
    easing: 'ease-in-out', fill: 'forwards' });
  profileMenuAnimation = animation;
  animation.onfinish = () => {
    if (profileMenuAnimation !== animation) return;
    profileMenu.hidden = !open;
    animation.cancel();profileMenuAnimation = null;
  };
  if (open) profileMenu.querySelector('button').focus({ preventScroll: true });
}
function closeProfileMenu(restoreFocus = false) {
  setProfileMenu(false);
  if (restoreFocus) connectWallet.focus();
}
function refreshPreviewProfile() {
  connectWallet.textContent = previewProfile.connected ? (previewProfile.name || previewProfile.addressLabel) : 'Connect Wallet';
  connectWallet.title = previewProfile.connected ? 'Simulated wallet — ' + (previewProfile.name || previewProfile.addressLabel) : 'Connect Wallet (demo only)';
  if (previewProfile.connected) {
    connectWallet.setAttribute('aria-expanded', 'false');
    connectWallet.setAttribute('aria-controls', 'profile-menu');
  } else {
    connectWallet.removeAttribute('aria-expanded');
    connectWallet.removeAttribute('aria-controls');
  }
}
// Content-sized expansion measured with the loaded font, rounded to the 3px grid.
function sizeProfileActions() {
  const ctx = document.createElement('canvas').getContext('2d');
  profileMenu.querySelectorAll('button').forEach(button => {
    const style = getComputedStyle(button);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const textWidth = ctx.measureText(button.querySelector('.profile-action-label').textContent).width;
    const iconWidth = parseFloat(getComputedStyle(button.querySelector('.profile-action-icon')).width);
    const contentWidth = iconWidth + parseFloat(style.getPropertyValue('--action-label-gap')) + textWidth
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const width = Math.ceil(contentWidth / CONFIG.pixelScale) * CONFIG.pixelScale;
    button.style.setProperty('--action-open-width', `${width}px`);
  });
}
sizeProfileActions();
document.fonts.ready.then(sizeProfileActions);
document.fonts.addEventListener('loadingdone', sizeProfileActions);
// Draw button art directly, repeating pixels instead of stretching during expansion.
const profileButtonImage = new Image();
function paintProfileButton(button) {
  if (!profileButtonImage.complete || profileButtonImage.naturalWidth !== PROFILE_CONFIG.sheetWidth
      || profileButtonImage.naturalHeight !== PROFILE_CONFIG.sheetHeight) return;
  let art = button.querySelector('canvas');
  if (!art) { art = document.createElement('canvas');art.setAttribute('aria-hidden', 'true');button.prepend(art); }
  art.width = Math.ceil(button.getBoundingClientRect().width / CONFIG.pixelScale);
  art.height = PROFILE_CONFIG.sheetHeight;
  art.style.width = `${art.width * CONFIG.pixelScale}px`;
  const ctx = art.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const { capWidth, sheetHeight, tileSize, leftCapX, middleX, rightCapX } = PROFILE_CONFIG;
  ctx.drawImage(profileButtonImage, leftCapX, 0, capWidth, sheetHeight,
    0, 0, capWidth, sheetHeight);
  for (let x = capWidth; x < art.width - capWidth; x += tileSize) {
    const width = Math.min(tileSize, art.width - capWidth - x);
    ctx.drawImage(profileButtonImage, middleX, 0, width, sheetHeight,
      x, 0, width, sheetHeight);
  }
  ctx.drawImage(profileButtonImage, rightCapX, 0, capWidth, sheetHeight,
    art.width - capWidth, 0, capWidth, sheetHeight);
}
const profileButtonResize = new ResizeObserver(entries => entries.forEach(({target}) => {
  if (target.getBoundingClientRect().width) paintProfileButton(target);
}));
profileMenu.querySelectorAll('button').forEach(button => profileButtonResize.observe(button));
profileButtonImage.onload = () => profileMenu.querySelectorAll('button').forEach(button => {
  if (button.getBoundingClientRect().width) paintProfileButton(button);
});
profileButtonImage.onerror = () => console.error('Button.png failed to load');
profileButtonImage.src = PROFILE_CONFIG.buttonAsset;
let walletConnecting = false;
// Preview delay only. Production must await the wallet provider, not this timer.
// Keep this adapter separate from menu rendering and sprite geometry.
connectWallet.addEventListener('click', async () => {
  if (userBusy || !userOpen || walletConnecting) return;
  if (!previewProfile.connected) {
    walletConnecting = true;
    connectWallet.disabled = true;
    connectWallet.setAttribute('aria-busy', 'true');
    connectWallet.setAttribute('aria-label', 'Connecting wallet (demo)');
    connectWallet.title = 'Connecting wallet (demo only)';
    const loader = document.createElement('span');
    loader.className = 'wallet-loader';loader.setAttribute('aria-hidden', 'true');
    connectWallet.replaceChildren(loader);
    try {
      await new Promise(resolve => setTimeout(resolve, PROFILE_CONFIG.demoDelayMs));
      previewProfile.connected = true;
    } finally {
      walletConnecting = false;
      connectWallet.disabled = false;
      connectWallet.removeAttribute('aria-busy');
      connectWallet.removeAttribute('aria-label');
      refreshPreviewProfile();
    }
    return;
  }
  setProfileMenu(!profileMenuOpen);
});
profileMenu.addEventListener('click', e => {
  const action = e.target.closest('[data-profile-action]')?.dataset.profileAction;
  if (!action) return;
  closeProfileMenu();
  if (action === 'disconnect') {
    previewProfile.connected = false;previewProfile.name = '';refreshPreviewProfile();connectWallet.focus();
  } else {
    profileName.value = previewProfile.name;profileEditor.showModal();profileName.focus();
  }
});
document.querySelector('#profile-form').addEventListener('submit', e => {
  e.preventDefault();previewProfile.name = profileName.value.trim();refreshPreviewProfile();profileEditor.close();
});
document.querySelector('#profile-cancel').addEventListener('click', () => profileEditor.close());
profileEditor.addEventListener('close', () => connectWallet.focus());
document.addEventListener('pointerdown', e => {
  if (!profileMenu.contains(e.target) && !connectWallet.contains(e.target)) closeProfileMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !profileMenu.hidden) { e.preventDefault();closeProfileMenu(true); }
});
refreshPreviewProfile();

return { selectMenu };
}
