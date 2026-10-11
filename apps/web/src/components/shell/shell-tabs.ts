/**
 * The Queue / Active / History overlays — Nzib's `components/shell-tabs.js` (baseline 3295433): three
 * independent toggle buttons on the right (there is no Arena button). A click slides its panel in from the right
 * (220 ms, 48 px, cubic-bezier(.22,1,.36,1)); the same button again slides it out and closes it; a different button
 * switches panels, only one logically active. Panels overlay the room and never displace stages, characters,
 * lighting or Battle. A closing panel becomes inert at once and is hidden after its exit motion. Escape closes
 * the active panel and restores focus to its opener; Arrow Up/Down and Home/End move focus between buttons.
 * React renders the buttons, the panels and their live content; this module owns `aria-expanded`, `hidden`,
 * `inert` and the motion.
 */
export interface ShellTabs {
  /** Open a panel from code (Find Match opens the queue). */
  open(view: string): void;
  close(): void;
  dispose(): void;
}

export function mountShellTabs(room: HTMLElement): ShellTabs {
  const buttons = [...room.querySelectorAll<HTMLButtonElement>('[data-shell-tab]')];
  const panels = [...room.querySelectorAll<HTMLElement>('.shell-records')];
  const abort = new AbortController();
  const motions = new Map<HTMLElement, Animation>();
  let active: HTMLButtonElement | null = null;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function show(button: HTMLButtonElement | null) {
    active = button;
    room.dataset.shellView = button?.dataset.shellTab || 'closed';
    buttons.forEach((item) => item.setAttribute('aria-expanded', String(item === button)));
    panels.forEach((panel) => {
      const opening = panel.id === button?.getAttribute('aria-controls');
      motions.get(panel)?.cancel();
      motions.delete(panel);
      panel.inert = !opening;
      if (!opening && panel.hidden) return;
      panel.hidden = false;
      const frames = [{ transform: 'translateX(48px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }];
      const motion = panel.animate(opening ? frames : [...frames].reverse(), {
        duration: reduced() ? 0 : 220, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both',
      });
      motions.set(panel, motion);
      motion.finished.then(() => {
        if (motions.get(panel) !== motion) return;
        panel.hidden = !opening;
        motions.delete(panel);
        motion.cancel();
      }).catch(() => {});
    });
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => show(active === button ? null : button), { signal: abort.signal });
    button.addEventListener('keydown', (event) => {
      let next: number | undefined;
      if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].focus({ preventScroll: true });
    }, { signal: abort.signal });
  });
  room.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !active) return;
    const opener = active;
    show(null);
    opener.focus({ preventScroll: true });
  }, { signal: abort.signal });
  show(null);
  return {
    open(view) { const button = buttons.find((b) => b.dataset.shellTab === view); if (button && active !== button) show(button); },
    close() { show(null); },
    dispose() { abort.abort(); motions.forEach((motion) => motion.cancel()); motions.clear(); },
  };
}
