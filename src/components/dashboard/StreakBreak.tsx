"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ackStreakBreak } from "@/app/actions";
import { playCrack } from "@/lib/sound";

/**
 * Visible streak loss (spec 10): the number cracks apart along a gold kintsugi seam
 * (about 1.2 s), then "Streak ended at N. Best: M." Tap to dismiss.
 */
export function StreakBreak({ length, best, soundOn }: { length: number; best: number; soundOn: boolean }) {
  const [open, setOpen] = useState(true);
  const [stage, setStage] = useState<"crack" | "text">("crack");

  useEffect(() => {
    if (soundOn) playCrack();
    const t = setTimeout(() => setStage("text"), 1200);
    return () => clearTimeout(t);
  }, [soundOn]);

  const dismiss = () => {
    setOpen(false);
    void ackStreakBreak();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="alertdialog"
          aria-label={`Streak ended at ${length}. Best: ${best}.`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black/85"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
        >
          <div className="relative font-display text-8xl leading-none">
            <motion.span
              className="num inline-block"
              style={{ clipPath: "polygon(0 0, 58% 0, 44% 38%, 56% 62%, 40% 100%, 0 100%)" }}
              animate={{ x: -10, y: 4, rotate: -6, opacity: 0.85 }}
              transition={{ delay: 0.35, duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {length}
            </motion.span>
            <motion.span
              className="num absolute inset-0 inline-block"
              style={{ clipPath: "polygon(58% 0, 100% 0, 100% 100%, 40% 100%, 56% 62%, 44% 38%)" }}
              animate={{ x: 10, y: -2, rotate: 5, opacity: 0.85 }}
              transition={{ delay: 0.35, duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {length}
            </motion.span>
            <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="none" aria-hidden>
              <motion.path
                d="M58 0 L44 38 L56 62 L40 100"
                stroke="#D4AF37"
                strokeWidth="1.6"
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, ease: "easeIn" }}
              />
            </svg>
          </div>
          <AnimatePresence>
            {stage === "text" && (
              <motion.p className="text-center text-base text-text" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                Streak ended at <span className="num">{length}</span>. Best: <span className="num">{best}</span>.
                <span className="mt-2 block text-xs text-muted">Tap to continue</span>
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
