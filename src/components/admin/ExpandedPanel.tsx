"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * The expanded tile: a large panel over the grid that grows from the tile's rect (FLIP, 220 ms; instant with reduced
 * motion). Esc or a click on the scrim closes it; Tab stays inside while it is open; focus starts on the heading.
 */
export function ExpandedPanel({ title, num, originRef, onClose, children }: { title: string; num: string; originRef: RefObject<DOMRect | null>; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const from = originRef.current;
    originRef.current = null; // animate from a tile once; a later mount (Back, a shared link) opens in place
    head.current?.focus({ preventScroll: true });
    if (!el || !from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    el.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    el.getBoundingClientRect(); // commit the start frame
    el.classList.add("is-animating");
    el.style.transform = "";
    const done = () => el.classList.remove("is-animating");
    el.addEventListener("transitionend", done, { once: true });
    return () => el.removeEventListener("transitionend", done);
    // the panel animates once, when it mounts for this tile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // a dialog inside the dashboard (journal, sheet) closes first
        if (document.querySelector("dialog[open]")) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (n) => n.offsetParent !== null,
      );
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === head.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="adm-scrim" onClick={onClose} aria-hidden />
      <div ref={ref} className="adm-panel" role="dialog" aria-modal="true" aria-labelledby="adm-panel-title" data-admin-panel>
        <div className="adm-panel-head">
          <h2 id="adm-panel-title" ref={head} tabIndex={-1}>
            <span className="t-num">{num}</span>
            {title}
          </h2>
          <button type="button" className="adm-btn" onClick={onClose} aria-label="Close, back to the plan (Esc)">
            ESC
          </button>
        </div>
        <div className="adm-panel-body">{children}</div>
      </div>
    </>
  );
}
