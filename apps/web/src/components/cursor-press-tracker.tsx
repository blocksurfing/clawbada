'use client';

import { useEffect } from 'react';

export function CursorPressTracker() {
  useEffect(() => {
    const root = document.documentElement;
    const add = () => root.classList.add('cursor-pressed');
    const remove = () => root.classList.remove('cursor-pressed');

    window.addEventListener('mousedown', add);
    window.addEventListener('mouseup', remove);
    window.addEventListener('blur', remove);
    window.addEventListener('mouseleave', remove);
    document.addEventListener('visibilitychange', remove);

    return () => {
      window.removeEventListener('mousedown', add);
      window.removeEventListener('mouseup', remove);
      window.removeEventListener('blur', remove);
      window.removeEventListener('mouseleave', remove);
      document.removeEventListener('visibilitychange', remove);
    };
  }, []);

  return null;
}
