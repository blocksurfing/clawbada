'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PIXEL_ASSETS, applyChromePixelScale } from '@/components/pixel/pixel-assets';
import { PixelSprite } from '@/components/pixel/pixel-sprite';
import { usePixelPanel } from '@/components/shell/pixel-panel';
import { useButtonShine } from './use-button-shine';
import construction from '../../../public/ui/construction/Under_Construction.json';
import '@/components/chrome/chrome.css';
import './coming-soon.css';

/**
 * Nzib's Coming Soon page (design/website e35532b + 6d32be9): the lobsters at work, the heading, and the way into the
 * Dojo — the one part of the site open while the gate is on (lib/site-gate.ts, owner 2026-11-06). Socials: X, and
 * Discord marked "Currently invite only" (the server is invite-only; owner 2026-11-06 dropped the Docs icon here).
 */
const FRAMES = construction.frames;
const FRAME = FRAMES[0].frame;
const CYCLE_MS = FRAMES.reduce((sum, f) => sum + f.duration, 0);

export function ComingSoon() {
  // The page's pixel size follows the one-pixel-size rule like the chrome (no sidebar here to set it).
  useEffect(() => {
    applyChromePixelScale();
    const onResize = () => applyChromePixelScale();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const buttonRef = useRef<HTMLAnchorElement>(null);
  const artRef = useRef<HTMLCanvasElement>(null);
  const pressedRef = useRef<HTMLCanvasElement>(null);
  const shineRef = useRef<HTMLCanvasElement>(null);
  usePixelPanel(buttonRef, artRef, PIXEL_ASSETS.globalGoldenButton, pressedRef);
  useButtonShine(buttonRef, artRef, shineRef);

  // Discord: a tap (or hover / focus) says it is invite-only; it never navigates.
  const [inviteNote, setInviteNote] = useState(false);
  useEffect(() => {
    if (!inviteNote) return;
    const t = setTimeout(() => setInviteNote(false), 2600);
    return () => clearTimeout(t);
  }, [inviteNote]);

  const art = {
    '--art-width': FRAME.w,
    '--art-height': FRAME.h,
    '--sheet-width': construction.meta.size.w,
    animationDuration: `${CYCLE_MS}ms`,
    animationTimingFunction: `steps(${FRAMES.length})`,
  } as CSSProperties;

  return (
    <main className="coming-soon" aria-labelledby="coming-soon-title">
      <div className="coming-soon-content">
        <div className="construction-art" role="img" aria-label="Lobsters at work with a wheelbarrow" style={art} />
        <h1 id="coming-soon-title"><span className="coming-soon-heading-lead">WE’RE</span> <span className="coming-soon-heading-end">COMING SOON</span></h1>
        <p>
          <span className="coming-soon-copy-desktop">Clawbada is getting ready. In the meantime, step into the Dojo and put your skills to the test.</span>
          <span className="coming-soon-copy-mobile">Clawbada is getting ready. Step into the Dojo and put your skills to the test.</span>
        </p>
        <div className="coming-soon-actions">
          <Link ref={buttonRef} className="pixel-button coming-soon-action" data-pixel-panel="globalGoldenButton" data-button-shine href="/dojo" data-testid="enter-dojo">
            <canvas ref={pressedRef} aria-hidden="true" className="pixel-panel-art pixel-panel-art--pressed" />
            <canvas ref={artRef} aria-hidden="true" className="pixel-panel-art pixel-panel-art--normal" />
            <canvas ref={shineRef} aria-hidden="true" className="pixel-button-shine" />
            ENTER DOJO
          </Link>
          <div className="coming-soon-socials">
            <a className="pixel-icon-button" href="https://x.com/clawbada" target="_blank" rel="noopener noreferrer" aria-label="X / Twitter">
              <PixelSprite asset="socialXNormal" className="icon-normal" />
              <PixelSprite asset="socialXPressed" className="icon-pressed" />
            </a>
            <span className="coming-soon-invite">
              <button
                className="pixel-icon-button"
                type="button"
                aria-label="Discord — currently invite only"
                aria-describedby="discord-invite-note"
                data-testid="discord"
                onClick={() => setInviteNote(true)}
              >
                <PixelSprite asset="socialDiscordNormal" className="icon-normal" />
                <PixelSprite asset="socialDiscordPressed" className="icon-pressed" />
              </button>
              <span id="discord-invite-note" role="status" className="coming-soon-invite-note" data-shown={inviteNote ? 'true' : undefined}>
                Currently invite only
              </span>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
