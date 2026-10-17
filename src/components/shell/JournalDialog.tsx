"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveJournal } from "@/app/todo-actions";
import { JOURNAL_EVENT } from "@/lib/journal-event";
import { centerOf, emitPulse } from "@/lib/pulse";

const MOODS = [
  ["heavy", "Heavy"],
  ["strained", "Strained"],
  ["steady", "Steady"],
  ["clear", "Clear"],
  ["locked_in", "Locked in"],
] as const;
const PROMPTS = [
  "What is in your control right now?",
  "What did you do well today?",
  "What got in your way, and was it yours to fix?",
  "What would the person you are becoming do next?",
];

/** The journal (quick log saved to Mind): opened from the dock, the board, or the L key. */
export function JournalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState(PROMPTS[0]!);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<(typeof MOODS)[number][0] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const open = () => {
      setPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]!);
      setBody("");
      setMood(null);
      setError(null);
      ref.current?.showModal();
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener(JOURNAL_EVENT, open);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(JOURNAL_EVENT, open);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <>
      <dialog
        ref={ref}
        aria-labelledby="journal-h"
        className="m-auto w-[min(520px,calc(100vw-32px))] overscroll-contain rounded-2xl border border-[var(--border-strong)] bg-[#15151e] p-0 text-text shadow-[var(--shadow-lift)] backdrop:bg-[rgba(4,4,10,0.7)]"
      >
        <form
          className="grid gap-3.5 p-[22px]"
          onSubmit={(e) => {
            e.preventDefault();
            const from = centerOf((e.nativeEvent as SubmitEvent).submitter);
            start(async () => {
              const r = await saveJournal({ body: body.trim(), mood });
              if (!r.ok) return setError(r.error);
              ref.current?.close();
              setStatus("Saved to Mind.");
              emitPulse("mind", { category: "mind", gain: 0.2, from });
            });
          }}
        >
          <h2 id="journal-h" className="text-lg font-extrabold">
            Journal
          </h2>
          <p className="text-[15px] text-muted">{prompt}</p>
          <label htmlFor="journal-body" className="sr-only">
            Entry
          </label>
          <textarea
            id="journal-body"
            name="entry"
            rows={4}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened, what you noticed, what you will do…"
            autoComplete="off"
            className="field-input w-full"
          />
          <div>
            <div className="lbl mb-2">Head right now</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Head right now">
              {MOODS.map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={mood === v}
                  onClick={() => setMood(mood === v ? null : v)}
                  className="min-h-[34px] rounded-lg border border-[var(--border)] bg-sunk px-3 text-xs font-semibold text-muted aria-pressed:border-transparent aria-pressed:bg-mind aria-pressed:text-[var(--on-cat)]"
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-athletics">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="min-h-10 rounded-lg border border-[var(--border)] bg-raised px-3.5 text-xs font-bold">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="c-mind min-h-10 rounded-lg bg-[var(--c)] px-3.5 text-xs font-bold text-[var(--on-cat)] disabled:opacity-60">
              {pending ? "Saving…" : "Save to Mind"}
            </button>
          </div>
        </form>
      </dialog>
      {status && (
        <p role="status" className="fixed bottom-[calc(96px+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full bg-text px-4 py-2 text-[13px] font-semibold text-bg shadow-lg">
          {status}
        </p>
      )}
    </>
  );
}

export function JournalButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(JOURNAL_EVENT))}>
      {children}
    </button>
  );
}
