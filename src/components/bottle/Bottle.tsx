"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";
import type { BottleShape } from "@/lib/data/dashboard";

/**
 * Simple SVG apothecary bottles (spec 11.4). Phase 5 replaces the glass with generated art;
 * the liquid stays an SVG rect clipped by the interior path so it can sit at any exact level.
 */
type ShapeDef = {
  /** Glass outline. */
  outline: string;
  /** Interior the liquid is clipped to. */
  interior: string;
  /** Liquid surface range: y at 0% and at 100%. */
  bottom: number;
  top: number;
  cork: { x: number; y: number; w: number; h: number };
};

const SHAPES: Record<BottleShape, ShapeDef> = {
  // Business: tall, angular, faceted flask.
  faceted: {
    outline: "M24 18 H36 V30 L48 42 V92 L44 96 H16 L12 92 V42 L24 30 Z",
    interior: "M26 30 L38 32 L46 43 V91 L43 94 H17 L14 91 V43 L22 32 Z",
    bottom: 94,
    top: 34,
    cork: { x: 23, y: 9, w: 14, h: 10 },
  },
  // School: classic round-bottom laboratory flask.
  round: {
    outline: "M25 18 H35 V44 A26 26 0 1 1 25 44 Z",
    interior: "M27 44 A24 24 0 1 0 33 44 Z",
    bottom: 94,
    top: 46,
    cork: { x: 24, y: 9, w: 12, h: 10 },
  },
  // Mind: slender crystal vial with a faceted glass stopper.
  vial: {
    outline: "M21 22 H39 V88 A9 9 0 0 1 21 88 Z",
    interior: "M23 26 H37 V88 A7 7 0 0 1 23 88 Z",
    bottom: 95,
    top: 28,
    cork: { x: 24, y: 10, w: 12, h: 12 },
  },
  // Athletics: sturdy, wide-shouldered bottle.
  sturdy: {
    outline: "M23 18 H37 V26 L52 34 Q55 36 55 40 V90 Q55 96 49 96 H11 Q5 96 5 90 V40 Q5 36 8 34 L23 26 Z",
    interior: "M25 28 H35 L50 36 Q53 38 53 41 V90 Q53 94 48 94 H12 Q7 94 7 90 V41 Q7 38 10 36 Z",
    bottom: 94,
    top: 36,
    cork: { x: 22, y: 9, w: 16, h: 10 },
  },
  // Nutrition: organic teardrop.
  teardrop: {
    outline: "M25 18 H35 V32 C52 50 56 96 30 96 C4 96 8 50 25 32 Z",
    interior: "M27 34 H33 C49 52 52 94 30 94 C8 94 11 52 27 34 Z",
    bottom: 94,
    top: 38,
    cork: { x: 24, y: 9, w: 12, h: 10 },
  },
};

/** Two wave periods (30 units each) so the drift can loop seamlessly. */
const WAVE = "Q-22.5 -1.4 -15 0 T0 0 T15 0 T30 0 T45 0 T60 0 T75 0 T90 0";

export type BottleProps = {
  shape: BottleShape;
  color: string;
  /** 0 to 100 */
  level: number;
  neglected?: boolean;
  dormant?: boolean;
  /** Animate from empty on mount (archive cascade). */
  fillFromEmpty?: boolean;
  delay?: number;
  className?: string;
  label?: string;
};

export function Bottle({ shape, color, level, neglected, dormant, fillFromEmpty, delay = 0, className, label }: BottleProps) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const s = SHAPES[shape];
  const pct = dormant ? 0.04 : Math.max(0, Math.min(100, level)) / 100;
  const surface = s.bottom - pct * (s.bottom - s.top);
  const from = fillFromEmpty && !reduce ? s.bottom : surface;
  const spring = { type: "spring" as const, stiffness: 120, damping: 14, delay };

  return (
    <svg viewBox="0 0 60 100" className={className} role="img" aria-label={label}>
      <defs>
        <clipPath id={`in-${id}`}>
          <path d={s.interior} />
        </clipPath>
        <linearGradient id={`liq-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.95" />
          <stop offset="1" stopColor={color} stopOpacity="0.6" />
        </linearGradient>
        <pattern id={`dust-${id}`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.5" fill="#d8d2c4" opacity="0.35" />
          <circle cx="4" cy="4" r="0.4" fill="#d8d2c4" opacity="0.25" />
        </pattern>
      </defs>

      {/* glass body */}
      <path d={s.outline} fill="rgba(255,255,255,0.04)" />

      {/* liquid: the whole group rises to the level with a spring; the surface drifts as a wave */}
      <g clipPath={`url(#in-${id})`} opacity={neglected ? 0.6 : 1}>
        <motion.g initial={{ y: from }} animate={{ y: surface }} transition={spring}>
          <g className={reduce ? undefined : "wave"}>
            <path d={`M-30 0 ${WAVE} V110 H-30 Z`} fill={`url(#liq-${id})`} />
            <path d={`M-30 0 ${WAVE}`} fill="none" stroke={color} strokeWidth="1.2" style={{ filter: "brightness(1.7)" }} opacity="0.9" />
          </g>
          {pct > 0.5 && !reduce && !dormant && (
            <g aria-hidden>
              {[14, 30, 44].map((x, i) => (
                <circle
                  key={x}
                  cx={x}
                  cy={(s.bottom - surface) * 0.9}
                  r={0.9 + (i % 2) * 0.4}
                  fill="white"
                  opacity="0.5"
                  className="bubble"
                  style={{ animationDelay: `${i * 1.4}s`, ["--rise" as string]: `${-(s.bottom - surface) * 0.85}px` }}
                />
              ))}
            </g>
          )}
          {/* A burst of bubbles each time the level changes. */}
          {pct > 0 && !reduce && (
            <g key={Math.round(level)} aria-hidden>
              {[22, 30, 38, 27].map((x, i) => (
                <circle key={i} cx={x} cy={3} r={0.8} fill="white" className="burst" style={{ animationDelay: `${0.5 + i * 0.07}s` }} />
              ))}
            </g>
          )}
        </motion.g>
      </g>

      {/* glass outline and highlight */}
      <path d={s.outline} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d={`M${s.cork.x + 3} ${s.top + 6} v${(s.bottom - s.top) * 0.45}`} stroke="rgba(255,255,255,0.18)" strokeWidth="2" strokeLinecap="round" />
      {neglected && <path d={s.outline} fill={`url(#dust-${id})`} />}

      {/* cork, or a wax seal while dormant */}
      <rect {...s.cork} rx="2" fill="#7b5a3c" />
      {dormant && <circle cx={s.cork.x + s.cork.w / 2} cy={s.cork.y + s.cork.h - 1} r="6.5" fill="#7A1018" stroke="#5a0c12" />}
    </svg>
  );
}
