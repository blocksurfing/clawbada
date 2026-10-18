/**
 * Which identity started a practice battle in THIS browser — a wallet address or a guest session's
 * throwaway address (lowercase, as the API reports `session.playerA`). The Dojo records it when a battle
 * starts; the battle page reads it to act as that identity, so a guest's battle stays the guest's even
 * after a wallet connects, and a wallet's battle is never mistaken for the guest's. Per-browser only:
 * a battle opened in another browser has no record and the page falls back to the wallet, then the guest.
 */
const PREFIX = 'clawbada.practice.owner.';

export function rememberPracticeOwner(battleId: string, owner: string | undefined): void {
  if (!owner) return;
  try {
    window.localStorage.setItem(PREFIX + battleId, owner.toLowerCase());
  } catch {
    /* private mode, quota — the page falls back to wallet-then-guest */
  }
}

export function readPracticeOwner(battleId: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + battleId);
  } catch {
    return null;
  }
}
