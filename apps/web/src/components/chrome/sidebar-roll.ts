/**
 * The rolling pixel sidebar — Nzib's reference logic (design/website/mockups/mockups.html, sections 2–5,
 * 2026-10-08) ported as a class bound to the React-rendered DOM of `pixel-sidebar.tsx`. The behaviour is his,
 * unchanged:
 *   - the panel is a canvas tiled from Sidebar.png (320×96, a 16×16 source grid) at an integer scale; its height
 *     follows the Docs row, then a diagonal taper and one flat cap; nothing is ever stretched;
 *   - open/close ROLL the banner over discrete tile poses (20 ms nominal per step, cubic ease-in-out); close =
 *     roll up first, then slide to the compact pole at the left; open reverses that; rows reveal top-down and
 *     disappear bottom-up as the rolling edge passes them; input is locked throughout;
 *   - the selection ribbon retracts the old selection, then extends the new one (250 ms each, fixed end caps and
 *     a repeated centre tile, seven short poses under 48 px); rapid selections cancel older tweens; the active
 *     icon/text shift 6 px by CSS; the ribbon stays put;
 *   - the logo and the exposed pole both reopen the compact state;
 *   - first load / reload paints the compact closed state, then plays the normal opening.
 * The engine owns the DOM state React does not render: the body's `sidebar-compact` class, `aria-current` on the
 * menu items (set after the old ribbon has retracted, as in the reference), `hidden`/`inert` on the overlay and
 * rows, the canvases, the sizing styles. React owns the markup and the links; a route change calls `select`.
 */

export interface SidebarRollElements {
  /** The sizing wrapper (`.sidebar-preview`). */
  sidebar: HTMLElement;
  /** The banner canvas. */
  canvas: HTMLCanvasElement;
  /** The pole hit target. */
  toggle: HTMLButtonElement;
  menuOverlay: HTMLElement;
  /** The `<ul>`: one `<li data-menu>` per item (+ the separator `<li>`), each item holding `canvas.active-ribbon[data-ribbon]`. */
  menuList: HTMLElement;
  brandTrigger: HTMLButtonElement;
}

export interface SidebarRollOptions {
  assets: { panel: string; ribbon: string; separator: string };
  /** The label selected on first paint (its ribbon starts extended). */
  initialSelection: string | null;
}

