// Independent overlay toggles; basecamp nodes and selections stay untouched.
export function mountShellTabs(root) {
  const room = root.querySelector('.shell-room');
  if (!room) return () => {};
  const buttons = [...room.querySelectorAll('[data-shell-tab]')];
  const panels = [...room.querySelectorAll('.shell-records')];
  const abort = new AbortController();
  const motions = new Map();
  let active = null;
  function show(button) {
    active = button;
    room.dataset.shellView = button?.dataset.shellTab || 'closed';
    buttons.forEach(item => item.setAttribute('aria-expanded', String(item === button)));
    panels.forEach(panel => {
      const opening = panel.id === button?.getAttribute('aria-controls');
      motions.get(panel)?.cancel();
      motions.delete(panel);
      panel.inert = !opening;
      if (!opening && panel.hidden) return;
      panel.hidden = false;
      const frames = [{transform:'translateX(48px)',opacity:0},{transform:'translateX(0)',opacity:1}];
      const motion = panel.animate(opening ? frames : [...frames].reverse(), {
        duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220,
        easing:'cubic-bezier(.22,1,.36,1)', fill:'both'
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
    button.addEventListener('click', () => show(active === button ? null : button), {signal:abort.signal});
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].focus({preventScroll:true});
    }, {signal:abort.signal});
  });
  room.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active) return;
    const opener = active;
    show(null);
    opener.focus({preventScroll:true});
  }, {signal:abort.signal});
  show(null);
  return () => { abort.abort(); motions.forEach(motion => motion.cancel()); motions.clear(); };
}
