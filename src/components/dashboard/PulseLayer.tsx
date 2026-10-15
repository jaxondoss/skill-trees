"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { PULSE_EVENT } from "@/lib/pulse";

type Line = { categoryId: string; from: [number, number]; to: [number, number]; color: string };

/** Renders inside the figure stage SVG: a pulse of light runs down a category's line on completion. */
export function PulseLayer({ lines }: { lines: Line[] }) {
  const [pulses, setPulses] = useState<{ key: number; line: Line }[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onPulse = (e: Event) => {
      const line = lines.find((l) => l.categoryId === (e as CustomEvent<{ categoryId: string }>).detail.categoryId);
      if (line) setPulses((p) => [...p, { key: Date.now() + Math.random(), line }]);
    };
    window.addEventListener(PULSE_EVENT, onPulse);
    return () => window.removeEventListener(PULSE_EVENT, onPulse);
  }, [lines]);

  const done = (key: number) => setPulses((p) => p.filter((x) => x.key !== key));

  return (
    <g aria-hidden>
      <AnimatePresence>
        {pulses.map(({ key, line }) =>
          reduce ? (
            <motion.circle
              key={key}
              cx={line.to[0]}
              cy={line.to[1]}
              r={3}
              fill={line.color}
              initial={{ opacity: 0.8 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              onAnimationComplete={() => done(key)}
            />
          ) : (
            <g key={key}>
              <motion.circle
                r={1.3}
                fill={line.color}
                style={{ filter: `drop-shadow(0 0 2px ${line.color})` }}
                initial={{ cx: line.from[0], cy: line.from[1], opacity: 1 }}
                animate={{ cx: line.to[0], cy: line.to[1], opacity: [1, 1, 0.9] }}
                transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
              />
              <motion.circle
                cx={line.to[0]}
                cy={line.to[1]}
                fill="#D4AF37"
                initial={{ r: 0, opacity: 0 }}
                animate={{ r: [0, 6, 9], opacity: [0, 0.55, 0] }}
                transition={{ duration: 0.55, delay: 0.5, ease: "easeOut" }}
                onAnimationComplete={() => done(key)}
              />
            </g>
          ),
        )}
      </AnimatePresence>
    </g>
  );
}
