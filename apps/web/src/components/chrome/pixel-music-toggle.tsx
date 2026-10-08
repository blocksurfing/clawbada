'use client';

import { useSiteMusic } from '@/components/music-toggle';

/**
 * Nzib's music toggle: beside the logo, above the sidebar pole, moving with the logo in the compact state. The
 * on/off icons are the two 16×16 tiles of Music.png (left = on). It drives the same site theme as the floating
 * button (`useSiteMusic`) and never reaches the pole or the brand trigger.
 */
export function PixelMusicToggle() {
  const { playing, ready, toggle } = useSiteMusic();
  return (
    <button
      aria-label={playing ? 'Turn music off' : 'Turn music on'}
      aria-pressed={playing}
      className="music-toggle"
      disabled={!ready}
      onClick={(e) => { e.stopPropagation(); toggle(); }}
      title={playing ? 'Music on' : 'Music off'}
      type="button"
    />
  );
}
