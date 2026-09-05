'use client';

/**
 * Plain SVG hex board — the fallback renderer when the Unity build is not
 * deployed, and the click surface for playtesting without it. Pointy-top,
 * odd-row-right offset (matches game-logic board.ts / Unity HexCoord).
 */
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import type { v3 } from '@clawbada/game-logic';
import type { HexListData, HexPosition } from './unity-bridge';
import type { RosterEntry, Side } from '@/lib/battle-protocol';

const SIZE = 30;
const SQRT3 = Math.sqrt(3);

function center(col: number, row: number): { x: number; y: number } {
  return { x: SIZE * SQRT3 * (col + 0.5 * (row & 1)) + SIZE, y: SIZE * 1.5 * row + SIZE };
}
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}
const key = (h: HexPosition) => `${h.col},${h.row}`;

export interface HexBoardProps {
  layout: v3.ArenaLayout;
  lobsters: v3.ClientBattleState['lobsters'];
  roster: RosterEntry[];
  highlights: HexListData | null;
  activeId: string | null;
  mySide: Side | null;
  onHexClick?: (hex: HexPosition) => void;
  onLobsterClick?: (id: string) => void;
}

export function HexBoard({ layout, lobsters, roster, highlights, activeId, mySide, onHexClick, onLobsterClick }: HexBoardProps) {
  const blocked = new Set(layout.blockedHexes.map(key));
  const range = new Set((highlights?.rangeHexes ?? []).map(key));
  const enemies = new Set((highlights?.enemyTargets ?? []).map(key));
  const allies = new Set((highlights?.allyTargets ?? []).map(key));
  const origin = highlights && highlights.originCol >= 0 ? `${highlights.originCol},${highlights.originRow}` : null;
  const width = SIZE * SQRT3 * (layout.cols + 0.5) + SIZE;
  const height = SIZE * 1.5 * (layout.rows - 1) + SIZE * 3;
  const byPos = new Map(lobsters.filter((l) => l.alive).map((l) => [`${l.pos.col},${l.pos.row}`, l]));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none" role="img" aria-label="battle board">
      {Array.from({ length: layout.rows }, (_, row) =>
        Array.from({ length: layout.cols }, (_, col) => {
          const k = `${col},${row}`;
          const { x, y } = center(col, row);
          const isBlocked = blocked.has(k);
          const fill = isBlocked ? '#1a1410' : origin === k ? 'rgba(88,166,255,0.55)' : enemies.has(k) ? 'rgba(249,112,102,0.6)' : allies.has(k) ? 'rgba(63,185,160,0.55)' : range.has(k) ? 'rgba(200,205,215,0.35)' : 'rgba(27,69,104,0.55)';
          const clickable = !isBlocked && !!onHexClick;
          return (
            <polygon
              key={k}
              points={hexPoints(x, y, SIZE - 1.5)}
              fill={fill}
              stroke="rgba(255,210,128,0.25)"
              strokeWidth={1}
              className={clickable ? 'cursor-pointer hover:opacity-90' : ''}
              onClick={() => {
                if (!clickable) return;
                const lob = byPos.get(k);
                if (lob && onLobsterClick) onLobsterClick(lob.id);
                else onHexClick?.({ col, row });
              }}
            />
          );
        }),
      )}
      {lobsters.map((l) => {
        const { x, y } = center(l.pos.col, l.pos.row);
        const r = roster.find((e) => e.id === l.id);
        const cls = r ? CLASS_NAMES_LIST[r.classId] ?? '' : '';
        const hp = Number(l.hp), max = Number(l.maxHp) || 1;
        const pct = Math.max(0, Math.min(1, hp / max));
        const teamColor = l.team === 'A' ? '#f97066' : '#58a6ff';
        const isActive = l.id === activeId;
        return (
          <g key={l.id} opacity={l.alive ? 1 : 0.35} className={onLobsterClick && l.alive ? 'cursor-pointer' : ''} onClick={() => l.alive && onLobsterClick?.(l.id)}>
            {isActive && <circle cx={x} cy={y} r={SIZE * 0.78} fill="none" stroke="#ffd280" strokeWidth={2.5} />}
            <circle cx={x} cy={y} r={SIZE * 0.55} fill={teamColor} stroke={l.team === mySide ? '#ffffff' : 'rgba(0,0,0,0.5)'} strokeWidth={1.5} />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0e1e35">{cls.slice(0, 3).toUpperCase()}</text>
            <rect x={x - SIZE * 0.6} y={y + SIZE * 0.62} width={SIZE * 1.2} height={4} fill="rgba(0,0,0,0.6)" rx={1} />
            <rect x={x - SIZE * 0.6} y={y + SIZE * 0.62} width={SIZE * 1.2 * pct} height={4} fill={pct > 0.5 ? '#3fb9a0' : pct > 0.25 ? '#fbbf24' : '#f85149'} rx={1} />
            {Array.from({ length: l.charge }, (_, i) => (
              <circle key={i} cx={x - 8 + i * 8} cy={y - SIZE * 0.72} r={2.5} fill="#fbbf24" />
            ))}
            {!l.alive && <text x={x} y={y - SIZE * 0.65} textAnchor="middle" fontSize={10} fill="#f85149">KO</text>}
          </g>
        );
      })}
    </svg>
  );
}
