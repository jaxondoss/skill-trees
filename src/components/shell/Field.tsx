"use client";

import { useEffect, useRef, useState } from "react";
import { LOOK_EVENT, readLook, type FieldMode } from "@/lib/look";
import { FIELD_BURST_EVENT, type FieldBurst } from "@/lib/pulse";

const COLORS: Record<string, string> = {
  business: "200,133,14",
  school: "70,118,242",
  athletics: "227,70,75",
  mind: "169,102,229",
  nutrition: "0,167,93",
  gold: "212,175,55",
};
const PULSE_COLORS = Object.values(COLORS).slice(0, 5);

type Trace = { pts: [number, number][]; lens: number[]; total: number };
type Pulse = { t: Trace; d: number; v: number; c: string; len: number; a: number };

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The field behind the board (spec v2 r2, 8): a dot grid with circuit traces, three slow pools of light that
 * breathe, sparse data pulses along the traces, and a soft light under the pointer. A power-up rings out from
 * the statue. Capped at 30fps, paused when hidden, one static frame with reduced motion.
 */
export function Field() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<FieldMode>("live");

  useEffect(() => {
    const sync = () => setMode(readLook().field);
    const t = setTimeout(sync, 0);
    window.addEventListener(LOOK_EVENT, sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener(LOOK_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const m = reduce ? "still" : mode;
    let W = 0,
      H = 0,
      dpr = 1,
      raf = 0,
      last = 0;
    let layer: HTMLCanvasElement | null = null;
    let traces: Trace[] = [];
    let pulses: Pulse[] = [];
    let bursts: { x: number; y: number; c: string; t0: number }[] = [];
    const mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4 };

    const buildLayer = () => {
      layer = document.createElement("canvas");
      layer.width = cv.width;
      layer.height = cv.height;
      const c = layer.getContext("2d")!;
      c.scale(dpr, dpr);
      const step = 28,
        r = rng(9);
      c.fillStyle = "rgba(160,170,255,0.075)";
      for (let x = step / 2; x < W; x += step) for (let y = step / 2; y < H; y += step) c.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      traces = [];
      const count = Math.round((W * H) / 26000);
      for (let k = 0; k < count; k++) {
        let x = Math.floor(r() * (W / step)) * step + step / 2;
        let y = Math.floor(r() * (H / step)) * step + step / 2;
        const pts: [number, number][] = [[x, y]];
        const segs = 2 + Math.floor(r() * 4);
        let dir = r() < 0.5 ? 0 : 1;
        for (let s = 0; s < segs; s++) {
          const len = (2 + Math.floor(r() * 7)) * step * (r() < 0.5 ? -1 : 1);
          if (dir === 0) x += len;
          else y += len;
          // A 45 degree jog, like a board trace.
          if (s % 2 === 1 && r() < 0.45) {
            const dd = step * (r() < 0.5 ? -1 : 1);
            x += dd;
            y += dd;
          }
          pts.push([x, y]);
          dir = 1 - dir;
        }
        const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
        traces.push({ pts, lens, total: lens.reduce((a, b) => a + b, 0) });
      }
      c.lineWidth = 1;
      c.lineJoin = "round";
      c.strokeStyle = "rgba(150,160,255,0.065)";
      for (const t of traces) {
        c.beginPath();
        t.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.stroke();
        const e = t.pts[t.pts.length - 1]!;
        c.fillStyle = "rgba(150,160,255,0.12)";
        c.beginPath();
        c.arc(e[0], e[1], 2, 0, 7);
        c.fill();
      }
    };

    const at = (t: Trace, d: number): [number, number] => {
      let k = 0;
      while (k < t.lens.length - 1 && d > t.lens[k]!) {
        d -= t.lens[k]!;
        k++;
      }
      const a = t.pts[k]!,
        b = t.pts[k + 1]!,
        f = Math.max(0, Math.min(1, d / (t.lens[k] || 1)));
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };

    const spawn = (color?: string, near?: [number, number]) => {
      if (!traces.length) return;
      let t = traces[Math.floor(Math.random() * traces.length)]!;
      if (near) {
        let best = Infinity;
        for (const tr of traces) {
          const d = Math.hypot(tr.pts[0]![0] - near[0], tr.pts[0]![1] - near[1]);
          if (d < best && Math.random() < 0.6) {
            best = d;
            t = tr;
          }
        }
      }
      pulses.push({ t, d: 0, v: 60 + Math.random() * 90, c: color ?? PULSE_COLORS[Math.floor(Math.random() * 5)]!, len: 40 + Math.random() * 50, a: near ? 0.9 : 0.35 + Math.random() * 0.25 });
    };

    const frame = (now: number, force = false) => {
      raf = 0;
      if (!force && (document.hidden || m === "still")) return;
      if (!force && now - last < 30) {
        raf = requestAnimationFrame((n) => frame(n));
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const t = now / 1000,
        live = m === "live" ? 1 : 0.6;
      const pools: [number, number, string, number][] = [
        [0.18 + 0.06 * Math.sin(t / 11), 0.12 + 0.05 * Math.cos(t / 13), "124,96,255", 0.13],
        [0.86 + 0.05 * Math.cos(t / 12), 0.3 + 0.08 * Math.sin(t / 9), "70,118,242", 0.1],
        [0.4 + 0.1 * Math.sin(t / 15), 1.02, "212,175,55", 0.07],
      ];
      pools.forEach(([fx, fy, col, a], i) => {
        const x = fx * W,
          y = fy * H,
          rr = Math.max(W, H) * 0.55,
          al = a * (0.8 + 0.2 * Math.sin(t / 4 + i * 2)) * live;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, `rgba(${col},${al})`);
        gr.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
      });
      if (layer) {
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t / 3.2);
        ctx.drawImage(layer, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      mouse.x += (mouse.tx - mouse.x) * 0.12;
      mouse.y += (mouse.ty - mouse.y) * 0.12;
      if (mouse.x > -1000) {
        const gr = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 300);
        gr.addColorStop(0, "rgba(180,190,255,0.075)");
        gr.addColorStop(1, "rgba(180,190,255,0)");
        ctx.fillStyle = gr;
        ctx.fillRect(mouse.x - 300, mouse.y - 300, 600, 600);
      }
      if (!force) {
        const want = m === "live" ? 10 : 3;
        if (pulses.length < want && Math.random() < (m === "live" ? 0.08 : 0.02)) spawn();
      }
      ctx.lineCap = "round";
      pulses = pulses.filter((p) => {
        if (!force) p.d += p.v * dt;
        const tail = Math.max(0, p.d - p.len),
          steps = 8;
        for (let k = 0; k < steps; k++) {
          const d0 = tail + ((p.d - tail) * k) / steps,
            d1 = tail + ((p.d - tail) * (k + 1)) / steps;
          if (d0 > p.t.total) break;
          const a = at(p.t, d0),
            b = at(p.t, Math.min(d1, p.t.total));
          ctx.strokeStyle = `rgba(${p.c},${(p.a * (k + 1)) / steps})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        if (p.d <= p.t.total) {
          const h = at(p.t, p.d);
          const gr = ctx.createRadialGradient(h[0], h[1], 0, h[0], h[1], 9);
          gr.addColorStop(0, `rgba(${p.c},${p.a})`);
          gr.addColorStop(1, `rgba(${p.c},0)`);
          ctx.fillStyle = gr;
          ctx.fillRect(h[0] - 9, h[1] - 9, 18, 18);
        }
        return p.d < p.t.total + p.len;
      });
      bursts = bursts.filter((b) => {
        const k = (now - b.t0) / 1100;
        if (k >= 1) return false;
        const rr = 40 + k * 700;
        ctx.strokeStyle = `rgba(${b.c},${0.5 * (1 - k)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, rr, 0, 7);
        ctx.stroke();
        const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, rr);
        gr.addColorStop(0, `rgba(${b.c},${0.12 * (1 - k)})`);
        gr.addColorStop(1, `rgba(${b.c},0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(b.x - rr, b.y - rr, rr * 2, rr * 2);
        return true;
      });
      if (!force) raf = requestAnimationFrame((n) => frame(n));
    };

    const start = () => {
      if (!raf && m !== "still") raf = requestAnimationFrame((n) => frame(n));
    };
    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      buildLayer();
      if (m === "still") frame(performance.now(), true);
    };
    let rz: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(rz);
      rz = setTimeout(resize, 150);
    };
    const onMove = (e: PointerEvent) => {
      mouse.tx = e.clientX;
      mouse.ty = e.clientY;
      if (mouse.x < -1000) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
      }
    };
    const onBurst = (e: Event) => {
      const { x, y, category } = (e as CustomEvent<FieldBurst>).detail;
      const c = COLORS[category] ?? COLORS.gold!;
      bursts.push({ x, y, c, t0: performance.now() });
      for (let i = 0; i < 6; i++) spawn(c, [x, y]);
      if (m === "still") frame(performance.now(), true);
      else start();
    };

    resize();
    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", start);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener(FIELD_BURST_EVENT, onBurst);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(rz);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", start);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener(FIELD_BURST_EVENT, onBurst);
    };
  }, [mode]);

  return (
    <>
      <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-20 block h-dvh w-screen" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "radial-gradient(120% 80% at 50% 0%, transparent 40%, rgba(5,5,10,0.55) 100%)" }}
      />
    </>
  );
}
