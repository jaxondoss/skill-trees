"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom sheet dialog. Escape or the backdrop closes it; focus moves in on open and back on close.
 * Rendered on the body: a tile's backdrop filter would otherwise trap its fixed position and stacking.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("button, input, textarea, a")?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            className="absolute inset-0 bg-[rgba(4,4,10,0.7)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[20px] border border-[var(--border-strong)] bg-[#15151e] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-[var(--shadow-lift)] sm:mb-6 sm:rounded-[20px]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" aria-hidden />
            <h2 className="mb-3 text-lg font-extrabold">{title}</h2>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
