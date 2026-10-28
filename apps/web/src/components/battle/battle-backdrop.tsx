'use client';

import './battle-windowed.css';

/**
 * The battle page out of fullscreen (owner 2026-10-28): the arena on a faded copy of the page you came from — the Dojo
 * for practice (and friend) battles, The Shell for staked ones — stripped of every control. Only the wallet (the
 * site chrome) and the way back into fullscreen stay. The Shell is drawn from its own scenery layers (no stages,
 * rocks-as-buttons, seaweed or shark); both are cover-scaled from the bottom centre like the real pages.
 */
export function BattleBackdrop({ kind, children }: { kind: 'dojo' | 'shell'; children: React.ReactNode }) {
  return (
    <div className="battle-windowed" data-backdrop={kind}>
      <div aria-hidden="true" className="battle-backdrop" data-backdrop-art={kind} />
      <div className="battle-windowed-content">{children}</div>
    </div>
  );
}
