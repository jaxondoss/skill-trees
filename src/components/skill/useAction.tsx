"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";

type DataResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs a server action in a transition and renders its one-line outcome. */
export function useAction() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>, success?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? (success ? { ok: true, text: success } : null) : { ok: false, text: r.error });
      if (r.ok) after?.();
    });
  const runData = <T,>(fn: () => Promise<DataResult<T>>, onData: (data: T) => void) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? null : { ok: false, text: r.error });
      if (r.ok) onData(r.data);
    });
  const line = message && (
    <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-nutrition" : "text-athletics"}`}>
      {message.text}
    </p>
  );
  return { pending, run, runData, line };
}