const TILE = 16;
const COLS = 4;
const PANEL_SHEET = { width: 320, height: 96 };
const RIBBON_SHEET = { width: 336, height: 16 };

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
    rollStepMs: number; ribbonMs: number; compactMs: number; compactSettleMs: number;
  };
  private readonly image = new Image();
  private readonly ribbonImage = new Image();
  private readonly separatorImage = new Image();
  private readonly ribbonLevels = new Map<string, number>();
  private readonly ribbonCanvases = new Map<string, HTMLCanvasElement>();
  private readonly resizeObserver: ResizeObserver;
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
      pixelScale: num('--pixel'),
      panelSourceWidth: num('--panel-source-width'),
      menuLeft: num('--menu-left-units'),
      menuRight: num('--menu-right-units'),
      menuTop: num('--menu-top-units'),
      rollStepMs: num('--roll-step-ms'),
      ribbonMs: num('--ribbon-duration'),
      compactMs: num('--compact-duration'),
      compactSettleMs: 20,
    };
    this.pixelScale = this.cfg.pixelScale;
    this.selectedMenu = opts.initialSelection;

    // First load / reload starts compact and closed; the opening plays once the sheet is in.
    document.body.classList.add('sidebar-compact');
    els.brandTrigger.tabIndex = 0;

    for (const c of els.menuList.querySelectorAll<HTMLCanvasElement>('canvas.active-ribbon')) {
      const label = c.dataset.ribbon;
      if (!label) continue;
      this.ribbonCanvases.set(label, c);
      this.ribbonLevels.set(label, label === opts.initialSelection ? 1 : 0);
    }
    this.applyCurrent(opts.initialSelection);

    els.toggle.addEventListener('click', this.onToggleClick);
    els.brandTrigger.addEventListener('click', this.onBrandClick);
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
    this.image.onload = () => void this.startup();
    this.image.onerror = () => console.error('[PixelSidebar] Sidebar.png failed to load.');
    this.image.src = this.assets.panel;
  }

  /** Stop everything and leave the body clean (the chrome unmounts on marketing pages). */
  destroy() {
    this.destroyed = true;
    this.ribbonToken++;
    this.els.toggle.removeEventListener('click', this.onToggleClick);
    this.els.brandTrigger.removeEventListener('click', this.onBrandClick);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver.disconnect();
    document.body.classList.remove('sidebar-compact');
  }

  get isBusy() { return this.busy; }
  get isOpen() { return this.ready && this.step === this.total(); }

  // ── 2. DOM / STATE / CONTENT-DRIVEN GEOMETRY ──
  private layoutPixels() {
    const { canvas, sidebar, menuOverlay, menuList } = this.els;
    const oldTotal = Number(canvas.dataset.total || 0);
    const wasOpen = !this.ready || this.step === oldTotal;
    const oldStep = this.step;
    this.pixelScale = this.cfg.pixelScale;
    sidebar.style.setProperty('--pixel', `${this.pixelScale}px`);
    document.documentElement.style.setProperty('--pixel', `${this.pixelScale}px`);
    sidebar.dataset.pixelScale = String(this.pixelScale);
    canvas.width = this.cfg.panelSourceWidth;
    // Measure the real menu, even while rolled up. Keep each source tile whole.
    const width = canvas.width * this.pixelScale;
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    sidebar.style.width = `${width}px`;
    sidebar.style.marginLeft = '0';
    menuOverlay.style.left = `${this.cfg.menuLeft * this.pixelScale}px`;
    menuOverlay.style.right = `${this.cfg.menuRight * this.pixelScale}px`;
    menuOverlay.style.top = `${this.cfg.menuTop * this.pixelScale}px`;
    menuOverlay.style.bottom = 'auto';
    const wasHidden = menuOverlay.hidden;
    const oldVisibility = menuOverlay.style.visibility;
    menuOverlay.style.visibility = 'hidden';
    menuOverlay.hidden = false;
    const docs = menuList.querySelector('[data-menu="docs"]');
    const docsBottom = docs
      ? (docs.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top) / this.pixelScale
      : (menuList.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top) / this.pixelScale;
    const menuEndRow = Math.ceil(docsBottom / 16);
    // After Docs: taper and bottom cap, with no extra empty body row.
    const taperExtraRows = (canvas.width / 16 - 4) / 2;
    const sourceHeight = (menuEndRow + 1 + taperExtraRows) * 16;
    sidebar.dataset.docsEndRow = String(Math.ceil(docsBottom / 16));
    sidebar.dataset.contentEndRow = String(menuEndRow);
    sidebar.dataset.emptyRows = '0';
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
    // Logical raster pixels always render at the SAME integer scale as panel/icons.
    // A narrow menu clips a natural-sized ribbon instead of squeezing its pixels.
    // Extend to the canvas's left edge, beyond the banner's inset wooden edge; keep the previous
    // right edge INSIDE the menu/banner instead of stretching outward on both sides.
    const leftExtension = Math.max(0, Math.round(button.getBoundingClientRect().left - sidebar.getBoundingClientRect().left));
    c.style.left = `${-leftExtension}px`;
    c.width = Math.max(1, Math.floor((button.clientWidth + leftExtension) / scale));
    c.height = 16;
    c.style.width = `${c.width * scale}px`;
    c.style.height = `${16 * scale}px`;
    const r = c.getContext('2d');
    if (!r) return;
    r.imageSmoothingEnabled = false;
    r.clearRect(0, 0, c.width, 16);
    if (amount <= 0) return;
    const length = Math.max(1, Math.round(c.width * amount));
    const img = this.ribbonImage;
    if (length >= 48) {
      r.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16);
      // Fixed endcaps; only the center tile is repeated. Canvas clipping preserves the endcap
      // without stretching a texture or resizing the original PNG.
      r.save();
      r.beginPath();
      r.rect(16, 0, length - 32, 16);
      r.clip();
      for (let x = 16; x < length - 16; x += 16) r.drawImage(img, 16, 0, 16, 16, x, 0, 16, 16);
      r.restore();
      r.drawImage(img, 32, 0, 16, 16, length - 16, 0, 16, 16);
    } else {
      const lengths = [48, 40, 32, 24, 16, 9, 5];
      let frame = 0;
      for (let i = 1; i < lengths.length; i++) if (Math.abs(lengths[i] - length) < Math.abs(lengths[frame] - length)) frame = i;
      for (let col = 0; col < 3; col++) r.drawImage(img, frame * 48 + col * 16, 0, 16, 16, col * 16, 0, 16, 16);
    }
  }

  private tweenRibbon(label: string, to: number, token: number): Promise<boolean> {
    const from = this.ribbonLevels.get(label) || 0;
    const duration = this.cfg.ribbonMs;
    return new Promise((resolve) => {
      let start: number | undefined;
      const tick = (now: number) => {
        if (token !== this.ribbonToken) { resolve(false); return; }
        if (start === undefined) start = now;
        const t = Math.min(1, (now - start) / duration);
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
    // Rapid clicks cancel old tweens; shrink all visible ribbons before the new one.
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
    // One extra repeated center tile; fixed end ornaments remain centered.
    const cols = Math.max(3, Math.floor(c.parentElement.clientWidth / (16 * this.pixelScale)) + 1);
    c.width = cols * 16;
    c.height = 16;
    c.style.width = `${c.width * this.pixelScale}px`;
    c.style.height = `${16 * this.pixelScale}px`;
    const r = c.getContext('2d');
    if (!r) return;
    r.imageSmoothingEnabled = false;
    for (let col = 0; col < cols; col++) r.drawImage(img, (col === 0 ? 0 : col === cols - 1 ? 2 : 1) * 16, 0, 16, 16, col * 16, 0, 16, 16);
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
    // Visibility (not display) preserves all positions and spacing.
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
  // Five 64px-wide pose columns. Open pose cap is y=48, rolling caps y=16/32.
  // Extra diagonal pairs use y=64 (two tiles per side, never replace inner seams).
  // Preserve transparent padding: never crop to the visible artwork bounds.
  private tileRows() { return this.els.canvas.height / TILE; }
  /** Closed -> fixed roll travels down -> one partial pose -> fully open. Reverse to close: the two long-panel poses occur ONCE, at full length. */
  private total() { return this.tileRows() + 1; }

  private tile(pose: number, sourceCol: number, sourceRow: number, destRow: number, destCol: number) {
    this.ctx.drawImage(this.image, (pose * COLS + sourceCol) * TILE, sourceRow * TILE, TILE, TILE, destCol * TILE, destRow * TILE, TILE, TILE);
  }

  private tileRow(pose: number, sourceRow: number, destRow: number, inset = 0) {
    const columns = this.els.canvas.width / TILE - 2 * inset;
    for (let col = 0; col < columns; col++) {
      // Selected pole tile is column 1 (x16..31), NOT the right pole tip. Repeat this center column for
      // banner and rolling edge too, preserving the original left column and both original right columns.
      const sourceCol = col === 0 ? 0 : col >= columns - 2 ? col - (columns - COLS) : 1;
      this.tile(pose, sourceCol, sourceRow, destRow, col + inset);
    }
  }

  // The extra sheet row supplies diagonal EDGES, not a complete footer image. Two inward steps leave three
  // cloth tiles for the original flat-ended cap: its two corner tiles converge on one central, horizontal tile.
  private taperDepth() { return Math.max(0, (this.els.canvas.width / TILE - 4) / 2); }
  private taperStart() { return this.tileRows() - 1 - this.taperDepth(); }

  private taperRow(destRow: number, inset: number) {
    const rightCol = this.els.canvas.width / TILE - 2 - inset;
    // Each diagonal border spans TWO source tiles, including its inner seam. Repeat plain fill only BETWEEN
    // these edge pairs, never over the seam.
    for (let col = inset; col <= rightCol; col++) {
      const sourceCol = col === inset ? 0 : col === inset + 1 ? 1 : col === rightCol - 1 ? 2 : col === rightCol ? 3 : null;
      if (sourceCol === null) this.tile(0, 1, 1, destRow, col);
      else this.ctx.drawImage(this.image, sourceCol * TILE, 64, TILE, TILE, col * TILE, destRow * TILE, TILE, TILE);
    }
  }

  private draw(n: number) {
    const { canvas, toggle } = this.els;
    this.step = Math.max(0, Math.min(this.total(), Math.round(n)));
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    let frontRow = 0;
    let pose = 4;
    if (this.step === 0) {
      this.tileRow(4, 0, 0);
    } else {
      const lastRow = this.tileRows() - 1;
      frontRow = Math.min(this.step, lastRow);
      // Pose 3's entire bottom tile row is the SAME cap at every travel step.
      // Poses 2 and 1 are only used after reaching full length, never per row.
      pose = this.step === 1 ? 3 : this.step <= lastRow ? 2 : this.step === lastRow + 1 ? 1 : 0;
      const bodyPose = pose === 1 ? 1 : 0;
      this.tileRow(bodyPose, 0, 0);
      for (let row = 1; row < frontRow; row++) {
        if (row >= this.taperStart()) this.taperRow(row, row - this.taperStart());
        else this.tileRow(bodyPose, 1, row);
      }
      const inset = Math.max(0, frontRow - this.taperStart());
      // Open pose's ornamented cap is at y=48; y=32 is a straight body row. Rolling poses still use y=16 / y=32.
      this.tileRow(pose, pose === 0 ? 3 : pose === 3 ? 1 : 2, frontRow, inset);
    }
    const label = this.step === 0 ? 'Sidebar rolled up' : this.step === this.total() ? 'Sidebar open' : this.busy ? 'Sidebar rolling' : 'Sidebar partly open';
    canvas.dataset.step = String(this.step);
    canvas.dataset.rollY = String(frontRow * TILE);
    canvas.dataset.total = String(this.total());
    canvas.dataset.pose = String(pose);
    canvas.setAttribute('aria-label', label);
    toggle.setAttribute('aria-label', this.step === 0 ? 'Open sidebar' : 'Close sidebar');
    toggle.setAttribute('aria-expanded', String(this.step > 0));
    this.syncMenu();
  }

  // ── 5. MOTION SEQUENCING / INPUT ──
  // Close: roll up, THEN slide left. Open: slide back, THEN unroll.
  // Lock input throughout; menu visibility follows the roll edge, not separate timers.
  private lock(value: boolean) {
    this.busy = value;
    this.els.toggle.disabled = value;
    this.syncMenu();
  }

  private async setCompact(compact: boolean) {
    if (document.body.classList.contains('sidebar-compact') === compact) return;
    document.body.classList.toggle('sidebar-compact', compact);
    this.els.brandTrigger.tabIndex = compact ? 0 : -1;
    await wait(reducedMotion() ? 0 : this.cfg.compactMs + this.cfg.compactSettleMs);
  }

  private async animateTo(target: number) {
    if (target > 0) await this.setCompact(false);
    const startStep = this.step;
    const distance = Math.abs(target - startStep);
    if (!distance) return;
    const duration = distance * this.cfg.rollStepMs;
    // Ease the existing whole-tile sequence; do not scale/morph the artwork.
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
    if (target === 0) await this.setCompact(true);
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

  /** The pole (or, when compact, the logo): open when closed, close when open. */
  toggle() { void this.run(() => this.animateTo(this.step === 0 ? this.total() : 0)); }

  private readonly onToggleClick = () => this.toggle();
  private readonly onBrandClick = () => this.els.toggle.click();
  private readonly onResize = () => { if (!this.busy) this.layoutPixels(); };

  private async startup() {
    if (this.image.naturalWidth !== PANEL_SHEET.width || this.image.naturalHeight !== PANEL_SHEET.height) {
      console.error(`[PixelSidebar] Sidebar.png must remain ${PANEL_SHEET.width}×${PANEL_SHEET.height}; update slicing if the sheet changes.`);
      return;
    }
    // First load / reload: paint the compact closed state, then reuse the normal opening.
    // Wait for font metrics before measuring Docs and allocating whole tile rows.
    await document.fonts.ready;
    if (this.destroyed) return;
    this.ready = true;
    this.layoutPixels();
    this.draw(0);
    await this.run(async () => {
      // Two frames ensure the initial compact pose paints before the slide starts.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await this.animateTo(this.total());
    });
  }
}
