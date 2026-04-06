'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Persistent music player — lives in the root layout so audio continues
 * across page navigations. Uses a singleton <audio> element attached to
 * the DOM once and never removed.
 */

let _audio: HTMLAudioElement | null = null;
let _initialized = false;

function getAudio(): HTMLAudioElement {
  if (!_audio) {
    _audio = new Audio('/audio/theme.m4a');
    _audio.loop = true;
    _audio.volume = 0.4;
    _audio.preload = 'auto';
  }
  return _audio;
}

export function MusicToggle() {
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (_initialized) {
      // Reconnect state on re-mount (page navigation)
      const audio = getAudio();
      setPlaying(!audio.paused);
      setReady(true);
      return;
    }
    _initialized = true;
    const audio = getAudio();

    // Restore preference
    const saved = localStorage.getItem('clawbada_music');
    if (saved === 'on') {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }

    setReady(true);
  }, []);

  const toggle = useCallback(() => {
    const audio = getAudio();
    if (audio.paused) {
      audio.play().then(() => {
        setPlaying(true);
        localStorage.setItem('clawbada_music', 'on');
      }).catch(() => {});
    } else {
      audio.pause();
      setPlaying(false);
      localStorage.setItem('clawbada_music', 'off');
    }
  }, []);

  if (!ready) return null;

  return (
    <button
      onClick={toggle}
      title={playing ? 'Pause music' : 'Play music'}
      className="fixed bottom-5 right-5 z-50 size-12 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg hover:scale-110 active:scale-95"
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
