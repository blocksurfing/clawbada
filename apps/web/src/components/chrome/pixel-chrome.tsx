'use client';

import './chrome.css';
import { PixelSidebar } from './pixel-sidebar';
import { WalletPanel } from './wallet-panel';
import { DevBurnerButton } from '@/components/dev-burner-button';

/**
 * Nzib's desktop chrome for the game pages (2026-10-08): the rolling pixel sidebar with the wordmark and music
 * toggle, and the wallet/profile panel at the top-right. Shown from the `lg` breakpoint; below it the game shell
 * keeps its bottom nav (his narrow-screen pass is still to come). `data-site-chrome` lets a fullscreen battle hide
 * the whole thing (globals.css). The dev burner chip stays reachable for the browser harness.
 */
export function PixelChrome() {
  return (
    <div className="pixel-chrome hidden lg:block" data-site-chrome>
      <PixelSidebar />
      <WalletPanel />
      <div className="pixel-chrome-dev">
        <DevBurnerButton />
      </div>
    </div>
  );
}
