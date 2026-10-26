/**
 * The rolling pixel sidebar — Nzib's reference logic (design/website/workbench/components/shell.js §1–5, baseline
 * 3295433, 2026-10-11) ported as a class bound to the React-rendered DOM of `pixel-sidebar.tsx`. The behaviour
 * is his, unchanged:
 *   - two widths. COMPACT (the start state, every reload) is a two-tile cloth with icons only on a 96 px pole;
 *     EXPANDED is the full 128 px banner with labels. The pole is the toggle, over its whole length;
 *   - a toggle rolls the current banner fully up over discrete tile poses (20 ms per step, cubic ease-in-out),
 *     holds one rolled frame, switches width, then unrolls the other banner while the pole tweens its length
 *     (250 ms, one source pixel per snap) and plays its four poses 0→3 (always forward, resting on frame 3);
 *   - Pole.png (256×16) is four 64×16 poses: tile 0 once, tile 1 repeated, both right tiles kept. Banner.png
 *     (304×96) is five 48 px poses at x 0/64/128/192/256 (16 px gutters are not frame pixels); the taper art
 *     sits below pose 0 at y 64; the canvas keeps one transparent overhang tile on the right;
 *   - rows reveal top-down and disappear bottom-up as the rolling edge passes them; the selection ribbon
 *     retracts the old selection and extends the new one (250 ms each); rapid changes cancel older tweens;
 *   - the logo rides `--sidebar-expand-progress` (the same frame progress as the pole length), so it moves
 *     with the pole, not on its own timer.
 * The engine owns what React does not render: the body's `sidebar-compact` class, `aria-current` on the menu
 * items, `hidden`/`inert` on the overlay and rows, the canvases, the sizing styles and the CSS variables
 * `--sidebar-width` / `--sidebar-expand-progress`. React owns the markup and the links; a route change calls
 * `select`. Our one deviation from the reference: the shell is a scroll container on short viewports (#206),
 * scrolled home whenever the banner rolls up.
 */

export interface SidebarRollElements {
  /** The sizing wrapper (`.sidebar-preview`). */
  sidebar: HTMLElement;
  /** The fixed shell around it (`.sidebar-shell`): the scroll container on short viewports. */
  scroller?: HTMLElement;
  /** The banner canvas. */
  canvas: HTMLCanvasElement;
  /** The pole canvas (drawn independently of the cloth; sets the content footprint). */
  pole: HTMLCanvasElement;
  /** The pole hit target (the only toggle). */
  toggle: HTMLButtonElement;
  menuOverlay: HTMLElement;
  /** The `<ul>`: one `<li data-menu>` per item (+ the separator `<li>`), each item holding `canvas.active-ribbon[data-ribbon]`. */
  menuList: HTMLElement;
}

export interface SidebarRollOptions {
  assets: { banner: string; pole: string; ribbon: string; separator: string };
  /** The label selected on first paint (its ribbon starts extended). */
  initialSelection: string | null;
}

import { applyChromePixelScale } from '@/components/pixel/pixel-assets';

const TILE = 16;
const BANNER_SHEET = { width: 304, height: 96 };
const POLE_SHEET = { width: 256, height: 16 };
const RIBBON_SHEET = { width: 336, height: 16 };
/** Five 48 px-wide banner poses, 16 px gutters between them. */
const BANNER_POSE_X = [0, 64, 128, 192, 256];
/** Source px of the pole in each mode; the cloth is two tiles (plus the overhang) when compact. */
const POLE_COMPACT = 96;
const CLOTH_COMPACT = 48;

