'use client';

/**
 * The live battle view: Unity stage (or SVG fallback) + React HUD + action panel.
 * One instance per battle page; works for participants (submit turns) and
 * spectators (read-only).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useBattleSession } from '@/hooks/use-battle-session';
import { useArenaMusic } from '@/hooks/use-arena-music';
import { setMusicPref, setSfxPref, type AudioPrefChange } from '@/lib/audio-prefs';
import type { Side, TurnCommand } from '@/lib/battle-protocol';
import { v3 } from '@clawbada/game-logic';
import { BattleStage } from './BattleStage';
import { selectionToData } from './unity-bridge';
import { HexBoard } from './HexBoard';
import { Hud } from './Hud';
import { ActionPanel } from './ActionPanel';
import { DamageLog } from './DamageLog';
import { useTurnSelection, type ActionChoice } from './use-turn-selection';
import { Loader2, Radio, Trophy } from 'lucide-react';

export interface LiveBattleProps {
  battleId: string;
  address?: string;
  /** Force read-only even when the wallet is a participant. */
  spectate?: boolean;
  onEnded?: () => void;
  /** Review tool: the balanced bot policy plays this wallet's turns (URL ?auto=1). */
  autoPlay?: boolean;
  /** Review tool: Unity playback speed multiplier (URL ?speed=2). */
  speed?: number;
  /** Called once the view has closed itself after the result (stage torn down) — the page navigates. Absent → the view stays. */
  onClose?: () => void;
  /** Review / harness: never leave on its own (URL ?stay=1). The Stay button does the same at runtime. */
  stay?: boolean;
}

/** Seconds the result stays on screen before the view returns to the arena page. Wall clock — ?speed does not touch it. */
const RETURN_SECONDS = 6;

