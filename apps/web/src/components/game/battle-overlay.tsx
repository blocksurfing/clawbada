'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChoreographyCallbacks } from '@/lib/battle-anim/types';
import { CANVAS_W, CANVAS_H, SPRITE_SIZE } from '@/lib/battle-anim/positions';
import { CLASS_NAMES_LIST, CLASS_SPECIAL_NAMES } from '@clawbada/game-logic';
import type { LobsterClass } from '@clawbada/game-logic';

// ── Types ──

interface DamageFloat {
  id: number;
  lobsterId: string;
  amount: number;
  isCrit: boolean;
  isHeal: boolean;
  x: number; // 0-1 fraction of container width
  y: number; // 0-1 fraction of container height
  startTime: number;
}

interface Banner {
  text: string;
  type: 'ready' | 'go' | 'victory';
  id: number;
}

interface SpecialOverlay {
  classId: number;
  id: number;
}

interface BattleOverlayProps {
  callbacksRef: React.MutableRefObject<Partial<ChoreographyCallbacks>>;
  lobsterPositions: Record<string, { x: number; y: number }>;
}

const FLOAT_DURATION_MS = 1200;

let nextFloatId = 0;
let nextBannerId = 0;
let nextOverlayId = 0;

export function BattleOverlay({
  callbacksRef,
  lobsterPositions,
}: BattleOverlayProps) {
  const [floats, setFloats] = useState<DamageFloat[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [specialOverlay, setSpecialOverlay] = useState<SpecialOverlay | null>(
    null,
  );

  // Wire up callbacks
  useEffect(() => {
    callbacksRef.current.onDamageFloat = (
      lobsterId: string,
      amount: number,
      isCrit: boolean,
      isHeal: boolean,
    ) => {
      const pos = lobsterPositions[lobsterId];
      if (!pos) return;

      // Convert canonical coords to 0-1 fractions
      const x = (pos.x + SPRITE_SIZE / 2) / CANVAS_W;
      const y = pos.y / CANVAS_H;

      const floatEntry: DamageFloat = {
        id: nextFloatId++,
        lobsterId,
        amount,
        isCrit,
        isHeal,
        x,
        y,
        startTime: Date.now(),
      };

      setFloats((prev) => [...prev, floatEntry]);
    };

    callbacksRef.current.onBanner = (
      text: string,
      type: 'ready' | 'go' | 'victory',
    ) => {
      setBanner({ text, type, id: nextBannerId++ });
    };

    callbacksRef.current.onHideBanner = () => {
      setBanner(null);
    };

    callbacksRef.current.onSpecialOverlay = (classId: number) => {
      setSpecialOverlay({ classId, id: nextOverlayId++ });
    };

    callbacksRef.current.onHideSpecialOverlay = () => {
      setSpecialOverlay(null);
    };

    callbacksRef.current.onScreenShake = () => {
      // Shake is handled in canvas via state.shakeAmount
    };

    callbacksRef.current.onStatusText = () => {
      // Placeholder — status text will be added by designer
    };

    callbacksRef.current.onRoundComplete = () => {
      // Handled by playback hook
    };

    callbacksRef.current.onBattleComplete = () => {
      // Handled by playback hook
    };
  }, [callbacksRef, lobsterPositions]);

  // Auto-remove expired floats
  useEffect(() => {
    if (floats.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setFloats((prev) =>
        prev.filter((f) => now - f.startTime < FLOAT_DURATION_MS),
      );
    }, 200);

    return () => clearInterval(interval);
  }, [floats.length]);

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {/* Damage floats */}
      {floats.map((f) => {
        const age = Date.now() - f.startTime;
        const progress = Math.min(age / FLOAT_DURATION_MS, 1);
        // Rise upward and fade out
        const translateY = -40 * progress;
        const opacity = 1 - progress * progress; // quadratic fade

        const colorClass = f.isHeal
          ? 'text-green-400'
          : f.isCrit
            ? 'text-amber-300'
            : 'text-red-400';
        const sizeClass = f.isCrit ? 'text-xl font-black' : 'text-base font-bold';

        return (
          <div
            key={f.id}
            className={`absolute ${colorClass} ${sizeClass} tabular-nums`}
            style={{
              left: `${f.x * 100}%`,
              top: `${f.y * 100}%`,
              transform: `translate(-50%, ${translateY}px)`,
              opacity,
              textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.4)',
              transition: 'none',
            }}
          >
            {f.isHeal ? '+' : '-'}{f.amount}
            {f.isCrit && (
              <span className="ml-0.5 text-xs text-amber-200">CRIT</span>
            )}
          </div>
        );
      })}

      {/* Banner */}
      {banner && (
        <div
          key={banner.id}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div
            className={`
              px-8 py-3 rounded-lg font-black tracking-wider uppercase
              animate-in fade-in zoom-in-90 duration-300
              ${
                banner.type === 'victory'
                  ? 'text-4xl text-amber-300 bg-black/60'
                  : banner.type === 'go'
                    ? 'text-5xl text-white bg-black/50'
                    : 'text-3xl text-white/90 bg-black/40'
              }
            `}
            style={{
              textShadow:
                '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(251,191,36,0.3)',
            }}
          >
            {banner.text}
          </div>
        </div>
      )}

      {/* Special move overlay */}
      {specialOverlay && (
        <div
          key={specialOverlay.id}
          className="absolute inset-0 flex items-end justify-center pb-[15%]"
        >
          <div
            className="
              px-6 py-2 rounded-md bg-black/70 border border-amber-400/40
              animate-in fade-in slide-in-from-bottom-4 duration-300
            "
          >
            <span className="text-sm font-bold text-amber-300 tracking-wide uppercase">
              {CLASS_NAMES_LIST[specialOverlay.classId] ?? 'Unknown'}
            </span>
            <span className="mx-2 text-white/40">|</span>
            <span className="text-base font-black text-white tracking-wider uppercase">
              {CLASS_SPECIAL_NAMES[specialOverlay.classId as LobsterClass] ??
                'Special'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
