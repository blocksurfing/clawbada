'use client';

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { StakeQuoteResponse } from '@/lib/api';
import { formatGoldWei } from '@/lib/format';
import { PixelPanel } from './pixel-panel';

/**
 * The Battle setup modal — Nzib's `components/battle-modal.js` + `pages/battle.html` (baseline 3295433): opens
 * over the Shell without leaving it or resetting the lineup (slides up 280 ms, cubic-bezier(.22,1,.36,1); closes
 * with ease-in; Escape and a click outside close it; focus returns to the Battle button). His arena select was a
 * preview setting; the real queue needs a STAKE BRACKET, so the select is the bracket with the live amounts, and
 * the arena is stated as what it really is: the matched teams' tier. Find Match is live only when the three picks
 * form one of the player's teams (the Shell decides and passes the reason); otherwise the reason is shown.
 */
export interface BattleEligibility {
  ok: boolean;
  reason: string;
  /** Show a link to the Teams page with the reason. */
  teamsLink?: boolean;
  teamId?: string;
}

export interface LineupSummaryItem { name: string; classIndex: number; tier?: string }

interface Props {
  open: boolean;
  onClose: () => void;
  lineup: LineupSummaryItem[];
  stakes: StakeQuoteResponse | undefined;
  bracket: number;
  onBracket: (bracket: number) => void;
  eligibility: BattleEligibility;
  joining: boolean;
  onFindMatch: () => void;
}

const BRACKET_LABELS = ['Low', 'Mid', 'High'] as const;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function BattleModal({ open, onClose, lineup, stakes, bracket, onBracket, eligibility, joining, onFindMatch }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const motion = useRef<Animation | null>(null);
  const opener = useRef<Element | null>(null);
  const closing = useRef(false);

  const close = useCallback(async () => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open || closing.current) return;
    closing.current = true;
    motion.current?.cancel();
    const duration = reduced() ? 0 : 280;
    motion.current = dialog.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(100vh)', opacity: 0 }], { duration, easing: 'ease-in', fill: 'forwards' });
    try { await motion.current.finished; } catch { closing.current = false; return; }
    dialog.close();
    motion.current.cancel();
    closing.current = false;
    const back = opener.current;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    onClose();
  }, [onClose]);

  // Open / close follow the prop; the dialog element owns the modal state and the motion.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      closing.current = false;
      dialog.showModal();
      motion.current = dialog.animate([{ transform: 'translateY(100vh)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: reduced() ? 0 : 280, easing: 'cubic-bezier(.22,1,.36,1)' });
      dialog.querySelector<HTMLElement>('.battle-modal-close')?.focus({ preventScroll: true });
    } else if (!open && dialog.open) {
      void close();
    }
  }, [open, close]);

  const onCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => { e.preventDefault(); void close(); };
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog || e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) void close();
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="battle-modal-title" className="battle-modal" data-page="battle" onCancel={onCancel} onClick={onBackdrop}>
      <header className="battle-modal-header">
        <h1 id="battle-modal-title">Battle</h1>
        <button aria-label="Close Battle" className="battle-modal-close" onClick={() => void close()} type="button">Close</button>
      </header>
      <PixelPanel aria-labelledby="arena-title" className="battle-lobby">
        <header className="lobby-heading">
          <div>
            <h2 id="arena-title">Your lineup</h2>
            <p>Picked in the Shell — it stays as it is.</p>
          </div>
        </header>
        <ul className="lobby-summary" aria-label="Lineup">
          {[0, 1, 2].map((i) => {
            const item = lineup[i];
            return (
              <li key={i}>
                {item ? (
                  <>
                    <span aria-hidden="true" className="class-icon" style={{ '--class-frame': item.classIndex } as React.CSSProperties} />
                    {item.name}{item.tier ? ` · ${item.tier}` : ''}
                  </>
                ) : `Slot ${i + 1}: empty`}
              </li>
            );
          })}
        </ul>
        <div className="arena-choice">
          <label htmlFor="battle-bracket">Stake bracket</label>
          <select aria-describedby="arena-preview-note" id="battle-bracket" onChange={(e) => onBracket(Number(e.target.value))} value={bracket}>
            {BRACKET_LABELS.map((label, idx) => {
              const wei = stakes?.brackets[idx]?.stakeWei;
              return <option key={label} value={idx}>{label}{wei ? ` — ${formatGoldWei(BigInt(wei))} $GOLD` : ''}</option>;
            })}
          </select>
          <p className="battle-help" id="arena-preview-note">
            Winner takes both stakes minus the 10% fee. Stakes follow the mining rate and are fixed when your match is created. The arena follows the matched teams&rsquo; tier.
          </p>
        </div>
        <footer className="battle-start">
          <div>
            <h2>{eligibility.ok ? 'Ready to queue' : 'Not ready yet'}</h2>
            <p className="battle-help" id="battle-unavailable">
              {eligibility.reason}
              {eligibility.teamsLink && <> <Link href="/game/teams">Build it on Teams.</Link></>}
            </p>
          </div>
          <button aria-describedby="battle-unavailable" className="pixel-button" disabled={!eligibility.ok || joining} onClick={onFindMatch} type="button">
            {joining ? 'Joining…' : 'Find Match'}
          </button>
        </footer>
      </PixelPanel>
    </dialog>
  );
}
