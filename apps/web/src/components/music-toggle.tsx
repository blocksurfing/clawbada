'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { bringThemeBackAfterBattle, isArenaMusicActive, isThemeDueBack } from '@/lib/arena-music';
import { getMusicPref, setMusicPref, MUSIC_EVENT } from '@/lib/audio-prefs';
import { musicPress, siteMusicOn } from '@/lib/site-music';

/**
 * Persistent music player — lives in the root layout so audio continues
 * across page navigations. Uses a singleton <audio> element attached to
 * the DOM once and never removed.
 *
 * Two buttons drive it through `useSiteMusic`: this floating one (the marketing pages, and every page below the
 * desktop breakpoint) and the pixel toggle beside the logo in Nzib's chrome (`chrome/pixel-music-toggle.tsx`,
 * game pages at ≥ lg) — so on a game page at desktop width this one hides.
 */

let _audio: HTMLAudioElement | null = null;
let _initialized = false;

export function getThemeAudio(): HTMLAudioElement {
  if (!_audio) {
    _audio = new Audio('/audio/theme.m4a');
    _audio.loop = true;
    _audio.volume = 0.4;
    _audio.preload = 'auto';
  }
  return _audio;
}

/** Marketing routes keep the floating button at every width; everything else carries the pixel chrome at ≥ lg. */
const MARKETING_PATHS = ['/', '/agents', '/faucet'];

/** Is the theme on, as the buttons show it — wanted, and playing or only silenced for a battle (lib/site-music.ts)? */
const themeOn = () => siteMusicOn(getMusicPref(), !getThemeAudio().paused, isThemeDueBack());

/** The site theme's state + toggle, shared by every music button. */
export function useSiteMusic() {
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const audio = getThemeAudio();
    if (!_initialized) {
      _initialized = true;
      // Restore preference. Most browsers refuse to play before the visitor has interacted with the page: the theme
      // then stays off, and shows as off, until a button is pressed.
      const saved = localStorage.getItem('clawbada_music');
      if (saved === 'on') audio.play().catch(() => {});
    }
    // Follow the theme itself (it starts, a battle silences it, it comes back) and a press on the other button.
    const sync = () => setPlaying(themeOn());
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    window.addEventListener(MUSIC_EVENT, sync);
    sync();
    setReady(true);
    return () => {
      audio.removeEventListener('play', sync);
      audio.removeEventListener('pause', sync);
      window.removeEventListener(MUSIC_EVENT, sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const audio = getThemeAudio();
    // A press reverses what the button shows, not the stored preference: on a new browser, or one that refused to
    // autoplay a stored "on", nothing is playing and the first press must start the theme (lib/site-music.ts).
    const press = musicPress(themeOn(), isArenaMusicActive());
    if (press === 'stop') audio.pause();
    else if (press === 'start') audio.play().catch(() => {});
    else bringThemeBackAfterBattle();   // never inside a battle view
    // Stored last: storing announces the change, and every button then reads the state the lines above left.
    setMusicPref(press !== 'stop');   // the SITE theme only — battle music is its own control (in-battle options menu)
  }, []);

  return { playing, ready, toggle };
}

export function MusicToggle() {
  const { playing, ready, toggle } = useSiteMusic();
  const pathname = usePathname();
  const pixelChrome = !MARKETING_PATHS.includes(pathname ?? '/');

  if (!ready) return null;

  return (
    <button
      onClick={toggle}
      title={playing ? 'Pause music' : 'Play music'}
      data-site-chrome
      className={`site-music-fab fixed bottom-5 right-5 z-50 size-12 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg hover:scale-110 active:scale-95${pixelChrome ? ' md:hidden' : ''}`}
      style={{
        background: playing
          ? 'linear-gradient(135deg, #fbbf24 0%, #d4a017 100%)'
          : 'linear-gradient(135deg, #0f2942 0%, #0a1628 100%)',
        border: playing
          ? '2px solid rgba(251,191,36,0.6)'
          : '2px solid rgba(251,191,36,0.3)',
      }}
    >
      {playing ? (
        // Volume on icon — gold button, dark icon
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0a1628" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#0a1628" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ) : (
        // Volume off icon — navy button, gold icon
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#fbbf24" opacity="0.3" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      )}
    </button>
  );
}
