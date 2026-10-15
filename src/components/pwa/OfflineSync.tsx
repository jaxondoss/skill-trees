"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { replayGoal } from "@/app/actions";
import { isNetworkError, readQueue, removeFromQueue, serverQueue, subscribeQueue } from "@/lib/offline-queue";

export const useQueue = () => useSyncExternalStore(subscribeQueue, () => readQueue(), serverQueue);

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

/**
 * Registers the service worker (production builds only) and replays offline goal logs
 * whenever the connection comes back. Shows one quiet line while anything is waiting.
 */
export function OfflineSync() {
  const queue = useQueue();
  const online = useOnline();
  const router = useRouter();
  const syncing = useRef(false);
  const [dropped, setDropped] = useState(0);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  const flush = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    const pending = readQueue();
    if (!pending.length) return;
    syncing.current = true;
    const done: typeof pending = [];
    let rejected = 0;
    try {
      for (const e of pending) {
        try {
          const r = await replayGoal(e.goalId, e.tier, e.note, e.at);
          done.push(e);
          if (!r.ok) rejected += 1;
        } catch (err) {
          if (isNetworkError(err)) break;
          done.push(e);
          rejected += 1;
        }
      }
    } finally {
      syncing.current = false;
    }
    if (done.length) {
      removeFromQueue(done);
      if (rejected) setDropped((d) => d + rejected);
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    if (!online || !queue.length) return;
    const id = requestAnimationFrame(() => void flush());
    return () => cancelAnimationFrame(id);
  }, [online, queue.length, flush]);

  if (!queue.length && online && !dropped) return null;
  const pill = "fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+8px)] z-40 mx-auto w-fit max-w-[90vw] rounded-full border border-border bg-bg/95 px-4 py-2 text-center text-xs text-muted";
  if (online && !queue.length) {
    return (
      <button type="button" onClick={() => setDropped(0)} className={`${pill} min-h-11`}>
        {dropped} offline log{dropped === 1 ? "" : "s"} could not sync (the day had moved on). Dismiss
      </button>
    );
  }
  return (
    <p role="status" className={pill}>
      {!online
        ? queue.length
          ? `Offline. ${queue.length} log${queue.length === 1 ? "" : "s"} saved on this phone; they sync when you reconnect.`
          : "Offline. Logs you make now sync when you reconnect."
        : "Syncing offline logs."}
    </p>
  );
}
