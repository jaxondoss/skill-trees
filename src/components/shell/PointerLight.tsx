"use client";

import { useEffect } from "react";

/** Dynamic light: tile edges and washes follow the pointer (sets --mx and --my on nearby tiles). */
export function PointerLight() {
  useEffect(() => {
    if (!matchMedia("(hover: hover)").matches) return;
    let raf = 0,
      x = 0,
      y = 0;
    const paint = () => {
      raf = 0;
      for (const el of document.querySelectorAll<HTMLElement>(".tile, .glass, .dock")) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -300 || r.top > window.innerHeight + 300) continue;
        el.style.setProperty("--mx", `${x - r.left}px`);
        el.style.setProperty("--my", `${y - r.top}px`);
      }
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return null;
}
