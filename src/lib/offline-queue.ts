import type { Tier } from "@/engine/types";

/**
 * Goal logs made without a connection (spec Phase 7). Kept in localStorage on this device,
 * one entry per goal (the latest tap wins), and replayed in order when back online.
 */
export type QueuedLog = { goalId: string; tier: Tier | null; note?: string | null; at: string };

const KEY = "forge.offline-queue";
type Store = Pick<Storage, "getItem" | "setItem">;

const listeners = new Set<() => void>();
let cache: { raw: string | null; list: QueuedLog[] } = { raw: null, list: [] };

function storage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readQueue(store: Store | null = storage()): QueuedLog[] {
  let raw: string | null = null;
  try {
    raw = store?.getItem(KEY) ?? null;
  } catch {
    return [];
  }
  if (raw === cache.raw) return cache.list;
  let list: QueuedLog[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((e): e is QueuedLog => typeof e?.goalId === "string" && typeof e?.at === "string");
  } catch {
    list = [];
  }
  cache = { raw, list };
  return list;
}

function write(list: QueuedLog[], store: Store | null) {
  try {
    store?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the log is lost, which the caller reports.
    return false;
  }
  listeners.forEach((l) => l());
  return true;
}

/** Adds or replaces the entry for a goal. Returns false when the device will not store it. */
export function enqueue(entry: QueuedLog, store: Store | null = storage()): boolean {
  if (!store) return false;
  const list = readQueue(store).filter((e) => e.goalId !== entry.goalId);
  return write([...list, entry], store);
}

export function removeFromQueue(entries: QueuedLog[], store: Store | null = storage()) {
  const done = new Set(entries.map((e) => `${e.goalId}|${e.at}`));
  write(
    readQueue(store).filter((e) => !done.has(`${e.goalId}|${e.at}`)),
    store,
  );
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: QueuedLog[] = [];
export const serverQueue = () => EMPTY;

/** A failed fetch to a server action (offline, DNS, dropped connection), as opposed to an app error. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}