export function LiveBattle({ battleId, address, spectate, onEnded, autoPlay, speed, onClose, stay }: LiveBattleProps) {
  const { getAuthParams, getAuthHeaders, getSessionToken } = useAuth();
  const [unityAvailable, setUnityAvailable] = useState<boolean | null>(null);
  const [unityReady, setUnityReady] = useState(false);
  const gate = unityAvailable === true && unityReady;
  const isSpectator = !!spectate || !address;

  const session = useBattleSession(battleId, {
    address,
    spectate: isSpectator,
    getAuthParams: isSpectator ? undefined : getAuthParams,
    getAuthHeaders: isSpectator ? undefined : getAuthHeaders,
    getSessionToken: isSpectator ? undefined : getSessionToken,
    gateOnAnimation: gate,
  });
  const { snapshot, current, bar, timeouts, log, pending, ended, error, lastAck, connection, submitTurn, markAnimated, snapshotSeq } = session;
  // The bed waits for the arena to be visible: Unity bound, or the plain board shown because Unity is unavailable.
  useArenaMusic(snapshot?.session.tier, gate || unityAvailable === false, !!ended);
  const handleAudioPref = useCallback((p: AudioPrefChange) => (p.kind === 'music' ? setMusicPref(p.on) : setSfxPref(p.on)), []);

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
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const onSubmit = useCallback((cmd: TurnCommand): boolean => {
    if (!current) return false;
    const ok = submitTurn(current.turn, cmd);
    if (ok) {
      setSentTurn(current.turn);
      console.log(`[LiveBattle] submit ${cmd.action} ${cmd.targetId ?? ''}${cmd.moveTo ? ` move(${cmd.moveTo.col},${cmd.moveTo.row})` : ''}`);
    }
    return ok;
  }, [current, submitTurn]);
  // Unity's action bar submits on tap (LOKR); the React fallback panel confirms explicitly.
  const selection = useTurnSelection(snapshot, current, canAct, { autoSubmit: gate, onSubmit });
  const pendingAck = current !== null && sentTurn === current.turn;
  // The bar belongs to a turn the player can act on: not while earlier turns are still
  // animating (React's `current` runs ahead of the picture), except to show "Sending…".
  const barTurn = myTurn && (!animating || pendingAck);
  const selectionData = useMemo(
    () => (snapshot ? selectionToData(canAct ? selection : null, snapshot.roster, { isPlayerTurn: barTurn, canAct: canAct && !pendingAck, pendingAck }) : null),
    [snapshot, selection, canAct, barTurn, pendingAck],
  );
  const handleActionSelected = useCallback((a: string) => {
    console.log(`[LiveBattle] unity action ${a}`);
    selection.pressAction(a as ActionChoice);
  }, [selection]);
  const handleUndo = useCallback(() => selection.clearMove(), [selection]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    // Harness/agent hook: the legal moves and targets the HUD is working from.
    (window as unknown as { __clawbada_selection?: unknown }).__clawbada_selection = {
      actor: selection.actor?.id ?? null, moves: selection.summary?.moves ?? [], attackTargets: selection.summary?.attackTargets ?? [],
      specialTargets: selection.summary?.specialTargets ?? [], action: selection.action, moveTo: selection.moveTo, targetId: selection.targetId,
      hint: selection.hint, canSpecial: selection.canSpecial, specialKind: selection.specialKind,
      lobsters: snapshot?.state.lobsters.map((l) => ({ id: l.id, team: l.team, col: l.pos.col, row: l.pos.row, alive: l.alive })) ?? [],
    };
  }, [selection, snapshot]);

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
    if (!selection.command) return;
    onSubmit(selection.command);
  }, [selection.command, onSubmit]);

  // Auto-play (designer / harness review tool): once the previous turn has finished animating,
  // let the balanced bot policy choose this wallet's turn — the battle plays itself while the
  // viewer watches the VFX. Same policy the server bot uses; falls back to Defend on any error.
  useEffect(() => {
    if (!autoPlay || !canAct || pendingAck || !snapshot || !current) return;
    const turn = current.turn;
    const t = setTimeout(() => {
      let cmd: TurnCommand = { lobsterId: current.lobsterId, action: 'defend' } as TurnCommand;
      try {
        const state = v3.fromWire({ ...snapshot.state, vrfSeed: '0' });
        const actor = state.lobsters.find((l) => l.id === current.lobsterId);
        if (actor) {
          const chosen = v3.botPolicy('balanced')(state, actor) as TurnCommand;
          v3.validateTurn(state, chosen);
          cmd = chosen;
        }
      } catch (e) {
        console.warn('[LiveBattle] autoplay: policy failed, defending', e);
      }
      console.log(`[LiveBattle] autoplay turn ${turn}: ${cmd.action} ${cmd.targetId ?? ''}`);
      onSubmit(cmd);
    }, 350);
    return () => clearTimeout(t);
  }, [autoPlay, canAct, pendingAck, snapshot, current, onSubmit]);

  const handleUnavailable = useCallback(() => setUnityAvailable(false), []);

  // Forfeit from the in-canvas gear menu (already confirmed there). The server ends the
  // battle and broadcasts battle_ended to both sockets, so there is no local state to set.
  const [forfeitError, setForfeitError] = useState<string | null>(null);
  const handleForfeit = useCallback(async () => {
    if (isSpectator || ended) return;
    try {
      setForfeitError(null);
      const auth = await getAuthHeaders();
      const res = await api.combat.forfeit(battleId, auth);
      console.log(`[LiveBattle] forfeit accepted — ${res.winner} wins`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not forfeit';
      console.warn('[LiveBattle] forfeit failed', e);
      setForfeitError(msg);
    }
  }, [battleId, ended, isSpectator, getAuthHeaders]);
  const handleReady = useCallback(() => { setUnityAvailable(true); setUnityReady(true); }, []);

  // Auto-return. The result counts as shown once the ended payload is in AND nothing is still
  // animating — the same moment BattleStage raises Unity's banner — so the countdown never
  // runs over the last death. Then the stage tears Unity down and the page navigates.
  const resultShown = !!ended && pending.length === 0;
  const [countdown, setCountdown] = useState<number | null>(null);
  const [stayHere, setStayHere] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!resultShown || !onClose || stay || stayHere || closing) return;
    console.log(`[LiveBattle] result shown — back to the arena in ${RETURN_SECONDS} s`);
    setCountdown(RETURN_SECONDS);
    const started = Date.now();
    const t = setInterval(() => {
      const left = RETURN_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) { clearInterval(t); setCountdown(0); setClosing(true); }
      else setCountdown(left);
    }, 250);
    return () => clearInterval(t);
  }, [resultShown, onClose, stay, stayHere, closing]);
  useEffect(() => {
    if (closing) console.log(`[LiveBattle] closing the battle view${unityAvailable === false ? ' (plain board)' : ''}`);
  }, [closing, unityAvailable]);
  // Without a Unity stage there is nothing to tear down; with one, BattleStage reports back.
  useEffect(() => {
    if (closing && unityAvailable === false) onClose?.();
  }, [closing, unityAvailable, onClose]);
  const handleClosed = useCallback(() => onClose?.(), [onClose]);
  // The countdown sits over the canvas (where the eyes are — the result panel below can be
  // under the fold, and in fullscreen it is not on screen at all); on the plain board it goes
  // in the result panel instead.
  const returnRow = onClose && resultShown ? (
    <div className="flex flex-wrap items-center justify-center gap-3 text-xs" data-testid="battle-return">
      {closing ? (
        <span className="font-pixel text-[10px]">Leaving the arena…</span>
      ) : countdown !== null && !stayHere && !stay ? (
        <>
          <span className="font-pixel text-[10px]">Back to the arena in {countdown}s</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setClosing(true)}>Back now</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setStayHere(true); setCountdown(null); }}>Stay</Button>
        </>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setClosing(true)}>Back to the arena</Button>
      )}
    </div>
  ) : null;

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
          onForfeit={handleForfeit}
          onAudioPref={handleAudioPref}
          speed={speed}
          snapshot={snapshot}
          snapshotSeq={snapshotSeq}
          playerSide={playerSide}
          nextToAnimate={pending[0] ?? null}
          current={current}
          bar={bar}
          ended={ended}
          highlights={highlights}
          selection={selectionData}
          previewMove={selection.moveTo}
          onTurnAnimationComplete={markAnimated}
          onHexClick={selection.onHexClick}
          onLobsterClick={selection.onLobsterClick}
          onActionSelected={handleActionSelected}
          onUndoMove={handleUndo}
          onUnavailable={handleUnavailable}
          onReady={handleReady}
          closing={closing}
          onClosed={handleClosed}
          overlay={gate ? returnRow : undefined}
        />
      )}
      {/* Fallback board: only when the Unity build is missing or not yet ready — the arena
          itself is the input surface once Unity's HUD is up. */}
      {!gate && (
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
      )}

      {/* Unity draws the HUD (turn strip, HP, clock, badges) inside the canvas; the React
          HUD is the fallback when the WebGL build is missing or not yet ready. */}
      {!gate && <Hud snapshot={snapshot} current={current} bar={bar} timeouts={timeouts} mySide={mySide} animating={animating} />}
      {gate && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary px-1" data-testid="battle-status-line">
          <span className="font-pixel text-[10px] text-text-accent">Turn {current?.turn ?? snapshot.state.turn}</span>
          {ended ? (
            <span>Battle over</span>
          ) : animating ? (
            <span>animating…</span>
          ) : myTurn ? (
            <span className="text-claw-gold">Your turn</span>
          ) : current?.controller === 'bot' ? (
            <span>Bot thinking…</span>
          ) : (
            <span>Opponent's turn</span>
          )}
          {(timeouts.A > 0 || timeouts.B > 0) && <span>⏱ A {timeouts.A} · B {timeouts.B}</span>}
          {sentTurn !== null && sentTurn === current?.turn && <span>Sending…</span>}
          {error && (error.turn === undefined || error.turn === current?.turn) && <span className="text-destructive">{error.code}: {error.message}</span>}
          {forfeitError && <span className="text-destructive">Forfeit failed: {forfeitError}</span>}
        </div>
      )}

      {!gate && canAct && current && (
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
          {!gate && returnRow && <div className="mt-4">{returnRow}</div>}
        </FrostedPanel>
      )}

      <DamageLog snapshot={snapshot} log={log} />
    </div>
  );
}
