'use client';

/**
 * Live battle page — real (chain id) and practice (p_<uuid>) battles.
 *   - real, pre-Active: header + the on-chain prep flow (deposit / commit / reveal) for participants
 *   - real, Active+ or practice: the live V3 session (Unity stage or SVG board + HUD + actions)
 */
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { api } from '@/lib/api';
import { isPracticeId } from '@/lib/battle-protocol';
import { Badge } from '@/components/ui/badge';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatAddress, formatClaw } from '@/lib/format';
import { BattleMoves } from '@/components/game/battle-moves';
import { LiveBattle } from '@/components/battle/LiveBattle';
import { Swords, Loader2, ExternalLink } from 'lucide-react';

const PHASE_LABEL: Record<number, string> = { 0: 'Not created', 1: 'Deposits', 2: 'Team commit', 3: 'Team reveal', 4: 'Live', 5: 'Result proposed', 6: 'Settled', 7: 'Cancelled' };

export default function BattlePage() {
  const params = useParams();
  const battleId = params.id as string;
  const { address } = useAccount();
  const practice = isPracticeId(battleId);

  const { data: battleData, isLoading, error } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => api.combat.getBattle(battleId),
    enabled: !practice,
    refetchInterval: (q) => {
      const phase = q.state.data?.chain?.phase ?? 0;
      return phase >= 6 ? false : 5_000;
    },
  });

  if (practice) {
    return (
      <PageBackground variant="deep">
        <div className="p-4 md:p-8 space-y-4 max-w-6xl mx-auto">
          <Header title="Practice battle" subtitle="Off-chain — no stakes, no rating. Beat the bot." />
          {address ? (
            <LiveBattle battleId={battleId} address={address} />
          ) : (
            <FrostedPanel className="py-10 text-center text-sm text-text-secondary">Connect the wallet that started this practice battle.</FrostedPanel>
          )}
        </div>
      </PageBackground>
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
  const settled = phase >= 6;
  const winner = chain && chain.winner !== '0x0000000000000000000000000000000000000000' ? chain.winner : null;

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
            <InfoCard label="Stake" value={formatClaw(chain.stakeAmount)} />
            {db?.winnerPayout ? <InfoCard label="Payout" value={formatClaw(db.winnerPayout)} accent /> : <InfoCard label="Phase" value={PHASE_LABEL[phase] ?? String(phase)} />}
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

        {/* Live session (participants act, everyone else spectates) */}
        {live && <LiveBattle battleId={battleId} address={address} spectate={!participant} />}

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
