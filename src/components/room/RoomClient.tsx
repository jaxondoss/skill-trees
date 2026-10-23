"use client";

import { useEffect, useRef, useState } from "react";
import { completeGoal, swapGoal, type ActionResult } from "@/app/actions";
import { abandonRelic, achieveRelic, createRelic, saveFocusLine, updateRelicSteps } from "@/app/relic-actions";
import { addMetric } from "@/app/skill-actions";
import type { RoomData } from "@/lib/data/room";
import "./room.css";

/**
 * The v3 room in the app: injects window.ROOM_DATA, loads the room's classic scripts from public/room in order
 * (they attach to window.ROOM), and bridges the room's events to the server actions. The room keeps its own
 * optimistic state; fresh server data is applied once no save is in flight.
 */

const SCRIPTS = [
  "art.js",
  "engine/core.js",
  "engine/camera.js",
  "engine/decode.js",
  "engine/render.js",
  "engine/overlay.js",
  "engine/input.js",
  "engine/fx.js",
  "engine/glow.js",
  "ui/sound.js",
  "ui/strip.js",
  "ui/today.js",
  "ui/panel.js",
  "ui/help.js",
  "ui/relics.js",
  "engine/main.js",
];

type Room = {
  data: unknown;
  on: (name: string, fn: (d: Record<string, unknown>) => void) => () => void;
  emit: (name: string, d?: unknown) => void;
  invalidate?: () => void;
  render?: unknown;
};
type W = Window & { ROOM?: Room; ROOM_DATA?: unknown; ROOM_ROUTE?: { base: string }; __roomLoading?: boolean };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `/room/${src}`;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.body.appendChild(s);
  });
}

/** "$1,000" or "1000 mi" -> 1000; anything with words around it is not a numeric target. */
function numericTarget(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = /^\s*\$?\s*([\d,]+(?:\.\d+)?)\s*[a-z%$]{0,6}\s*$/i.exec(t);
  if (!m) return null;
  const v = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function RoomClient({ data }: { data: RoomData }) {
  const [status, setStatus] = useState<string | null>(null);
  const pending = useRef(0);
  const latest = useRef(data);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fresh server data (after refresh()): apply it to the running room when no save is in flight.
  useEffect(() => {
    latest.current = data;
    const room = (window as W).ROOM;
    if (room?.render && pending.current === 0) {
      room.data = clone(data);
      room.emit("data", {});
      room.invalidate?.();
    }
  }, [data]);

  useEffect(() => {
    const w = window as W;
    // The room's scripts are globals and cannot be torn down: a second mount in one document reloads it.
    if (w.ROOM?.render && !w.__roomLoading) {
      window.location.reload();
      return;
    }
    if (w.__roomLoading) return; // React strict mode runs this effect twice in development
    w.__roomLoading = true;
    w.ROOM_DATA = { sample: clone(latest.current), fresh: clone(latest.current) };
    w.ROOM_ROUTE = { base: window.location.pathname === "/" ? "/" : "/room" };

    const say = (msg: string) => {
      setStatus(msg);
      clearTimeout(statusTimer.current);
      statusTimer.current = setTimeout(() => setStatus(null), 5000);
    };
    const save = (p: Promise<ActionResult | { ok: boolean; error?: string }>, after?: (r: { ok: boolean }) => void) => {
      pending.current++;
      p.then(
        (r) => {
          if (!r.ok) say(("error" in r && r.error) || "That did not save.");
          after?.(r);
        },
        () => say("Offline. That did not save."),
      ).finally(() => {
        pending.current--;
        const room = w.ROOM;
        if (pending.current === 0 && room) {
          room.data = clone(latest.current);
          room.emit("data", {});
          room.invalidate?.();
        }
      });
    };
    const skillId = (slug: unknown) => (latest.current.skills.find((s) => s.slug === slug) ?? null)?.id ?? null;

    (async () => {
      try {
        for (const src of SCRIPTS) await loadScript(src);
      } catch (e) {
        say(e instanceof Error ? e.message : "The room did not load.");
        return;
      }
      const room = w.ROOM!;
      w.__roomLoading = false;
      room.on("log", (d) => save(completeGoal(String(d.goalId), (d.result as "floor" | "standard" | "stretch" | null) ?? null)));
      room.on("swap", (d) => save(swapGoal(String(d.goalId))));
      room.on("focus", (d) => save(saveFocusLine(String(d.line ?? ""))));
      room.on("bodyweight", (d) => {
        const id = skillId("strength");
        if (id) save(addMetric(id, "bodyweight_lb", Number(d.lb)));
      });
      room.on("metric", (d) => {
        const id = skillId(d.skill);
        if (id && d.key) save(addMetric(id, String(d.key), Number(d.value)));
        else say("This skill logs on its own page.");
      });
      room.on("relic", (d) => {
        const op = d.op;
        if (op === "create") {
          const r = d.relic as { title: string; icon?: string; skill?: string | null; target?: string | null; steps?: { text: string; done: boolean }[] | null; deadline?: string | null };
          save(
            createRelic({
              slot: d.slot as "left" | "window" | "right",
              catalogId: r.icon ?? null,
              title: r.title,
              skillSlug: r.skill || null,
              target: numericTarget(r.target),
              steps: (r.steps ?? []).filter((s) => s.text),
              deadline: r.deadline || null,
            }),
            (res) => {
              const slots = (room.data as { relics?: { slots: Record<string, { id?: string } | null> } }).relics?.slots;
              const got = res as { ok: boolean; data?: { id: string } };
              if (got.ok && got.data && slots?.[String(d.slot)]) slots[String(d.slot)]!.id = got.data.id;
            },
          );
        } else if (!d.id) say("Wait a moment, that relic is still saving.");
        else if (op === "steps") save(updateRelicSteps(String(d.id), d.steps as { text: string; done: boolean }[]));
        else if (op === "achieve") save(achieveRelic(String(d.id)));
        else if (op === "abandon") save(abandonRelic(String(d.id)));
      });
    })();

    return () => {
      // Leaving the room for another page (not a strict-mode remount): reload so the globals go away.
      setTimeout(() => {
        if (!document.getElementById("room-stage")) window.location.reload();
      }, 0);
    };
  }, []);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/room/styles.css" precedence="room" />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/room/ui/ui.css" precedence="room" />
      <main id="room-stage" aria-label="Your room">
        <canvas id="room-canvas" role="img" aria-label="Pixel-art room. Use the object buttons, keys 1 to 7, the arrow keys, or the zone dots to look around." />
        <div id="room-hotspots" />
      </main>
      <nav id="zone-dots" aria-label="Zones" />
      <div id="room-live" className="sr-only" aria-live="polite" />
      <div id="svh-probe" aria-hidden="true" />
      <a href="/board" className="room-board-link" data-k="board-link">
        Board
      </a>
      <p className="room-status" role="status" aria-live="polite" hidden={!status}>
        {status}
      </p>
    </>
  );
}
