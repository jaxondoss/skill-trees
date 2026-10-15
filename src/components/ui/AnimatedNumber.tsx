"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect } from "react";

/** A whole number that ticks to its new value (spec 11.4: "number ticks up"). Tabular, so it never jitters. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const shown = useTransform(mv, (v) => Math.round(v));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.8, ease: [0.2, 0.8, 0.2, 1] });
    return () => controls.stop();
  }, [value, reduce, mv]);

  return <motion.span className={`num ${className ?? ""}`}>{shown}</motion.span>;
}