/** Cubic ease-in-out for raster step/ribbon progression. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class SidebarRoll {
  private readonly els: SidebarRollElements;
  private readonly assets: SidebarRollOptions['assets'];
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cfg: {
    pixelScale: number; panelSourceWidth: number; menuLeft: number; menuRight: number; menuTop: number;
    rollStepMs: number; ribbonMs: number; compactMs: number;
  };
  private readonly image = new Image();
  private readonly poleImage = new Image();
  private readonly ribbonImage = new Image();
  private readonly separatorImage = new Image();
  private readonly ribbonLevels = new Map<string, number>();
  private readonly ribbonCanvases = new Map<string, HTMLCanvasElement>();
  private readonly resizeObserver: ResizeObserver;
  private compact = true;
  private poleFrame = 0;
  private step = 0;
  private busy = false;
  private ready = false;
  private destroyed = false;
  private pixelScale: number;
  private selectedMenu: string | null;
  private ribbonReady = false;
  private ribbonToken = 0;

  constructor(els: SidebarRollElements, opts: SidebarRollOptions) {
    this.els = els;
    this.assets = opts.assets;
    const ctx = els.canvas.getContext('2d');
    if (!ctx) throw new Error('SidebarRoll: no 2d context');
    this.ctx = ctx;
    // 1. SETTINGS — the CSS tokens on :root (chrome.css); read once, source geometry stays on 16 px tiles.
    const tokens = getComputedStyle(document.documentElement);
    const num = (name: string) => parseFloat(tokens.getPropertyValue(name));
    this.cfg = {
      pixelScale: applyChromePixelScale(),   // 3× or 2× by window size (pixel-assets.ts), re-chosen on every resize
      panelSourceWidth: num('--panel-source-width'),
      menuLeft: num('--menu-left-units'),
      menuRight: num('--menu-right-units'),
      menuTop: num('--menu-top-units'),
      rollStepMs: num('--roll-step-ms'),
      ribbonMs: num('--ribbon-duration'),
      compactMs: num('--compact-duration'),
    };
    this.pixelScale = this.cfg.pixelScale;
    this.selectedMenu = opts.initialSelection;

    // Every load starts compact; the opening roll plays once the sheets are in.
    document.body.classList.add('sidebar-compact');
    els.sidebar.dataset.mode = 'compact';
    this.setProgress(POLE_COMPACT);

    for (const c of els.menuList.querySelectorAll<HTMLCanvasElement>('canvas.active-ribbon')) {
      const label = c.dataset.ribbon;
      if (!label) continue;
      this.ribbonCanvases.set(label, c);
      this.ribbonLevels.set(label, label === opts.initialSelection ? 1 : 0);
    }
    this.applyCurrent(opts.initialSelection);

    els.toggle.addEventListener('click', this.onToggleClick);
    window.addEventListener('resize', this.onResize);
    this.resizeObserver = new ResizeObserver(() => this.refreshRibbons());
    this.resizeObserver.observe(els.menuList);

    this.separatorImage.onload = () => this.paintSeparator();
    this.separatorImage.src = this.assets.separator;
    this.ribbonImage.onload = () => {
      if (this.ribbonImage.naturalWidth !== RIBBON_SHEET.width || this.ribbonImage.naturalHeight !== RIBBON_SHEET.height) {
        console.error(`[PixelSidebar] Ribbon.png must remain ${RIBBON_SHEET.width}×${RIBBON_SHEET.height}; update slicing if the sheet changes.`);
        return;
      }
      this.ribbonReady = true;
      this.refreshRibbons();
    };
    this.ribbonImage.onerror = () => console.error('[PixelSidebar] Ribbon.png failed to load.');
    this.ribbonImage.src = this.assets.ribbon;
    void this.loadSidebar();
  }

  /** Stop everything and leave the body clean (the chrome unmounts on marketing pages). */
  destroy() {
    this.destroyed = true;
    this.ribbonToken++;
    this.els.toggle.removeEventListener('click', this.onToggleClick);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver.disconnect();
    document.body.classList.remove('sidebar-compact');
    document.documentElement.style.removeProperty('--sidebar-expand-progress');
    document.documentElement.style.removeProperty('--sidebar-width');
  }

  get isBusy() { return this.busy; }
  get isCompact() { return this.compact; }
  get isOpen() { return this.ready && this.step === this.total(); }

  /** The pole/brand footprint: `--sidebar-expand-progress` (0 compact … 1 expanded) and `--sidebar-width`. */
  private setProgress(poleWidth: number) {
    const root = document.documentElement.style;
    root.setProperty('--sidebar-expand-progress', String((poleWidth - POLE_COMPACT) / (this.cfg.panelSourceWidth - POLE_COMPACT)));
    root.setProperty('--sidebar-width', `${poleWidth * this.pixelScale}px`);
    this.els.sidebar.style.width = `${poleWidth * this.pixelScale}px`;
  }

  // ── 2. DOM / STATE / CONTENT-DRIVEN GEOMETRY ──
  private layoutPixels() {
    const { canvas, pole, sidebar, menuOverlay, menuList } = this.els;
    const oldTotal = Number(canvas.dataset.total || 0);
    const wasOpen = !this.ready || this.step === oldTotal;
    const oldStep = this.step;
    this.pixelScale = this.cfg.pixelScale;
    sidebar.style.setProperty('--pixel', `${this.pixelScale}px`);
    document.documentElement.style.setProperty('--pixel', `${this.pixelScale}px`);
    sidebar.dataset.pixelScale = String(this.pixelScale);
    // Two cloth tiles plus the original one-tile pole overhang when compact.
    canvas.width = this.compact ? CLOTH_COMPACT : this.cfg.panelSourceWidth;
    const width = canvas.width * this.pixelScale;
    // Pole/brand footprint is independent of the two-tile compact cloth.
    pole.width = this.compact ? POLE_COMPACT : this.cfg.panelSourceWidth;
    pole.height = TILE;
    pole.style.width = `${pole.width * this.pixelScale}px`;
    pole.style.height = `${TILE * this.pixelScale}px`;
    this.setProgress(pole.width);
    sidebar.style.marginLeft = '0';
    menuOverlay.style.left = `${(this.compact ? 0 : this.cfg.menuLeft) * this.pixelScale}px`;
    menuOverlay.style.right = 'auto';
    menuOverlay.style.width = `${(this.compact ? 32 : canvas.width - this.cfg.menuLeft - this.cfg.menuRight) * this.pixelScale}px`;
    menuOverlay.style.top = `${this.cfg.menuTop * this.pixelScale}px`;
    menuOverlay.style.bottom = 'auto';
    const wasHidden = menuOverlay.hidden;
    const oldVisibility = menuOverlay.style.visibility;
    menuOverlay.style.visibility = 'hidden';
    menuOverlay.hidden = false;
    // Measure the real menu, even while rolled up. Keep each source tile whole.
    const docs = menuList.querySelector('[data-menu="docs"]') ?? menuList;
    const docsBottom = (docs.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top + (this.els.scroller?.scrollTop ?? 0)) / this.pixelScale;
    const menuEndRow = Math.ceil(docsBottom / TILE);
    // After Docs: taper and bottom cap, with no extra empty body row (no taper on the compact cloth).
    const taperExtraRows = this.compact ? 0 : (canvas.width / TILE - 4) / 2;
    const sourceHeight = (menuEndRow + 1 + taperExtraRows) * TILE;
    sidebar.dataset.docsEndRow = String(Math.ceil(docsBottom / TILE));
    sidebar.dataset.contentEndRow = String(menuEndRow);
    menuOverlay.hidden = wasHidden;
    menuOverlay.style.visibility = oldVisibility;
    if (canvas.height !== sourceHeight) canvas.height = sourceHeight;
    const height = canvas.height * this.pixelScale;
    sidebar.style.height = `${height}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (this.ready) {
      this.draw(wasOpen ? this.total() : Math.min(oldStep, this.total()));
      this.refreshRibbons();
    }
  }

  // ── 3. MENU / RIBBON / SEPARATOR ──
  private paintRibbon(label: string, amount: number) {
    this.ribbonLevels.set(label, amount);
    const c = this.ribbonCanvases.get(label);
    if (!c || !this.ribbonReady) return;
    const button = c.parentElement;
    if (!button) return;
    const { sidebar } = this.els;
    const scale = this.pixelScale;
    // Logical raster pixels always render at the SAME integer scale as panel/icons. A narrow menu clips a
    // natural-sized ribbon instead of squeezing its pixels. Extend to the canvas's left edge, beyond the
    // banner's inset wooden edge; keep the previous right edge INSIDE the menu/banner.
    const leftExtension = Math.max(0, Math.round(button.getBoundingClientRect().left - sidebar.getBoundingClientRect().left));
    c.style.left = `${-leftExtension}px`;
    c.width = Math.max(1, Math.floor((button.clientWidth + leftExtension) / scale));
    c.height = TILE;
    c.style.width = `${c.width * scale}px`;
    c.style.height = `${TILE * scale}px`;
    const r = c.getContext('2d');
    if (!r) return;
    r.imageSmoothingEnabled = false;
    r.clearRect(0, 0, c.width, TILE);
    if (amount <= 0) return;
    const length = Math.max(1, Math.round(c.width * amount));
    const img = this.ribbonImage;
    if (length >= 48) {
      r.drawImage(img, 0, 0, TILE, TILE, 0, 0, TILE, TILE);
      // Fixed endcaps; only the centre tile is repeated, clipped rather than stretched.
      r.save();
      r.beginPath();
      r.rect(TILE, 0, length - 2 * TILE, TILE);
      r.clip();
      for (let x = TILE; x < length - TILE; x += TILE) r.drawImage(img, TILE, 0, TILE, TILE, x, 0, TILE, TILE);
      r.restore();
      r.drawImage(img, 2 * TILE, 0, TILE, TILE, length - TILE, 0, TILE, TILE);
    } else {
      const lengths = [48, 40, 32, 24, 16, 9, 5];
      let frame = 0;
      for (let i = 1; i < lengths.length; i++) if (Math.abs(lengths[i] - length) < Math.abs(lengths[frame] - length)) frame = i;
      for (let col = 0; col < 3; col++) r.drawImage(img, frame * 48 + col * TILE, 0, TILE, TILE, col * TILE, 0, TILE, TILE);
    }
  }

  private tweenRibbon(label: string, to: number, token: number): Promise<boolean> {
    const from = this.ribbonLevels.get(label) || 0;
    const duration = reducedMotion() ? 0 : this.cfg.ribbonMs;
    return new Promise((resolve) => {
      let start: number | undefined;
      const tick = (now: number) => {
        if (token !== this.ribbonToken) { resolve(false); return; }
        if (start === undefined) start = now;
        const t = duration ? Math.min(1, (now - start) / duration) : 1;
        this.paintRibbon(label, from + (to - from) * ease(t));
        if (t < 1) requestAnimationFrame(tick);
        else resolve(true);
      };
      requestAnimationFrame(tick);
    });
  }

  private applyCurrent(label: string | null) {
    const key = label?.toLowerCase();
    for (const item of this.els.menuList.querySelectorAll<HTMLElement>('.menu-item')) {
      if (key && item.dataset.menu === key) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
  }

  /** The route changed: retract every visible ribbon, then extend the new selection's (null = none). */
  async select(label: string | null) {
    if (this.selectedMenu === label) return;
    this.selectedMenu = label;
    const token = ++this.ribbonToken;
    const visible = [...this.ribbonLevels].filter(([, level]) => level > 0).map(([name]) => name);
    await Promise.all(visible.map((name) => this.tweenRibbon(name, 0, token)));
    if (token !== this.ribbonToken || this.destroyed) return;
    this.applyCurrent(label);
    if (label && this.ribbonCanvases.has(label)) await this.tweenRibbon(label, 1, token);
  }

  private paintSeparator() {
    const c = this.els.menuList.querySelector<HTMLCanvasElement>('.menu-separator canvas');
    const img = this.separatorImage;
    if (!c || !c.parentElement || !img.complete || img.naturalWidth !== 48) return;
    // Compact joins the two end tiles directly; expanded retains its tiled centre (one extra tile).
    const cols = this.compact ? 2 : Math.max(3, Math.floor(c.parentElement.clientWidth / (TILE * this.pixelScale)) + 1);
    c.width = cols * TILE;
    c.height = TILE;
    c.style.width = `${c.width * this.pixelScale}px`;
    c.style.height = `${TILE * this.pixelScale}px`;
    const r = c.getContext('2d');
    if (!r) return;
    r.imageSmoothingEnabled = false;
    for (let col = 0; col < cols; col++) r.drawImage(img, (col === 0 ? 0 : col === cols - 1 ? 2 : 1) * TILE, 0, TILE, TILE, col * TILE, 0, TILE, TILE);
  }

  private refreshRibbons() {
    if (this.ribbonReady && !this.els.menuOverlay.hidden) for (const [label, level] of this.ribbonLevels) this.paintRibbon(label, level);
  }

  private syncMenu() {
    const { menuOverlay, menuList, toggle, sidebar, canvas } = this.els;
    const visible = this.ready && this.step > 0;
    const interactive = visible && !this.busy;
    if (!interactive && menuOverlay.contains(document.activeElement)) toggle.focus();
    // Keep the menu layer while rolling; hide each row only when the roll reaches it.
    menuOverlay.hidden = !visible;
    menuOverlay.inert = !interactive;
    if (visible) {
      const rollEdge = sidebar.getBoundingClientRect().top + Number(canvas.dataset.rollY) * this.pixelScale;
      for (const row of Array.from(menuList.children) as HTMLElement[]) {
        const revealed = this.step === this.total() || row.getBoundingClientRect().bottom <= rollEdge;
        row.style.visibility = revealed ? 'visible' : 'hidden';
        row.setAttribute('aria-hidden', String(!revealed));
        row.inert = !revealed || this.busy;
      }
      this.refreshRibbons();
      this.paintSeparator();
    }
  }

  // ── 4. TILE RENDERER — every crop/destination uses the original 16×16 tile grid. ──
  private tileRows() { return this.els.canvas.height / TILE; }
  /** Closed -> fixed roll travels down -> one partial pose -> fully open. */
  private total() { return this.tileRows() + 1; }

  private tile(pose: number, sourceCol: number, sourceRow: number, destRow: number, destCol: number) {
    this.ctx.drawImage(this.image, BANNER_POSE_X[pose] + sourceCol * TILE, sourceRow * TILE, TILE, TILE, destCol * TILE, destRow * TILE, TILE, TILE);
  }

  /** Pole.png: four 64×16 poses. Repeat only tile 1, retaining both right tiles; the last middle tile clips. */
  private drawPole() {
    const { pole } = this.els;
    const p = pole.getContext('2d');
    if (!p || !this.poleImage.complete) return;
    p.imageSmoothingEnabled = false;
    p.clearRect(0, 0, pole.width, pole.height);
    const sourceX = this.poleFrame * 64;
    p.drawImage(this.poleImage, sourceX, 0, TILE, TILE, 0, 0, TILE, TILE);
    const rightStart = pole.width - 2 * TILE;
    for (let x = TILE; x < rightStart; x += TILE) {
      const width = Math.min(TILE, rightStart - x);
      p.drawImage(this.poleImage, sourceX + TILE, 0, width, TILE, x, 0, width, TILE);
    }
    p.drawImage(this.poleImage, sourceX + 2 * TILE, 0, 2 * TILE, TILE, rightStart, 0, 2 * TILE, TILE);
    pole.dataset.frame = String(this.poleFrame);
  }

  private tileRow(pose: number, sourceRow: number, destRow: number, inset = 0) {
    // The canvas keeps its approved transparent overhang; the cloth ends one tile earlier.
    const columns = this.els.canvas.width / TILE - 1 - 2 * inset;
    for (let col = 0; col < columns; col++) {
      const sourceCol = col === 0 ? 0 : col === columns - 1 ? 2 : 1;
      this.tile(pose, sourceCol, sourceRow, destRow, col + inset);
    }
  }

  // The extra sheet row (y 64) supplies diagonal EDGES, not a complete footer image. Two inward steps leave
  // three cloth tiles for the original flat-ended cap.
  private taperDepth() { return Math.max(0, (this.els.canvas.width / TILE - 4) / 2); }
  private taperStart() { return this.tileRows() - 1 - this.taperDepth(); }

  private taperRow(destRow: number, inset: number) {
    const rightCol = this.els.canvas.width / TILE - 2 - inset;
    for (let col = inset; col <= rightCol; col++) {
      const sourceCol = col === inset ? 0 : col === inset + 1 ? 1 : col === rightCol - 1 ? 2 : col === rightCol ? 3 : null;
      if (sourceCol === null) this.tile(0, 1, 1, destRow, col);
      else this.ctx.drawImage(this.image, sourceCol * TILE, 64, TILE, TILE, col * TILE, destRow * TILE, TILE, TILE);
    }
  }

  /** Narrow composition omits the middle cloth tile, preserving both edges; the overhang tile stays transparent. */
  private compactRow(pose: number, sourceRow: number, destRow: number) {
    [0, 2].forEach((sourceCol, destCol) => this.tile(pose, sourceCol, sourceRow, destRow, destCol));
  }

  private drawCompact() {
    const lastRow = this.tileRows() - 1;
    const frontRow = Math.min(this.step, lastRow);
    const pose = this.step === 0 ? 4 : this.step === 1 ? 3 : this.step <= lastRow ? 2 : this.step === lastRow + 1 ? 1 : 0;
    if (!this.step) this.compactRow(4, 0, 0);
    else {
      const bodyPose = pose === 1 ? 1 : 0;
      this.compactRow(bodyPose, 0, 0);
      for (let row = 1; row < frontRow; row++) this.compactRow(bodyPose, 1, row);
      this.compactRow(pose, pose === 0 ? 3 : pose === 3 ? 1 : 2, frontRow);
    }
    return { frontRow, pose };
  }

  private draw(n: number) {
    const { canvas, toggle } = this.els;
    this.step = Math.max(0, Math.min(this.total(), Math.round(n)));
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawPole();
    let frontRow = 0;
    let pose = 4;
    if (this.compact) {
      ({ frontRow, pose } = this.drawCompact());
    } else if (this.step === 0) {
      this.tileRow(4, 0, 0);
    } else {
      const lastRow = this.tileRows() - 1;
      frontRow = Math.min(this.step, lastRow);
      // Pose 3's bottom row is the SAME cap at every travel step; poses 2 and 1 only at full length.
      pose = this.step === 1 ? 3 : this.step <= lastRow ? 2 : this.step === lastRow + 1 ? 1 : 0;
      const bodyPose = pose === 1 ? 1 : 0;
      this.tileRow(bodyPose, 0, 0);
      for (let row = 1; row < frontRow; row++) {
        if (row >= this.taperStart()) this.taperRow(row, row - this.taperStart());
        else this.tileRow(bodyPose, 1, row);
      }
      const inset = Math.max(0, frontRow - this.taperStart());
      // The open pose's ornamented cap is at y=48; y=32 is a straight body row. Rolling poses use y=16 / y=32.
      this.tileRow(pose, pose === 0 ? 3 : pose === 3 ? 1 : 2, frontRow, inset);
    }
    const label = this.step === 0 ? 'Sidebar rolled up' : this.step === this.total() ? 'Sidebar open' : this.busy ? 'Sidebar rolling' : 'Sidebar partly open';
    canvas.dataset.step = String(this.step);
    canvas.dataset.rollY = String(frontRow * TILE);
    canvas.dataset.total = String(this.total());
    canvas.dataset.pose = String(pose);
    canvas.setAttribute('aria-label', label);
    toggle.setAttribute('aria-label', this.compact ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.setAttribute('aria-expanded', String(!this.compact));
    this.syncMenu();
  }

  // ── 5. MOTION SEQUENCING / INPUT ──
  // Roll the current width fully up, switch at the pole, then unroll the new width. Lock input throughout.
  private lock(value: boolean) {
    this.busy = value;
    this.els.toggle.disabled = value;
    this.syncMenu();
  }

  private async animatePole() {
    // Always left-to-right on either toggle; end on the artist's final rest pose (frame 3).
    this.poleFrame = reducedMotion() ? 3 : 0;
    this.drawPole();
    if (reducedMotion()) return;
    const frameMs = this.total() * this.cfg.rollStepMs / 4;
    for (let frame = 1; frame < 4; frame++) {
      await wait(frameMs);
      if (this.destroyed) return;
      this.poleFrame = frame;
      this.drawPole();
    }
  }

  private async animateTo(target: number) {
    const startStep = this.step;
    const distance = Math.abs(target - startStep);
    if (!distance) return;
    if (reducedMotion()) { this.draw(target); return; }
    const duration = distance * this.cfg.rollStepMs;
    await new Promise<void>((resolve) => {
      let start: number | undefined;
      const tick = (now: number) => {
        if (this.destroyed) { resolve(); return; }
        if (start === undefined) start = now;
        const t = Math.min(1, (now - start) / duration);
        const next = Math.round(startStep + (target - startStep) * ease(t));
        if (next !== this.step) this.draw(next);
        if (t < 1) requestAnimationFrame(tick);
        else { this.draw(target); resolve(); }
      };
      requestAnimationFrame(tick);
    });
  }

  /** The pole's length follows the width change: one source pixel per snap, never a scaled canvas. */
  private async resizePole(target: number) {
    const { pole } = this.els;
    const from = pole.width;
    const duration = reducedMotion() ? 0 : this.cfg.compactMs;
    pole.dataset.resizing = 'true';
    await new Promise<void>((resolve) => {
      let start: number | undefined;
      const tick = (now: number) => {
        if (this.destroyed) { resolve(); return; }
        if (start === undefined) start = now;
        const t = duration ? Math.min(1, (now - start) / duration) : 1;
        const width = Math.round(from + (target - from) * ease(t));
        if (pole.width !== width) {
          pole.width = width;
          pole.style.width = `${width * this.pixelScale}px`;
          this.setProgress(width);
          this.drawPole();
        }
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    pole.dataset.resizing = 'false';
  }

  private async changeWidth() {
    const { sidebar, pole } = this.els;
    sidebar.dataset.phase = 'rolling-up';
    this.els.scroller?.scrollTo({ top: 0 });
    await this.animateTo(0);
    if (this.destroyed) return;
    // Keep one painted fully rolled frame before changing width.
    sidebar.dataset.phase = 'rolled';
    if (!reducedMotion()) await wait(this.cfg.rollStepMs);
    const previousPoleWidth = pole.width;
    this.compact = !this.compact;
    document.body.classList.toggle('sidebar-compact', this.compact);
    sidebar.dataset.mode = this.compact ? 'compact' : 'expanded';
    this.layoutPixels();
    this.draw(0);
    // The cloth switches width at once; the pole keeps its old length until its tween.
    const targetPoleWidth = pole.width;
    pole.width = previousPoleWidth;
    pole.style.width = `${previousPoleWidth * this.pixelScale}px`;
    this.setProgress(previousPoleWidth);
    this.drawPole();
    sidebar.dataset.phase = 'unrolling';
    await Promise.all([this.resizePole(targetPoleWidth), this.animateTo(this.total())]);
    sidebar.dataset.phase = 'idle';
  }

  private async run(action: () => Promise<void>) {
    if (this.busy || !this.ready || this.destroyed) return;
    const { toggle } = this.els;
    const restorePoleFocus = document.activeElement === toggle;
    this.lock(true);
    try {
      await action();
    } finally {
      if (!this.destroyed) {
        this.lock(false);
        this.draw(this.step);
        this.layoutPixels();
        if (restorePoleFocus) toggle.focus({ preventScroll: true });
      }
    }
  }

  /** The pole: compact ↔ expanded. */
  toggle() { void this.run(() => Promise.all([this.animatePole(), this.changeWidth()]).then(() => undefined)); }

  private readonly onToggleClick = () => this.toggle();
  private readonly onResize = () => {
    this.cfg.pixelScale = applyChromePixelScale();
    if (!this.busy && this.ready) this.layoutPixels();
  };

  private async loadSidebar() {
    const load = (img: HTMLImageElement, src: string, width: number, height: number, name: string) => new Promise<void>((resolve, reject) => {
      img.onload = () => (img.naturalWidth === width && img.naturalHeight === height
        ? resolve()
        : reject(new Error(`[PixelSidebar] ${name} must remain ${width}×${height}; update slicing if the sheet changes.`)));
      img.onerror = () => reject(new Error(`[PixelSidebar] ${name} failed to load.`));
      img.src = src;
    });
    try {
      await Promise.all([
        load(this.image, this.assets.banner, BANNER_SHEET.width, BANNER_SHEET.height, 'Banner.png'),
        load(this.poleImage, this.assets.pole, POLE_SHEET.width, POLE_SHEET.height, 'Pole.png'),
      ]);
    } catch (err) {
      console.error(err);
      return;
    }
    // First load / reload opens the compact banner. Wait for font metrics before measuring the rows.
    await document.fonts.ready;
    if (this.destroyed) return;
    this.ready = true;
    this.els.scroller?.scrollTo({ top: 0 });
    this.layoutPixels();
    this.draw(0);
    await this.run(async () => {
      // Two frames ensure the initial rolled pose paints before unrolling.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await this.animateTo(this.total());
      this.els.sidebar.dataset.phase = 'idle';
    });
  }
}
