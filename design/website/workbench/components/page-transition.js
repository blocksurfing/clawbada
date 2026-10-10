// Simple content-only entrance. No overlay, route delay, translation or zoom.
export function createPageTransition(main, render, initial) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let current = initial;
  let animation;
  function stop() { animation?.cancel(); animation = undefined; }
  function navigate(slug) {
    if (slug === current) return;
    stop();
    current = slug;
    render(slug);
    if (!reduced.matches) {
      animation = main.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 180, easing: 'ease-out',
      });
    }
  }
  function preferenceChanged() { if (reduced.matches) stop(); }
  reduced.addEventListener('change', preferenceChanged);
  return {
    navigate,
    dispose() { stop(); reduced.removeEventListener('change', preferenceChanged); },
  };
}
