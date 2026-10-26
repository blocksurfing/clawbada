// Authored dark arena: frame 2 of arena/Dojo.aseprite, exported intact.
// Background-only restoration; current UI remains unchanged.
export const dojoArtLayers = [
  new URL('../assets/dojo/Dojo_Dark.png', import.meta.url).href,
];

export function mountDojoArt(root) {
  if (root.dataset.page !== 'dojo') return () => {};
  const backdrop = document.createElement('div');
  backdrop.className = 'dojo-arena';
  backdrop.setAttribute('aria-hidden', 'true');
  for (const src of dojoArtLayers) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    image.width = 640;
    image.height = 360;
    image.draggable = false;
    backdrop.append(image);
  }
  // Outside the scrolling/transformed page: always cover the full viewport.
  document.body.prepend(backdrop);
  return () => backdrop.remove();
}
