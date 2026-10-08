'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useModal } from 'connectkit';
import { useAccount, useDisconnect } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AgentProfile } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';

/**
 * Nzib's wallet / profile component (design/website/mockups/mockups.html, sections 7 + 9, 2026-10-08): the wooden
 * plank behind the wheel-framed avatar at the top-right. Behaviour as handed off:
 *   - clicking the avatar spins the frame 360° clockwise while the plank retracts behind it (450 ms, cubic);
 *     clicking again spins it back while the plank expands; the label slides and fades on the plank's own
 *     progress; pressing the avatar moves it 3 px down independently of the rotation; clicks are locked during
 *     the motion; first load / reload starts closed and plays the opening;
 *   - Connect Wallet opens the wallet picker (ConnectKit's modal); the label becomes the loader while the wallet
 *     connects; connected, it shows the display name, falling back to the shortened
 *     address. The label is rendered here directly (ConnectKit's own button waits for mount and would leave the
 *     plank with nothing to animate), with a mounted guard so the server and first client paint agree;
 *   - clicking the name opens two chained buttons below the plank — Profile (edits the display name through
 *     PATCH /api/agent/profile) and Disconnect (red) — compact icons that each expand to their label on hover or
 *     focus (width from the content, rounded to the 3 px grid; the right chain follows the width); the menu slides
 *     12 px over 180 ms, hides after the closing slide, and dismisses on outside click, Escape or panel collapse.
 * Sprites: Wooden-panel.png (plank x0..47 / y0..31 as 16 px caps + a repeated middle; wheel x48..111 / y0..63),
 * Button.png (caps at x11 and x32, 5 px; middle x16; the chain is the 4th tile), Icons.png, Loader.png. The
 * sheets are drawn pixel by pixel on canvases, never stretched.
 */
