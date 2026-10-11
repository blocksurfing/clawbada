import { redirect } from 'next/navigation';

/**
 * Battle is a modal on the Shell now (Nzib's basecamp, 2026-10-11) and practice lives in the Dojo. The old
 * address keeps working: it opens the Shell with the Battle setup modal up.
 */
export default function LegacyBattlePage() {
  redirect('/game?battle=1');
}
