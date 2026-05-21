'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type RoundData } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatAddress, formatClaw, formatClawWei } from '@/lib/format';
import { BattleViewer } from '@/components/game/battle-viewer';
import type { BattleLobsterConfig } from '@/lib/battle-anim/types';
import type { LobsterData, TeamData } from '@/lib/api';
import { Swords, Loader2, Trophy, ExternalLink, Shield, Zap } from 'lucide-react';

const MOVE_LABELS = ['Attack', 'Defend', 'Special'] as const;
const MOVE_COLORS = ['text-coral', 'text-ocean', 'text-claw-gold'] as const;
const MOVE_ICONS = ['Zap', 'Shield', 'Sparkles'] as const;

/** Build BattleLobsterConfig[] from two teams' lobster data */
function buildLobsterConfigs(
  teamA: TeamData | undefined,
  teamB: TeamData | undefined,
): BattleLobsterConfig[] {
  const configs: BattleLobsterConfig[] = [];
  for (const [side, team] of [['a', teamA], ['b', teamB]] as const) {
    const lobsters = team?.lobsters ?? [];
    for (let slot = 0; slot < 3; slot++) {
      const l = lobsters[slot];
      configs.push({
        id: `${side}${slot}`,
        dna: l?.dna ?? '0',
        classId: l?.class ?? 0,
        tier: l?.evolutionTier ?? 1,
        side,
        slot,
        maxHp: l ? Number(l.stats.hp) * 5 : 1000, // HP scaled ×5 for battle pacing
      });
    }
  }
  return configs;
}

/** Determine battle tier from lobster tiers (minimum across all lobsters, at least Evolved=1) */
function determineBattleTier(configs: BattleLobsterConfig[]): number {
  if (configs.length === 0) return 1;
  return Math.max(1, Math.min(...configs.map(c => c.tier)));
}

