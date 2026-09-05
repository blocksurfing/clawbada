'use client';

import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import type { BattleSnapshot, TurnResolvedPayload } from '@/lib/battle-protocol';

export function DamageLog({ snapshot, log }: { snapshot: BattleSnapshot; log: TurnResolvedPayload[] }) {
  const name = (id: string) => {
    const r = snapshot.roster.find((x) => x.id === id);
    return r ? `${CLASS_NAMES_LIST[r.classId]}${r.side}` : id;
  };
  const items = [...log].reverse().slice(0, 40);
  return (
    <FrostedPanel className="p-3">
      <p className="font-pixel text-[10px] text-text-secondary mb-2">Log</p>
      <div className="space-y-1 max-h-56 overflow-y-auto font-mono text-[11px]">
        {items.length === 0 && <p className="text-text-secondary">No turns yet.</p>}
        {items.map((t) => {
          const r = t.result;
          const who = r.lobsterId ? name(r.lobsterId) : '—';
          const what = t.submittedBy === 'forfeit' ? 'forfeits' : r.skipped ? 'stunned — skips' : r.action === 'none' ? 'moves' : r.action ?? '';
          return (
            <div key={t.turn} className="flex flex-wrap gap-x-2">
              <span className="text-text-secondary">t{t.turn}</span>
              <span className="text-foreground">{who}</span>
              <span className={r.action === 'special' ? 'text-claw-gold' : 'text-text-secondary'}>{what}{r.isEnhanced ? ' ✨' : ''}</span>
              {r.targetId && r.action !== 'defend' && <span className="text-text-secondary">→ {name(r.targetId)}</span>}
              {r.damage.map((d, i) => (
                <span key={i} className={d.kind === 'attack' || d.kind === 'special' ? 'text-coral' : 'text-text-secondary'}>
                  {name(d.targetId)} -{d.amount}{d.isCrit ? '!' : ''}{d.killed ? ' †' : ''}{d.kind !== 'attack' && d.kind !== 'special' ? ` (${d.kind})` : ''}
                </span>
              ))}
              {r.heals.map((h, i) => <span key={`h${i}`} className="text-teal">{name(h.targetId)} +{h.amount}</span>)}
              {t.submittedBy === 'timeout' && <span className="text-destructive">timeout</span>}
            </div>
          );
        })}
      </div>
    </FrostedPanel>
  );
}
