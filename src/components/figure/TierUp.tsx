"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ackTierUp } from "@/app/actions";
import { playBell } from "@/lib/sound";
import { Figure } from "./Figure";
import type { Region } from "./geometry";

/**
 * Tier-up moment (spec 5.2): background dims, veins spread in real time, a struck bell,
 * and "Tier III: Forged". Under 3 seconds; tap to dismiss sooner.
 */
export function TierUp({ tier, numeral, name, scores, soundOn }: { tier: number; numeral: string; name: string; scores: Partial<Record<Region, number>>; soundOn: boolean }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    void ackTierUp(tier);
    if (soundOn) playBell();
    const t = setTimeout(() => setOpen(false), 2900);
    return () => clearTimeout(t);
  }, [tier, soundOn]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="alertdialog"
          aria-label={`Tier ${numeral}: ${name}`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          onClick={() => setOpen(false)}
        >
          <svg viewBox="28 16 44 114" className="h-[62dvh] max-h-[560px]" aria-hidden>
            <Figure id="tierup" tier={tier} scores={scores} drawVeins />
          </svg>
          <motion.p
            className="font-display text-3xl text-gold"
            initial={{ opacity: 0, y: 8, letterSpacing: "0.02em" }}
            animate={{ opacity: 1, y: 0, letterSpacing: "0.08em" }}
            transition={{ delay: 0.9, duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
          >
            Tier {numeral}: {name}
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
