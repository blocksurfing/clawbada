'use client';

/**
 * The live battle view: Unity stage (or SVG fallback) + React HUD + action panel.
 * One instance per battle page; works for participants (submit turns) and
 * spectators (read-only).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { useAuth } from '@/hooks/use-auth';
import { useBattleSession } from '@/hooks/use-battle-session';
import type { Side } from '@/lib/battle-protocol';
import { BattleStage } from './BattleStage';
import { HexBoard } from './HexBoard';
import { Hud } from './Hud';
import { ActionPanel } from './ActionPanel';
import { DamageLog } from './DamageLog';
import { useTurnSelection } from './use-turn-selection';
import { Loader2, Radio, Trophy } from 'lucide-react';

export interface LiveBattleProps {
  battleId: string;
  address?: string;
  /** Force read-only even when the wallet is a participant. */
  spectate?: boolean;
  onEnded?: () => void;
}

export function LiveBattle({ battleId, address, spectate, onEnded }: LiveBattleProps) {
  const { getAuthParams } = useAuth();
  const [unityAvailable, setUnityAvailable] = useState<boolean | null>(null);
  const [unityReady, setUnityReady] = useState(false);
  const gate = unityAvailable === true && unityReady;
  const isSpectator = !!spectate || !address;

  const session = useBattleSession(battleId, {
    address,
    spectate: isSpectator,
    getAuthParams: isSpectator ? undefined : getAuthParams,
    gateOnAnimation: gate,
  });
  const { snapshot, current, bar, timeouts, log, pending, ended, error, lastAck, connection, submitTurn, markAnimated } = session;

  const mySide: Side | null = useMemo(() => {
    if (!snapshot || !address || isSpectator) return null;
    const a = address.toLowerCase();
    if (snapshot.session.playerA === a) return 'A';
    if (snapshot.session.playerB === a) return 'B';
    return null;
  }, [snapshot, address, isSpectator]);
  const playerSide: Side | 'spectator' = mySide ?? 'spectator';

  const animating = pending.length > 0;
  const myTurn = !!mySide && !!current && current.side === mySide && !ended;
  const canAct = myTurn && !animating;
  const selection = useTurnSelection(snapshot, current, canAct);
  const [sentTurn, setSentTurn] = useState<number | null>(null);

  useEffect(() => {
    if (lastAck && lastAck.turn === sentTurn) setSentTurn(null);
  }, [lastAck, sentTurn]);
  useEffect(() => {
    if (error && error.turn === sentTurn) setSentTurn(null);
  }, [error, sentTurn]);
  useEffect(() => {
    if (ended) onEnded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);

  const handleSubmit = useCallback(() => {
    if (!current || !selection.command) return;
    if (submitTurn(current.turn, selection.command)) setSentTurn(current.turn);
  }, [current, selection.command, submitTurn]);

  const handleUnavailable = useCallback(() => setUnityAvailable(false), []);
  const handleReady = useCallback(() => { setUnityAvailable(true); setUnityReady(true); }, []);

  if (!snapshot) {
    return (
      <FrostedPanel className="py-10 text-center">
        <Loader2 className="size-5 mx-auto animate-spin text-text-secondary mb-2" />
        <p className="text-sm text-text-secondary">
          {connection === 'open' ? 'Waiting for the server to start the battle…' : connection === 'connecting' ? 'Connecting…' : connection === 'error' ? 'Could not authenticate the live connection.' : 'Connecting to the battle…'}
        </p>
      </FrostedPanel>
    );
  }

  const highlights = canAct ? selection.highlights : null;
  const boardLobsters = snapshot.state.lobsters;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Badge className={`border-0 text-[10px] ${connection === 'open' ? 'bg-teal/15 text-teal' : 'bg-destructive/15 text-destructive'}`}>
            <Radio className="size-3 mr-1" /> {connection === 'open' ? 'Live' : connection}
          </Badge>
          <span>{snapshot.session.kind === 'practice' ? `Practice vs ${snapshot.session.bot} bot` : `Battle #${snapshot.session.id}`} · {snapshot.session.tier} arena</span>
          {isSpectator && <Badge className="bg-ocean-surface/60 text-text-secondary border-0 text-[10px]">spectating</Badge>}
        </div>
        {unityAvailable === false && <span className="text-[10px] text-text-secondary">Unity build not deployed — showing the plain board</span>}
      </div>

      {/* Stage: Unity when deployed, SVG board otherwise */}
      {unityAvailable !== false && (
        <BattleStage
          snapshot={snapshot}
          playerSide={playerSide}
          nextToAnimate={pending[0] ?? null}
          current={current}
          bar={bar}
          ended={ended}
          highlights={highlights}
          onTurnAnimationComplete={markAnimated}
          onHexClick={selection.onHexClick}
          onLobsterClick={selection.onLobsterClick}
          onUnavailable={handleUnavailable}
          onReady={handleReady}
        />
      )}
      {/* Tactical map: always rendered. It is the input surface (click a hex to move,
          a lobster to target) and the fallback picture when the Unity build is missing. */}
      <FrostedPanel className="p-2">
        {unityAvailable !== false && (
          <p className="text-[10px] text-text-secondary mb-1">
            Tactical map · click a hex to move, an enemy to target (or click the arena above)
          </p>
        )}
        {(
          <HexBoard
            layout={snapshot.state.layout}
            lobsters={boardLobsters}
            roster={snapshot.roster}
            highlights={highlights}
            activeId={current?.lobsterId ?? null}
            mySide={mySide}
            onHexClick={canAct ? selection.onHexClick : undefined}
            onLobsterClick={canAct ? selection.onLobsterClick : undefined}
          />
        )}
      </FrostedPanel>

      <Hud snapshot={snapshot} current={current} bar={bar} timeouts={timeouts} mySide={mySide} animating={animating} />

      {canAct && current && (
        <ActionPanel
          snapshot={snapshot}
          selection={selection}
          turn={current.turn}
          disabled={!canAct}
          pendingAck={sentTurn === current.turn}
          onSubmit={handleSubmit}
          error={error && (error.turn === undefined || error.turn === current.turn) ? `${error.code}: ${error.message}` : null}
        />
      )}
      {myTurn && animating && (
        <FrostedPanel className="p-3 text-xs text-text-secondary">Your turn — waiting for the previous turn's animation to finish…</FrostedPanel>
      )}

      {ended && (
        <FrostedPanel variant="highlight" className="text-center py-6">
          <Trophy className="size-8 mx-auto mb-2 text-claw-gold" />
          <p className="font-pixel text-lg text-foreground">
            {ended.winner === 'draw' ? 'Draw' : mySide ? (ended.winner === mySide ? 'Victory!' : 'Defeat') : `Team ${ended.winner} wins`}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {ended.reason === 'forfeit' ? 'by forfeit' : ended.reason === 'turn_cap' ? 'turn cap reached' : 'wipeout'} · {snapshot.state.turn} turns
            {ended.settle === 'queued' && ' · settlement submitted on-chain'}
          </p>
          <p className="text-[10px] text-text-secondary mt-2 font-mono break-all">log {ended.turnLogHash}</p>
        </FrostedPanel>
      )}

      <DamageLog snapshot={snapshot} log={log} />
    </div>
  );
}