const PANEL_ASSET = '/ui/user/Wooden-panel.png';
const PANEL_SHEET = { width: 112, height: 80 };
/** Avatar click: 360° clockwise + retract; the second click reverses both. */
const USER_MOTION = { durationMs: 450, openWidth: 96, rightEdge: 128 } as const;
const PROFILE_CONFIG = {
  buttonAsset: '/ui/user/Button.png',
  sheetWidth: 64,
  sheetHeight: 16,
  tileSize: 16,
  capWidth: 5,
  leftCapX: 11,
  middleX: 16,
  rightCapX: 32,
} as const;
const PROFILE_MENU_MOTION = { duration: 180, distance: 12 } as const;
export const DISPLAY_NAME_MAX = 20;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pixelScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pixel')) || 3;
const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function WalletPanel() {
  const { address, isConnected, isConnecting } = useAccount();
  const { open: pickerOpen, setOpen: openWalletPicker } = useModal();
  const { disconnect } = useDisconnect();
  const { getAuthHeaders, invalidateAuthCache } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ['profile', address],
    queryFn: () => api.agent.profile(address!),
    enabled: !!address,
  });

  const artRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const panelImage = useRef<HTMLImageElement | null>(null);
  const buttonImage = useRef<HTMLImageElement | null>(null);
  const openRef = useRef(true);
  const busyRef = useRef(false);
  const readyRef = useRef(false);
  const menuOpenRef = useRef(false);
  const menuAnimation = useRef<Animation | null>(null);
  const amountRef = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Wallet state only after hydration: the server renders "Connect Wallet", and so does the first client paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // The loader belongs to the user's own Connect Wallet press — while the picker is open and while the chosen
  // wallet connects — never to the background connecting ConnectKit's optional wallet SDKs do on load.
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (isConnected || (!pickerOpen && !isConnecting)) setPicking(false); }, [isConnected, pickerOpen, isConnecting]);

  // ── 7. WALLET / PROFILE motion ──
  const paintUserPanel = useCallback((amount: number) => {
    const art = artRef.current, label = labelRef.current, img = panelImage.current;
    if (!art || !img) return;
    const paint = art.getContext('2d');
    if (!paint) return;
    amountRef.current = amount;
    paint.imageSmoothingEnabled = false;
    paint.clearRect(0, 0, art.width, art.height);
    const width = Math.round(USER_MOTION.openWidth * amount);
    const left = USER_MOTION.rightEdge - width;
    if (width > 0) {
      // Fixed caps + repeated middle, clipped at the retracting edge, never stretched.
      paint.save();
      paint.beginPath();
      paint.rect(left, 16, width, 32);
      paint.clip();
      paint.drawImage(img, 0, 0, 16, 32, left, 16, 16, 32);
      for (let x = left + 16; x < USER_MOTION.rightEdge - 16; x += 16) paint.drawImage(img, 16, 0, 16, 32, x, 16, 16, 32);
      paint.drawImage(img, 32, 0, 16, 32, USER_MOTION.rightEdge - 16, 16, 16, 32);
      paint.restore();
    }
    // Text fades/slides on the same progress as the plank: no independent timers.
    // Reveal only once 55% open, reaching full opacity at the open endpoint.
    const textProgress = ease(Math.max(0, Math.min(1, (amount - 0.55) / 0.45)));
    if (label) {
      label.style.opacity = String(textProgress);
      label.style.transform = `translateX(${12 * (1 - textProgress)}px)`;
      // Keep the existing edge mask so text never floats beyond the wooden backing.
      label.style.clipPath = `inset(0 0 0 ${Math.max(0, Math.min(68, left - 40)) * pixelScale()}px)`;
      label.style.visibility = width ? 'visible' : 'hidden';
    }
    art.dataset.amount = String(amount);
  }, []);

  /** The label can (re)mount after the panel has started moving: give it the current state the moment it does. */
  const setLabelRef = useCallback((el: HTMLButtonElement | null) => {
    labelRef.current = el;
    if (!el) return;
    el.inert = !openRef.current || busyRef.current;
    paintUserPanel(amountRef.current);
  }, [paintUserPanel]);

  const setProfileMenu = useCallback((open: boolean) => {
    const menu = menuRef.current, label = labelRef.current;
    if (!menu || menuOpenRef.current === open) return;
    menuOpenRef.current = open;
    setMenuOpen(open);
    const current = getComputedStyle(menu);
    const from = menu.hidden ? { transform: `translateY(-${PROFILE_MENU_MOTION.distance}px)` } : { transform: current.transform };
    menuAnimation.current?.cancel();
    menu.hidden = false;
    menu.inert = !open;
    label?.setAttribute('aria-expanded', String(open));
    const animation = menu.animate([from, { transform: `translateY(${open ? 0 : -PROFILE_MENU_MOTION.distance}px)` }], {
      duration: reducedMotion() ? 0 : PROFILE_MENU_MOTION.duration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    menuAnimation.current = animation;
    animation.onfinish = () => {
      if (menuAnimation.current !== animation) return;
      menu.hidden = !open;
      animation.cancel();
      menuAnimation.current = null;
    };
    if (open) menu.querySelector('button')?.focus({ preventScroll: true });
  }, []);

  const closeProfileMenu = useCallback((restoreFocus = false) => {
    setProfileMenu(false);
    if (restoreFocus) labelRef.current?.focus();
  }, [setProfileMenu]);

  const toggleUserPanel = useCallback(async () => {
    const avatar = avatarRef.current, wheel = wheelRef.current;
    if (!avatar || !wheel || busyRef.current || !readyRef.current) return;
    const restoreAvatarFocus = document.activeElement === avatar;
    closeProfileMenu();
    busyRef.current = true;
    avatar.disabled = true;
    if (labelRef.current) labelRef.current.inert = true;
    const closing = openRef.current;
    const duration = reducedMotion() ? 0 : USER_MOTION.durationMs;
    await new Promise<void>((resolve) => {
      let start: number | undefined;
      const tick = (now: number) => {
        if (start === undefined) start = now;
        const t = duration ? Math.min(1, (now - start) / duration) : 1;
        const eased = ease(t);
        paintUserPanel(closing ? 1 - eased : eased);
        const degrees = closing ? eased * 360 : (1 - eased) * 360;
        wheel.style.transform = `rotate(${degrees}deg)`;
        wheel.dataset.degrees = String(degrees);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    openRef.current = !closing;
    avatar.setAttribute('aria-expanded', String(openRef.current));
    avatar.setAttribute('aria-label', openRef.current ? 'Collapse wallet panel' : 'Expand wallet panel');
    if (labelRef.current) labelRef.current.inert = !openRef.current;
    busyRef.current = false;
    avatar.disabled = false;
    if (restoreAvatarFocus) avatar.focus({ preventScroll: true });
  }, [closeProfileMenu, paintUserPanel]);

  // ── 9. PROFILE ACTIONS: content-sized expansion and pixel-repeated button art ──
  const sizeProfileActions = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    const scale = pixelScale();
    menu.querySelectorAll('button').forEach((button) => {
      const style = getComputedStyle(button);
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const label = button.querySelector('.profile-action-label');
      const icon = button.querySelector('.profile-action-icon');
      if (!label || !icon) return;
      const textWidth = ctx.measureText(label.textContent ?? '').width;
      const iconWidth = parseFloat(getComputedStyle(icon).width);
      const contentWidth = iconWidth + parseFloat(style.getPropertyValue('--action-label-gap')) + textWidth
        + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      button.style.setProperty('--action-open-width', `${Math.ceil(contentWidth / scale) * scale}px`);
    });
  }, []);

  const paintProfileButton = useCallback((button: HTMLButtonElement) => {
    const img = buttonImage.current;
    if (!img || !img.complete || img.naturalWidth !== PROFILE_CONFIG.sheetWidth || img.naturalHeight !== PROFILE_CONFIG.sheetHeight) return;
    const art = button.querySelector('canvas');
    if (!art) return;
    const scale = pixelScale();
    art.width = Math.ceil(button.getBoundingClientRect().width / scale);
    art.height = PROFILE_CONFIG.sheetHeight;
    art.style.width = `${art.width * scale}px`;
    const ctx = art.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const { capWidth, sheetHeight, tileSize, leftCapX, middleX, rightCapX } = PROFILE_CONFIG;
    ctx.drawImage(img, leftCapX, 0, capWidth, sheetHeight, 0, 0, capWidth, sheetHeight);
    for (let x = capWidth; x < art.width - capWidth; x += tileSize) {
      const width = Math.min(tileSize, art.width - capWidth - x);
      ctx.drawImage(img, middleX, 0, width, sheetHeight, x, 0, width, sheetHeight);
    }
    ctx.drawImage(img, rightCapX, 0, capWidth, sheetHeight, art.width - capWidth, 0, capWidth, sheetHeight);
  }, []);

  useEffect(() => {
    const avatar = avatarRef.current, wheel = wheelRef.current, menu = menuRef.current;
    if (!avatar || !wheel || !menu) return;
    let disposed = false;
    // Locked until the sheet is in and the opening has played (the engine owns this flag on the DOM, never as a
    // React prop — React drops clicks on a button whose prop is disabled even after the DOM flag is cleared).
    avatar.disabled = true;

    const img = new Image();
    panelImage.current = img;
    img.onload = async () => {
      if (img.naturalWidth !== PANEL_SHEET.width || img.naturalHeight !== PANEL_SHEET.height) {
        console.error(`[WalletPanel] Wooden-panel.png must remain ${PANEL_SHEET.width}×${PANEL_SHEET.height}; review slicing if changed.`);
        return;
      }
      const wheelPaint = wheel.getContext('2d');
      if (!wheelPaint) return;
      wheelPaint.imageSmoothingEnabled = false;
      wheelPaint.drawImage(img, 48, 0, 64, 64, 0, 0, 64, 64);
      // First load / reload: paint closed before replaying the normal open motion.
      openRef.current = false;
      avatar.setAttribute('aria-expanded', 'false');
      avatar.setAttribute('aria-label', 'Expand wallet panel');
      if (labelRef.current) labelRef.current.inert = true;
      wheel.style.transform = 'rotate(360deg)';
      wheel.dataset.degrees = '360';
      paintUserPanel(0);
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (disposed) return;
      readyRef.current = true;
      artRef.current?.setAttribute('data-ready', 'true');
      await toggleUserPanel();
    };
    img.onerror = () => console.error('[WalletPanel] Wooden-panel.png failed to load.');
    img.src = PANEL_ASSET;

    // Content-sized expansion measured with the loaded font, rounded to the 3px grid.
    sizeProfileActions();
    void document.fonts.ready.then(sizeProfileActions);
    document.fonts.addEventListener('loadingdone', sizeProfileActions);
    // Draw button art directly, repeating pixels instead of stretching during expansion.
    const btnImg = new Image();
    buttonImage.current = btnImg;
    const buttons = Array.from(menu.querySelectorAll('button'));
    const resize = new ResizeObserver((entries) => entries.forEach(({ target }) => {
      if (target.getBoundingClientRect().width) paintProfileButton(target as HTMLButtonElement);
    }));
    buttons.forEach((b) => resize.observe(b));
    btnImg.onload = () => buttons.forEach((b) => { if (b.getBoundingClientRect().width) paintProfileButton(b); });
    btnImg.onerror = () => console.error('[WalletPanel] Button.png failed to load');
    btnImg.src = PROFILE_CONFIG.buttonAsset;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.contains(t) && !labelRef.current?.contains(t)) closeProfileMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); closeProfileMenu(true); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      disposed = true;
      document.fonts.removeEventListener('loadingdone', sizeProfileActions);
      resize.disconnect();
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeProfileMenu, paintProfileButton, paintUserPanel, sizeProfileActions, toggleUserPanel]);

  // The wallet went away (another tab, the extension): nothing to act on any more.
  useEffect(() => { if (!address) closeProfileMenu(); }, [address, closeProfileMenu]);

  const onEdit = () => {
    closeProfileMenu();
    const dialog = dialogRef.current, name = nameRef.current;
    if (!dialog || !name) return;
    name.value = profile?.displayName ?? '';
    setEditorError(null);
    dialog.showModal();
    name.focus();
  };

  const onDisconnect = () => {
    closeProfileMenu();
    invalidateAuthCache();
    disconnect();
    labelRef.current?.focus();
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!address || saving) return;
    const value = nameRef.current?.value.trim() ?? '';
    if ([...value].length > DISPLAY_NAME_MAX) { setEditorError(`Keep it to ${DISPLAY_NAME_MAX} characters.`); return; }
    setSaving(true);
    setEditorError(null);
    try {
      const updated = await api.agent.updateProfile(value || null, await getAuthHeaders());
      queryClient.setQueryData<AgentProfile>(['profile', address], (old) => ({ ...(old ?? updated), ...updated }));
      void queryClient.invalidateQueries({ queryKey: ['profile', address] });
      dialogRef.current?.close();
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Could not save the name.');
    } finally {
      setSaving(false);
    }
  };

  const connectedNow = isConnected && !!address;
  const connected = mounted && connectedNow;
  const connecting = mounted && !connectedNow && picking && (pickerOpen || isConnecting);
  const label = connected ? (profile?.displayName || shortAddress(address)) : 'Connect Wallet';

  return (
    <section aria-label="Wallet and user profile" className="user-section">
      <canvas ref={artRef} aria-hidden="true" className="user-section-art" height={64} id="user-section-art" width={160} />
      <button
        ref={setLabelRef}
        aria-busy={connecting || undefined}
        aria-controls={connected ? 'profile-menu' : undefined}
        aria-expanded={connected ? menuOpen : undefined}
        aria-label={connecting ? 'Connecting wallet' : undefined}
        className="connect-wallet"
        disabled={connecting}
        onClick={() => {
          if (busyRef.current || !openRef.current) return;
          if (!connected) { setPicking(true); openWalletPicker(true); return; }
          setProfileMenu(!menuOpenRef.current);
        }}
        title={connecting ? 'Connecting wallet' : connected ? label : 'Connect Wallet'}
        type="button"
      >
        {connecting ? <span aria-hidden="true" className="wallet-loader" /> : label}
      </button>
      {/* Avatar artwork will occupy the wheel centre; keep the source frame visible. */}
      <div className="user-avatar-press">
        <canvas ref={wheelRef} aria-hidden="true" className="user-avatar-frame" height={64} id="user-avatar-frame" width={64} />
        <button ref={avatarRef} aria-controls="user-section-art" aria-expanded="true" aria-label="Collapse wallet panel" className="user-avatar-slot" onClick={() => void toggleUserPanel()} type="button" />
      </div>
      <div ref={menuRef} aria-label="Profile actions" className="profile-menu" hidden id="profile-menu">
        <button aria-label="Profile" data-profile-action="edit" onClick={onEdit} type="button">
          <canvas aria-hidden="true" />
          <span aria-hidden="true" className="profile-action-icon" />
          <span className="profile-action-label">Profile</span>
        </button>
        <button aria-label="Disconnect" data-profile-action="disconnect" onClick={onDisconnect} title="Disconnect" type="button">
          <canvas aria-hidden="true" />
          <span aria-hidden="true" className="profile-action-icon" />
          <span className="profile-action-label">Disconnect</span>
        </button>
      </div>
      <dialog ref={dialogRef} aria-labelledby="profile-editor-title" className="profile-editor" id="profile-editor" onClose={() => labelRef.current?.focus()}>
        <form onSubmit={onSubmit}>
          <h2 id="profile-editor-title">Edit Profile</h2>
          <label htmlFor="profile-name">Display name</label>
          <input ref={nameRef} autoComplete="off" id="profile-name" maxLength={DISPLAY_NAME_MAX} name="name" />
          <p>Shown in place of your address. Leave it empty to clear it.</p>
          {editorError && <p className="profile-editor-error" role="alert">{editorError}</p>}
          <div className="profile-editor-actions">
            <button onClick={() => dialogRef.current?.close()} type="button">Cancel</button>
            <button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