export default function BattleSpectatorPage() {
  const params = useParams();
  const battleId = params.id as string;

  const { data: battleData, isLoading: loadingBattle, error: battleError } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => api.combat.getBattle(battleId),
    refetchInterval: 5_000,
  });

  const { data: roundsData } = useQuery({
    queryKey: ['battleRounds', battleId],
    queryFn: () => api.combat.getRounds(battleId),
    refetchInterval: 3_000,
  });

  // PR-B X1: when battles.status=0 (pending_create), the API returns chain=null
  // until the engine operator worker confirms createBattle on chain. Render a
  // "Creating battle..." UI in that window; the polling above (5s) will pick up
  // the status=1 flip and re-render the live battle.
  const pendingCreate = battleData?.db?.status === 0 || battleData?.chain == null;

  // Fetch team data for both sides (needed for battle animation viewer)
  const teamIdA = battleData?.chain?.teamIdA;
  const teamIdB = battleData?.chain?.teamIdB;

  const { data: teamA } = useQuery({
    queryKey: ['team', teamIdA],
    queryFn: () => api.teams.get(teamIdA!),
    enabled: !!teamIdA,
  });

  const { data: teamB } = useQuery({
    queryKey: ['team', teamIdB],
    queryFn: () => api.teams.get(teamIdB!),
    enabled: !!teamIdB,
  });

  if (loadingBattle) {
    return (
      <PageBackground variant="deep">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
          <Loader2 className="size-6 animate-spin text-text-secondary" />
          <p className="text-sm text-text-secondary mt-3">Loading battle...</p>
        </div>
      </PageBackground>
    );
  }

  // Codex PR-B MEDIUM-3: status=4 (create_failed) check MUST fire before the
  // generic chain==null pending branch — otherwise users with a failed
  // create see the "Creating battle..." spinner forever instead of the
  // re-queue instruction.
  if (battleData?.db?.status === 4) {
    return (
      <PageBackground variant="deep">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Swords className="size-8 text-coral mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Match Couldn't Be Created</h1>
          <p className="text-sm text-text-secondary">
            The on-chain createBattle didn't succeed. Please re-queue when ready.
          </p>
        </div>
      </PageBackground>
    );
  }

  // PR-B X1: db exists with status=0 OR chain still null — operator worker
  // is mid-flight submitting createBattle. ~3s typical.
  if (battleData && (battleData.db?.status === 0 || battleData.chain == null)) {
    return (
      <PageBackground variant="deep">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Loader2 className="size-6 animate-spin text-text-secondary mb-3" />
          <h1 className="font-pixel text-xl text-foreground mb-2">Creating battle</h1>
          <p className="text-sm text-text-secondary">
            Finalizing match on chain. This usually takes a few seconds.
          </p>
        </div>
      </PageBackground>
    );
  }

  if (battleError || !battleData) {
    return (
      <PageBackground variant="deep">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Swords className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Battle Not Found</h1>
          <p className="text-sm text-text-secondary">
            Battle #{battleId} doesn't exist or hasn't started yet.
          </p>
        </div>
      </PageBackground>
    );
  }

  const { chain, db } = battleData;
  // Defensive — the pending-create early-return above covers `chain == null`,
  // but TS doesn't narrow the disjunctive condition. Re-guard so the rest of
  // the page can dereference `chain` freely.
  if (!chain) return null;
  const rounds = roundsData?.rounds ?? [];
  const isSettled = chain.winner && chain.winner !== '0x0000000000000000000000000000000000000000';
  const winnerSide =
    isSettled && chain.winner.toLowerCase() === chain.playerA.toLowerCase()
      ? 'A'
      : isSettled && chain.winner.toLowerCase() === chain.playerB.toLowerCase()
        ? 'B'
        : null;

  return (
    <PageBackground variant="deep">
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <img src="/assets/icons/Battle.svg" alt="" width={28} height={28} style={{ imageRendering: 'pixelated' as const }} />
              <h1 className="font-pixel text-xl text-foreground">Battle #{battleId}</h1>
            </div>
            <p className="text-sm text-text-secondary mt-1">
              {isSettled ? 'Battle complete' : `Round ${chain.currentRound} in progress`}
            </p>
          </div>
          {isSettled && (
            <Badge className="bg-teal/15 text-teal border-0 font-pixel text-[10px]">Settled</Badge>
          )}
        </div>

        {/* Players */}
        <div className="grid grid-cols-2 gap-3">
          <PlayerCard
            label="Player A"
            address={chain.playerA}
            isWinner={winnerSide === 'A'}
          />
          <PlayerCard
            label="Player B"
            address={chain.playerB}
            isWinner={winnerSide === 'B'}
          />
        </div>

        {/* Battle info */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* F-12-a: chain.stakeAmount is wei (read directly from contract).
              `formatClaw` would render it 1e18× larger; use the wei-aware
              variant. The DB-side `db.stakeAmount` is now display semantics
              after the F-12 column-semantics fix. */}
          <InfoCard label="Stake" value={formatClawWei(chain.stakeAmount)} accent />
          <InfoCard label="Phase" value={isSettled ? 'Settled' : `Phase ${chain.phase}`} />
          <InfoCard label="Round" value={String(chain.currentRound)} />
          {db?.winnerPayout && (
            <InfoCard label="Payout" value={formatClaw(db.winnerPayout)} accent />
          )}
        </div>

        {/* Battle Animation Viewer */}
        {rounds.length > 0 && (teamA?.lobsters?.length ?? 0) > 0 && (
          <BattleAnimationSection
            rounds={rounds}
            teamA={teamA}
            teamB={teamB}
            isSettled={!!isSettled}
          />
        )}

        {/* Settlement result */}
        {isSettled && winnerSide && (
          <FrostedPanel variant="highlight" className="text-center py-6">
            <Trophy className="size-8 mx-auto mb-2 text-claw-gold" />
            <p className="font-pixel text-lg text-foreground">
              {formatAddress(chain.winner)} wins!
            </p>
            {db?.winnerPayout && (
              <p className="text-sm text-text-secondary mt-1">
                Payout: <span className="text-teal font-mono">{formatClaw(db.winnerPayout)}</span>
                {db.protocolFee && (
                  <> (fee: {formatClaw(db.protocolFee)})</>
                )}
              </p>
            )}
            {db?.settledAt && (
              <p className="text-xs text-text-secondary mt-2">
                {new Date(db.settledAt).toLocaleString()}
              </p>
            )}
          </FrostedPanel>
        )}

        {/* Rounds replay */}
        {rounds.length > 0 ? (
          <div className="space-y-3">
            <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">
              Round-by-Round
            </h2>
            {rounds.map((round) => (
              <RoundCard key={round.round} round={round} />
            ))}
          </div>
        ) : (
          !isSettled && (
            <FrostedPanel className="py-8 text-center">
              <Loader2 className="size-5 mx-auto animate-spin text-text-secondary mb-2" />
              <p className="text-sm text-text-secondary">Waiting for combat to begin...</p>
            </FrostedPanel>
          )
        )}

        {/* Basescan link */}
        {db?.battleId && (
          <p className="text-center text-xs text-text-secondary pt-4">
            <a
              href={`https://basescan.org/search?q=${battleId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-ocean transition-colors"
            >
              View on Basescan <ExternalLink className="size-3" />
            </a>
          </p>
        )}
      </div>
    </PageBackground>
  );
}

function PlayerCard({
  label,
  address,
  isWinner,
}: {
  label: string;
  address: string;
  isWinner: boolean;
}) {
  return (
    <FrostedPanel variant={isWinner ? 'highlight' : 'default'} className="p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="font-pixel text-[10px] text-text-secondary">{label}</span>
        {isWinner && (
          <Badge className="bg-claw-gold/15 text-claw-gold border-0 font-pixel text-[9px]">Winner</Badge>
        )}
      </div>
      <span className="font-mono text-sm text-foreground">{formatAddress(address)}</span>
    </FrostedPanel>
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

function RoundCard({ round }: { round: RoundData }) {
  return (
    <FrostedPanel className="overflow-hidden p-0">
      <div className="bg-ocean-mid/30 px-4 py-2 border-b border-[rgba(255,210,128,0.08)] flex items-center justify-between">
        <span className="font-pixel text-xs text-foreground">Round {round.round}</span>
        <span className="text-[10px] text-text-secondary">{round.actions.length} actions</span>
      </div>

      {/* HP bars */}
      <div className="grid grid-cols-2 gap-3 px-4 py-3">
        <div>
          <p className="font-pixel text-[10px] text-text-secondary mb-1.5">Team A</p>
          <div className="flex gap-2">
            {round.teamAHp.map((hp, i) => (
              <HpBar key={i} hp={hp} slot={i} />
            ))}
          </div>
        </div>
        <div>
          <p className="font-pixel text-[10px] text-text-secondary mb-1.5">Team B</p>
          <div className="flex gap-2">
            {round.teamBHp.map((hp, i) => (
              <HpBar key={i} hp={hp} slot={i} />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      {round.actions.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {round.actions.map((action, i) => {
            const moveLabel = MOVE_LABELS[action.moveType] ?? `Move ${action.moveType}`;
            const moveColor = MOVE_COLORS[action.moveType] ?? '';
            return (
              <div key={i} className="text-xs font-mono flex items-center gap-2">
                <span className="text-text-secondary w-14 shrink-0">
                  {action.actorTeam === 'A' ? 'A' : 'B'}#{action.actorSlot + 1}
                </span>
                <span className={`font-pixel ${moveColor}`}>{moveLabel}</span>
                {action.moveType !== 1 && (
                  <span className="text-text-secondary">
                    &rarr; #{action.targetSlot + 1}
                  </span>
                )}
                {Number(action.damage) > 0 && (
                  <span className="text-coral">-{action.damage}</span>
                )}
                {action.isCrit && <Badge className="bg-claw-gold/15 text-claw-gold border-0 font-pixel text-[8px] px-1">CRIT</Badge>}
                {action.isEnhanced && <Badge className="bg-coral/15 text-coral border-0 font-pixel text-[8px] px-1">ENHANCED</Badge>}
              </div>
            );
          })}
        </div>
      )}
    </FrostedPanel>
  );
}

function BattleAnimationSection({
  rounds,
  teamA,
  teamB,
  isSettled,
}: {
  rounds: RoundData[];
  teamA: TeamData | undefined;
  teamB: TeamData | undefined;
  isSettled: boolean;
}) {
  const lobsterConfigs = buildLobsterConfigs(teamA, teamB);
  const tier = determineBattleTier(lobsterConfigs);
  const scene = 0; // Default scene — will use custom positions from JSON when exported from rig

  return (
    <div className="mx-auto w-full">
      <BattleViewer
        rounds={rounds}
        lobsters={lobsterConfigs}
        tier={tier}
        scene={scene}
        autoPlay={!isSettled}
      />
    </div>
  );
}

function HpBar({ hp, slot }: { hp: string; slot: number }) {
  const value = Number(hp);
  const isKO = value <= 0;
  const maxHp = 1000; // approximate max for visual scaling
  const pct = isKO ? 0 : Math.min((value / maxHp) * 100, 100);
  const color = isKO ? 'bg-destructive/30' : pct > 50 ? 'bg-teal' : pct > 25 ? 'bg-claw-gold' : 'bg-destructive';

  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-mono text-[9px] text-text-secondary">#{slot + 1}</span>
        <span className={`font-mono text-[9px] ${isKO ? 'text-destructive' : 'text-foreground'}`}>
          {isKO ? 'KO' : hp}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-ocean-mid overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
