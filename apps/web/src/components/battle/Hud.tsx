'use client';

import { useEffect, useState } from 'react';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { Badge } from '@/components/ui/badge';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { formatAddress } from '@/lib/format';
import type { BattleSnapshot, CurrentTurn, Side, WireBarEntry } from '@/lib/battle-protocol';

export interface HudProps {
  snapshot: BattleSnapshot;
  current: CurrentTurn | null;
  bar: WireBarEntry[];
  timeouts: Record<Side, number>;
  mySide: Side | null;
  animating: boolean;
}

function useNow(tick = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(h);
  }, [tick]);
  return now;
}

const STATUS_ICON: Record<string, string> = { bleed: '🩸', stun: '💫', haunt: '👻', fortify: '🛡', reflect: '🔁', shield: '🔰', slow: '🐌', taunt: '📣' };

export function Hud({ snapshot, current, bar, timeouts, mySide, animating }: HudProps) {
  const now = useNow();
  const remaining = current?.deadline ? Math.max(0, current.deadline - now) : null;
  const byId = new Map(snapshot.roster.map((r) => [r.id, r]));
  const name = (id: string) => {
    const r = byId.get(id);
    return r ? `${CLASS_NAMES_LIST[r.classId] ?? 'Lobster'}` : id;
  };
  const sideOf = (id: string): Side => byId.get(id)?.side ?? 'A';
  const controllerLabel = current?.controller === 'bot' ? 'Bot' : current?.controller ? (current.controller.toLowerCase() === snapshot.session.playerA ? 'Player A' : 'Player B') : '';
  const myTurn = !!mySide && current?.side === mySide;

  return (
    <div className="space-y-3">
      {/* Turn + clock */}
      <FrostedPanel className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <span className="font-pixel text-xs text-text-accent">Turn {current?.turn ?? snapshot.state.turn}</span>
          {current?.lobsterId && (
            <span className="text-sm">
              <span className={sideOf(current.lobsterId) === 'A' ? 'text-coral' : 'text-ocean'}>{name(current.lobsterId)}</span>
              <span className="text-text-secondary"> · {controllerLabel}{myTurn ? ' (you)' : ''}</span>
            </span>
          )}
          {animating && <Badge className="bg-ocean-surface/60 text-text-secondary border-0 text-[10px]">animating…</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {remaining !== null && (
            <span className={`font-mono text-lg ${remaining < 10_000 ? 'text-destructive' : 'text-foreground'}`}>{Math.ceil(remaining / 1000)}s</span>
          )}
          {current?.controller === 'bot' && <Badge className="bg-teal/15 text-teal border-0 text-[10px]">bot thinking</Badge>}
        </div>
      </FrostedPanel>

      {/* Initiative bar */}
      <FrostedPanel className="p-3">
        <p className="font-pixel text-[10px] text-text-secondary mb-2">Up next</p>
        <div className="flex gap-1.5 overflow-x-auto">
          {(current?.lobsterId ? [{ lobsterId: current.lobsterId, tick: '' }, ...bar] : bar).slice(0, 8).map((b, i) => (
            <div key={`${b.lobsterId}-${i}`} className={`shrink-0 rounded px-2 py-1 text-[10px] font-pixel border ${sideOf(b.lobsterId) === 'A' ? 'border-coral/40 text-coral' : 'border-ocean/40 text-ocean'} ${i === 0 ? 'bg-white/10' : 'bg-transparent'}`}>
              {name(b.lobsterId)}
            </div>
          ))}
        </div>
      </FrostedPanel>

      {/* Teams */}
      <div className="grid grid-cols-2 gap-3">
        {(['A', 'B'] as Side[]).map((side) => (
          <FrostedPanel key={side} variant={mySide === side ? 'highlight' : 'default'} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className={`font-pixel text-[10px] ${side === 'A' ? 'text-coral' : 'text-ocean'}`}>
                Team {side}{mySide === side ? ' · you' : ''}
              </span>
              <span className="text-[10px] text-text-secondary font-mono">
                {(side === 'A' ? snapshot.session.playerA : snapshot.session.playerB).startsWith('bot:') ? snapshot.session.playerB.replace('bot:', 'bot · ') : formatAddress(side === 'A' ? snapshot.session.playerA : snapshot.session.playerB)}
                {timeouts[side] > 0 && <span className="text-destructive ml-1">⏱{timeouts[side]}</span>}
              </span>
            </div>
            {snapshot.state.lobsters.filter((l) => l.team === side).map((l) => {
              const hp = Number(l.hp), max = Number(l.maxHp) || 1;
              const pct = Math.max(0, Math.min(100, (hp / max) * 100));
              const active = current?.lobsterId === l.id;
              return (
                <div key={l.id} className={`rounded p-1.5 ${active ? 'bg-white/10' : ''} ${l.alive ? '' : 'opacity-40'}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{name(l.id)}</span>
                    <span className="font-mono text-text-secondary">{l.alive ? `${hp}/${max}` : 'KO'}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-ocean-mid overflow-hidden mt-1">
                    <div className={`h-full ${pct > 50 ? 'bg-teal' : pct > 25 ? 'bg-claw-gold' : 'bg-destructive'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-[10px]">
                    <span className="text-claw-gold">{'●'.repeat(l.charge)}{'○'.repeat(Math.max(0, 3 - l.charge))}</span>
                    {l.defending && <span title="defending">🛡</span>}
                    {l.statuses.map((s, i) => <span key={i} title={`${s.type} (${s.turns})`}>{STATUS_ICON[s.type] ?? s.type}</span>)}
                  </div>
                </div>
              );
            })}
          </FrostedPanel>
        ))}
      </div>
    </div>
  );
}
