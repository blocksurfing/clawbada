'use client';

import { CLASS_NAMES_LIST, CLASS_SPECIAL_NAMES } from '@clawbada/game-logic';
import type { LobsterClass } from '@clawbada/game-logic';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import type { TurnSelection } from './use-turn-selection';
import type { BattleSnapshot } from '@/lib/battle-protocol';

export interface ActionPanelProps {
  snapshot: BattleSnapshot;
  selection: TurnSelection;
  turn: number;
  disabled: boolean;
  pendingAck: boolean;
  onSubmit: () => void;
  error: string | null;
}

export function ActionPanel({ snapshot, selection: s, turn, disabled, pendingAck, onSubmit, error }: ActionPanelProps) {
  if (!s.actor) return null;
  const roster = snapshot.roster.find((r) => r.id === s.actor!.id);
  const cls = roster ? CLASS_NAMES_LIST[roster.classId] : 'Lobster';
  const special = roster ? CLASS_SPECIAL_NAMES[roster.classId as LobsterClass] : 'Special';
  const targetName = (id: string | null) => {
    if (!id) return null;
    const r = snapshot.roster.find((x) => x.id === id);
    return r ? `${CLASS_NAMES_LIST[r.classId]} (${r.side})` : id;
  };
  const targetIds: string[] =
    s.action === 'attack' ? (s.summary?.attackTargets ?? [])
    : s.action === 'special' && s.specialKind !== 'none' ? (s.summary?.specialTargets ?? [])
    : [];
  const btn = (active: boolean, extra = '') => `px-3 py-2 rounded text-xs font-pixel transition-colors border ${active ? 'border-claw-gold text-claw-gold bg-claw-gold/10' : 'border-border text-text-secondary hover:text-foreground'} disabled:opacity-40 ${extra}`;

  return (
    <FrostedPanel variant="highlight" className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-pixel text-xs text-claw-gold">Your turn — {cls}</span>
        <span className="text-[10px] text-text-secondary">turn {turn}</span>
      </div>

      <div className="text-xs text-text-secondary space-y-1">
        <p>
          <span className="text-foreground">Move:</span>{' '}
          {s.moveTo ? <>to ({s.moveTo.col},{s.moveTo.row}) <button className="underline ml-1" onClick={s.clearMove}>stay</button></> : <>click a highlighted hex to move ({s.summary?.moves.length ?? 0} options), or act from here</>}
        </p>
        <p>
          <span className="text-foreground">Target:</span>{' '}
          {targetName(s.targetId) ?? (s.action === 'attack' ? 'click an enemy in range' : s.action === 'special' && s.specialKind !== 'none' ? `click ${s.specialKind === 'ally' ? 'an ally' : 'an enemy'} in range` : '—')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={btn(s.action === 'attack')} disabled={disabled} onClick={() => s.setAction('attack')}>Attack</button>
        <button className={btn(s.action === 'special')} disabled={disabled || !s.canSpecial} onClick={() => s.setAction('special')} title={s.canSpecial ? special : 'needs 3 charge'}>
          {special}{s.canSpecial ? '' : ' (3⚡)'}
        </button>
        <button className={btn(s.action === 'defend')} disabled={disabled} onClick={() => s.setAction('defend')}>Defend</button>
        <button className={btn(s.action === 'none')} disabled={disabled} onClick={() => s.setAction('none')}>Move only</button>
      </div>

      {/* Target chips: every legal target for the chosen action, so a turn can be
          completed from the HUD alone (board clicks on the arena or map also work). */}
      {targetIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">Target</span>
          {targetIds.map((id) => (
            <button
              key={id}
              type="button"
              data-target-id={id}
              className={btn(s.targetId === id, 'py-1')}
              disabled={disabled}
              onClick={() => s.onLobsterClick(id)}
            >
              {targetName(id)}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-[11px] text-text-secondary">{s.valid ? 'Ready.' : s.invalidReason ? s.invalidReason : 'Pick an action.'}</span>
        <button
          className="frosted-panel-highlight px-4 py-2 text-xs font-pixel text-claw-gold disabled:opacity-40"
          disabled={disabled || !s.valid || pendingAck}
          onClick={onSubmit}
        >
          {pendingAck ? 'Sending…' : 'Confirm'}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </FrostedPanel>
  );
}
