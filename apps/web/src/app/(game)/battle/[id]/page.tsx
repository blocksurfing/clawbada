'use client';

/**
 * Live battle page — real (chain id) and practice (p_<uuid>) battles.
 *   - real, pre-Active: header + the on-chain prep flow (deposit / commit / reveal) for participants
 *   - real, Active+ or practice: the live V3 session (Unity stage or SVG board + HUD + actions)
 */
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { isPracticeId } from '@/lib/battle-protocol';
import { readPracticeOwner } from '@/lib/practice-owner';
import { Badge } from '@/components/ui/badge';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatAddress, formatGold } from '@/lib/format';
import { BattleMoves } from '@/components/game/battle-moves';
import { BattleBackdrop } from '@/components/battle/battle-backdrop';
import { LiveBattle } from '@/components/battle/LiveBattle';
import { cancelBattleEntry, getEntryState, startBattleEntry } from '@/lib/battle-entry';
import { Swords, Loader2, ExternalLink } from 'lucide-react';

const PHASE_LABEL: Record<number, string> = { 0: 'Not created', 1: 'Deposits', 2: 'Team commit', 3: 'Team reveal', 4: 'Live', 5: 'Result under review', 6: 'Settled', 7: 'Cancelled', 8: 'Frozen for review' };

export default function BattlePage() {
  const params = useParams();
  const router = useRouter();
  const battleId = params.id as string;
  const { address: walletAddress } = useAccount();
  const practice = isPracticeId(battleId);
  // A practice battle may belong to a guest session (the Dojo without a wallet). The Dojo records which
  // identity started each battle in this browser; the page acts as that one, so a guest's battle stays the
  // guest's even after a wallet connects, and a wallet's battle is never mistaken for the guest's. Without
  // a record (opened in another browser) it is the wallet, then the guest. A guest identity is PINNED once
  // chosen: connecting a wallet mid-battle must not flip sides or re-authenticate the socket as someone the
  // battle has never heard of. Chain battles keep the wallet, as before.
  const identity = useAuth({ allowGuest: practice });
  const [owner, setOwner] = useState<string | null | undefined>(undefined);   // undefined = not read yet (client only)
  useEffect(() => { setOwner(practice ? readPracticeOwner(battleId) : null); }, [practice, battleId]);
  const pinnedGuest = useRef<string | null>(null);
  const guest = identity.guestAddress;
  let address: string | undefined = walletAddress;
  let identityPending = false;
  if (practice) {
    if (pinnedGuest.current) {
      address = pinnedGuest.current;
    } else if (owner === undefined || !identity.guestReady) {
      address = undefined; identityPending = true;
    } else if (owner && guest && owner === guest.toLowerCase()) {
      address = guest;                                   // the guest's own battle: no need to wait for wagmi
    } else if (owner) {
      address = walletAddress && owner === walletAddress.toLowerCase() ? walletAddress : undefined;
      identityPending = !address && identity.resolving;
    } else {
      address = walletAddress ?? guest ?? undefined;
      identityPending = !address && identity.resolving;
    }
    if (address && guest && address === guest && !pinnedGuest.current) pinnedGuest.current = guest;
  }
  // Review tools (designer VFX passes, harness): ?auto=1 lets the bot policy play this wallet's
  // turns; ?speed=2 scales Unity playback; ?stay=1 keeps the view open after the result instead
  // of returning to the arena page. Read after mount to avoid a Suspense boundary.
  const [review, setReview] = useState<{ autoPlay: boolean; speed: number; stay: boolean }>({ autoPlay: false, speed: 1, stay: false });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const speed = Number(q.get('speed') ?? '1');
    setReview({ autoPlay: q.get('auto') === '1', speed: Number.isFinite(speed) && speed > 0 ? speed : 1, stay: q.get('stay') === '1' });
  }, []);
  // After the result the view closes itself and comes back here. A practice session is gone
  // once it ends (in-memory), so Back must not lead into it: replace. A chain battle keeps its
  // settlement page reachable: push.
  // Practice (the Dojo) is gone once it ends: replace, so Back never lands in it. A chain battle goes back to
  // the Shell, where its settlement stays reachable from History.
  const leave = useCallback(() => {
    console.log(`[BattlePage] leaving ${battleId} → ${practice ? '/dojo' : '/game'}`);
    if (practice) router.replace('/dojo');
    else router.push('/game');
  }, [practice, router, battleId]);

  const { data: battleData, isLoading, error } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => api.combat.getBattle(battleId),
    enabled: !practice,
    refetchInterval: (q) => {
      const phase = q.state.data?.chain?.phase ?? 0;
      return phase === 6 || phase === 7 ? false : phase === 8 ? 60_000 : 5_000;
    },
  });

  // The entry loading screen (lib/battle-entry.ts). The Train click started it before navigating here; a page
  // opened directly (a reload, a shared link) starts it itself, so every visit gets the same sequence (owner
  // decision). It covers the page only while the live view is about to mount — never a "belongs to another
  // session" notice or the on-chain prep steps — and leaving the page drops it.
  const liveNow = practice ? !!address : (battleData?.chain?.phase ?? 0) >= 4;
  const identityUndecided = practice && !address && identityPending;
  useEffect(() => {
    if (liveNow) { if (getEntryState().phase === 'idle') startBattleEntry({ kind: practice ? 'practice' : 'battle' }); }
    else if (!identityUndecided && !isLoading) cancelBattleEntry();
  }, [liveNow, identityUndecided, isLoading, practice]);
  useEffect(() => () => cancelBattleEntry(), []);

  if (practice) {
    return (
      <BattleBackdrop kind="dojo">
          {address ? (
            <LiveBattle battleId={battleId} address={address} autoPlay={review.autoPlay} speed={review.speed} stay={review.stay} onClose={leave} />
          ) : identityPending ? (
            <FrostedPanel className="py-10 text-center text-sm text-text-secondary flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Opening your practice battle…
            </FrostedPanel>
          ) : (
            <FrostedPanel className="py-10 text-center text-sm text-text-secondary">
              This practice battle belongs to another session.{' '}
              <Link href="/dojo" className="underline underline-offset-2 hover:text-foreground">Start a new one from the Dojo.</Link>
            </FrostedPanel>
          )}
      </BattleBackdrop>
    );
  }

  if (isLoading) {
    return (
      <PageBackground variant="deep">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
          <Loader2 className="size-6 animate-spin text-text-secondary" />
          <p className="text-sm text-text-secondary mt-3">Loading battle...</p>
        </div>
      </PageBackground>
    );
  }
  if (error || !battleData) {
    return (
      <PageBackground variant="deep">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Swords className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Battle Not Found</h1>
          <p className="text-sm text-text-secondary">Battle #{battleId} doesn&apos;t exist or hasn&apos;t started yet.</p>
        </div>
      </PageBackground>
    );
  }

  const { chain, db } = battleData;
  const phase = chain?.phase ?? 0;
  const lower = address?.toLowerCase();
  const participant = !!lower && !!chain && (chain.playerA.toLowerCase() === lower || chain.playerB.toLowerCase() === lower);
  const live = phase >= 4;
  const settled = phase === 6 || phase === 7;
  const winner = chain && chain.winner !== '0x0000000000000000000000000000000000000000' ? chain.winner : null;

  // In play (and through the result): the arena alone on a faded Shell, like a practice battle on the Dojo.
  if (live) {
    return (
      <BattleBackdrop kind="shell">
        <LiveBattle battleId={battleId} address={address} spectate={!participant} autoPlay={review.autoPlay} speed={review.speed} stay={review.stay} onClose={leave} />
        {/* Result in review (5) or frozen for review (8): say so — players have nothing to do */}
        {chain && (phase === 5 || phase === 8) && participant && address && (
          <div className="mt-4 max-w-6xl mx-auto"><BattleMoves battleId={battleId} address={address} battleData={battleData} /></div>
        )}
      </BattleBackdrop>
    );
  }

  return (
    <PageBackground variant="deep">
      <div className="p-4 md:p-8 space-y-4 max-w-6xl mx-auto">
        <Header
          title={`Battle #${battleId}`}
          subtitle={PHASE_LABEL[phase] ?? `Phase ${phase}`}
          right={settled ? <Badge className="bg-teal/15 text-teal border-0 font-pixel text-[10px]">{winner ? 'Settled' : 'Draw'}</Badge> : undefined}
        />

        {chain && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoCard label="Player A" value={formatAddress(chain.playerA)} accent={!!winner && winner.toLowerCase() === chain.playerA.toLowerCase()} />
            <InfoCard label="Player B" value={formatAddress(chain.playerB)} accent={!!winner && winner.toLowerCase() === chain.playerB.toLowerCase()} />
            <InfoCard label="Stake" value={formatGold(chain.stakeAmount)} />
            {db?.winnerPayout ? <InfoCard label="Payout" value={formatGold(db.winnerPayout)} accent /> : <InfoCard label="Phase" value={PHASE_LABEL[phase] ?? String(phase)} />}
          </div>
        )}

        {/* Pre-battle on-chain steps for participants */}
        {chain && !live && participant && address && (
          <BattleMoves battleId={battleId} address={address} battleData={battleData} />
        )}
        {chain && !live && !participant && (
          <FrostedPanel className="py-8 text-center text-sm text-text-secondary">
            <Loader2 className="size-5 mx-auto animate-spin mb-2" />
            Waiting for both teams to deposit and reveal…
          </FrostedPanel>
        )}


        {db?.battleId && (
          <p className="text-center text-xs text-text-secondary pt-4">
            <a href={`https://basescan.org/search?q=${battleId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ocean transition-colors">
              View on Basescan <ExternalLink className="size-3" />
            </a>
          </p>
        )}
      </div>
    </PageBackground>
  );
}

function Header({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Swords className="size-5 text-coral" />
          <h1 className="font-pixel text-xl text-foreground">{title}</h1>
        </div>
        <p className="text-sm text-text-secondary mt-1">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function InfoCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <FrostedPanel className="p-3">
      <p className="font-pixel text-[10px] text-text-secondary">{label}</p>
      <p className={`text-sm font-mono font-medium mt-0.5 ${accent ? 'text-text-accent' : 'text-foreground'}`}>{value}</p>
    </FrostedPanel>
  );
}
