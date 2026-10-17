"use client";

import { useEffect, useRef, useState } from "react";
import { emitBurst, PULSE_EVENT, type PulseDetail } from "@/lib/pulse";
import { readLook } from "@/lib/look";
import { CATEGORY_ORDER, MARK, isCategorySlug } from "@/lib/palette";

type Cat = { id: string; slug: string; name: string; score: number | null };
type Tier = { tier: number; numeral: string; name: string; next: number | null };

/** Where each category's light enters the statue, as fractions of the image (spec v2 7.2). */
const PORT: Record<string, [number, number]> = {
  business: [0.335, 0.33],
  school: [0.665, 0.33],
  athletics: [0.445, 0.64],
  mind: [0.5, 0.1],
  nutrition: [0.555, 0.64],
};
/** Seven region clips of the vein layer and the category each belongs to. */
const REGIONS: [string, string, [number, number][]][] = [
  ["head", "mind", [[0.38, 0], [0.62, 0], [0.62, 0.215], [0.38, 0.215]]],
  ["larm", "business", [[0.18, 0.2], [0.405, 0.2], [0.405, 0.3], [0.39, 0.45], [0.37, 0.64], [0.18, 0.64]]],
  ["rarm", "school", [[0.595, 0.2], [0.82, 0.2], [0.82, 0.64], [0.63, 0.64], [0.61, 0.45], [0.595, 0.3]]],
  ["chest", "nutrition", [[0.405, 0.2], [0.595, 0.2], [0.595, 0.3], [0.6, 0.37], [0.4, 0.37], [0.405, 0.3]]],
  ["core", "athletics", [[0.4, 0.37], [0.6, 0.37], [0.63, 0.53], [0.37, 0.53]]],
  ["lleg", "athletics", [[0.28, 0.53], [0.5, 0.53], [0.5, 1], [0.28, 1]]],
  ["rleg", "nutrition", [[0.5, 0.53], [0.72, 0.53], [0.72, 1], [0.5, 1]]],
];
const REACH = [0, 0, 30, 58, 92, 160];
const AURA = [0, 0.12, 0.3, 0.5, 0.75, 1];

function rays() {
  const cx = 200,
    cy = 200;
  let d = "";
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + (i % 3) * 0.02,
      r1 = 120 + ((i * 37) % 40),
      r2 = 260 + ((i * 53) % 120);
    d += `M${(cx + r1 * Math.cos(a)).toFixed(1)} ${(cy + r1 * Math.sin(a)).toFixed(1)}L${(cx + r2 * Math.cos(a)).toFixed(1)} ${(cy + r2 * Math.sin(a)).toFixed(1)}`;
  }
  return d;
}
const RAYS = rays();

/** One fixed SVG on the body for comet trails (a tile's backdrop filter would trap a fixed child). */
function fxLayer(): SVGSVGElement {
  let svg = document.getElementById("fx-layer") as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "fx-layer";
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "pointer-events-none fixed inset-0 z-40 h-dvh w-screen overflow-visible");
    document.body.appendChild(svg);
  }
  return svg;
}

/** The statue tile: overall score, tier, five category rows, and the statue that takes the power-up. */
export function StatueHero({ overall, tier, categories }: { overall: number; tier: Tier; categories: Cat[] }) {
  const hero = useRef<HTMLElement>(null);
  const statue = useRef<HTMLDivElement>(null);
  const px = useRef<HTMLDivElement>(null);
  const surge = useRef<HTMLDivElement>(null);
  const raysRef = useRef<SVGSVGElement>(null);
  const halftone = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [hl, setHl] = useState<string | null>(null);
  const byCat = new Map(categories.map((c) => [c.id, c]));
  const ordered = CATEGORY_ORDER.map((slug) => categories.find((c) => c.slug === slug)).filter((c): c is Cat => !!c);

  // Hover anything that belongs to a category: its region lights, the rest dims.
  useEffect(() => {
    const onOver = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-cat]") as HTMLElement | null;
      const slug = el?.dataset.cat ?? null;
      setHl(isCategorySlug(slug) ? slug : null);
    };
    document.addEventListener("pointerover", onOver);
    return () => document.removeEventListener("pointerover", onOver);
  }, []);

  // Parallax: the statue drifts a few pixels against the pointer.
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = hero.current?.getBoundingClientRect();
        if (!r || !px.current) return;
        const nx = (e.clientX - r.left) / r.width - 0.5,
          ny = (e.clientY - r.top) / r.height - 0.5;
        if (Math.abs(nx) < 1 && Math.abs(ny) < 1) px.current.style.transform = `translate(${(-nx * 8).toFixed(1)}px, ${(-ny * 5).toFixed(1)}px)`;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  // The power-up: a comet from the control you tapped to the category's point on the statue, then the surge.
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const onPulse = (e: Event) => {
      const d = (e as CustomEvent<PulseDetail>).detail;
      const slug = d.category ?? byCat.get(d.categoryId)?.slug;
      if (!slug || !statue.current) return;
      const r = statue.current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      const port = PORT[slug] ?? [0.5, 0.3];
      const end = { x: r.left + port[0] * r.width, y: r.top + port[1] * r.height };
      const color = MARK[slug as keyof typeof MARK] ?? "#d4af37";
      const impact = () => {
        emitBurst({ x: end.x, y: end.y, category: slug });
        if (d.skillId) {
          for (const t of document.querySelectorAll(`[data-skill-tile="${d.skillId}"]`)) {
            t.classList.remove("flare");
            void (t as HTMLElement).offsetWidth;
            t.classList.add("flare");
          }
        }
        const at = `${port[0] * 100}% ${port[1] * 100}%`;
        if (reduce) {
          surge.current?.animate([{ opacity: 0 }, { opacity: 0.7 }, { opacity: 0 }], { duration: 500 });
          return;
        }
        surge.current?.animate(
          [
            { opacity: 1, clipPath: `circle(0% at ${at})` },
            { opacity: 1, offset: 0.55, clipPath: `circle(80% at ${at})` },
            { opacity: 0, clipPath: `circle(140% at ${at})` },
          ],
          { duration: 1100, easing: "cubic-bezier(.2,.7,.3,1)" },
        );
        statue.current?.animate([{ scale: "1" }, { scale: "1.02", translate: "0 -4px", offset: 0.25 }, { scale: "1" }], {
          duration: 520,
          easing: "cubic-bezier(.2,.8,.3,1)",
        });
        hero.current
          ?.querySelector(`[data-catrow="${slug}"]`)
          ?.animate([{ background: "rgba(255,255,255,.12)" }, { background: "transparent" }], { duration: 900 });
        if (readLook().power === "calm") return;
        raysRef.current?.animate(
          [{ opacity: 0, transform: "scale(.88)" }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: "scale(1.12)" }],
          { duration: 620, easing: "ease-out" },
        );
        halftone.current?.animate([{ opacity: 0.7 }, { opacity: "" }], { duration: 800, easing: "ease-out" });
        const sr = stage.current?.getBoundingClientRect();
        if (!sr || !stage.current) return;
        const cap = document.createElement("div");
        cap.className = "statue-caption";
        cap.style.setProperty("--c", color);
        cap.textContent = `${byCat.get(d.categoryId)?.name ?? categories.find((c) => c.slug === slug)?.name ?? ""} +${(d.gain ?? 0.6).toFixed(1)}`;
        const left = port[0] < 0.5;
        cap.style.left = `${left ? Math.max(4, end.x - sr.left - 170) : end.x - sr.left + 24}px`;
        cap.style.top = `${Math.max(6, end.y - sr.top - 60)}px`;
        stage.current.appendChild(cap);
        cap.animate(
          [
            { opacity: 0, transform: "skewX(-8deg) scale(.6) translateY(10px)" },
            { opacity: 1, transform: "skewX(-8deg) scale(1.08)", offset: 0.18 },
            { opacity: 1, transform: "skewX(-8deg) scale(1)", offset: 0.75 },
            { opacity: 0, transform: "skewX(-8deg) translateY(-12px)" },
          ],
          { duration: 1500, easing: "ease-out" },
        ).onfinish = () => cap.remove();
      };
      if (reduce || !d.from) {
        impact();
        return;
      }
      const s = d.from,
        dx = end.x - s.x,
        lift = Math.min(220, Math.abs(dx) * 0.35 + 80);
      const path = `M${s.x} ${s.y} C${s.x + dx * 0.15} ${s.y - lift} ${end.x - dx * 0.25} ${end.y - lift} ${end.x} ${end.y}`;
      const svg = fxLayer();
      svg.innerHTML = `<path d="${path}" fill="none" stroke="${color}" stroke-width="6" stroke-opacity=".25" stroke-linecap="round"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
      const paths = [...svg.querySelectorAll("path")];
      const len = paths[1]!.getTotalLength();
      for (const p of paths) {
        p.style.strokeDasharray = `${len} ${len}`;
        p.animate(
          [
            { strokeDashoffset: len, opacity: 1 },
            { strokeDashoffset: 0, opacity: 1, offset: 0.7 },
            { strokeDashoffset: 0, opacity: 0 },
          ],
          { duration: 760, easing: "cubic-bezier(.55,0,.6,1)" },
        );
      }
      const bead = document.createElement("div");
      bead.className = "comet";
      bead.style.setProperty("--c", color);
      bead.style.offsetPath = `path("${path}")`;
      document.body.appendChild(bead);
      bead.animate(
        [
          { offsetDistance: "0%", opacity: 0.5 },
          { offsetDistance: "100%", opacity: 1 },
        ],
        { duration: 540, easing: "cubic-bezier(.55,0,.75,.25)" },
      ).onfinish = () => {
        bead.remove();
        impact();
        setTimeout(() => {
          if (svg) svg.innerHTML = "";
        }, 300);
      };
    };
    window.addEventListener(PULSE_EVENT, onPulse);
    return () => window.removeEventListener(PULSE_EVENT, onPulse);
  });

  const reach = REACH[tier.tier] ?? 0;
  const aura = AURA[tier.tier] ?? 0.12;

  return (
    <section ref={hero} className={`tile hero c-gold ${hl ? "hl" : ""}`} style={{ ["--aura" as string]: aura }} aria-label="The statue">
      <div className="hero-left">
        <div className="lbl">The statue</div>
        <a href="/overall" className="hero-score num block w-fit rounded-md" aria-label={`Overall score ${Math.round(overall)}, tier ${tier.numeral} ${tier.name}. How it is computed`}>
          {overall.toFixed(1)}
        </a>
        <div className="hero-tier">
          {tier.numeral} {tier.name}
        </div>
        <div className="hero-next">{tier.next !== null ? <>Next tier at <b className="num">{tier.next}</b></> : "Top tier"}</div>
        <div className="hero-cats">
          {ordered.map((c) => (
            <a key={c.id} href={`/c/${c.slug}`} className={`catrow c-${c.slug} ${hl === c.slug ? "on" : ""}`} data-cat={c.slug} data-catrow={c.slug}>
              <span>{c.name}</span>
              <b className="num">{c.score === null ? "-" : Math.round(c.score)}</b>
              <i>
                <em style={{ width: `${c.score ?? 0}%` }} />
              </i>
            </a>
          ))}
        </div>
      </div>
      <div className="hero-stage" ref={stage}>
        <div className="hero-halo" />
        <div className="hero-halftone" ref={halftone} />
        <svg className="hero-rays" ref={raysRef} viewBox="0 0 400 560" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <path d={RAYS} stroke="var(--gold-hi)" strokeWidth="2" strokeLinecap="round" opacity=".6" />
          <path d={RAYS} stroke="var(--text)" strokeWidth=".8" opacity=".45" transform="rotate(2.5 200 200)" />
        </svg>
        <div className="statue" ref={statue} style={{ ["--reach" as string]: `${reach}%` }}>
          <div className="statue-px" ref={px}>
            {/* eslint-disable-next-line @next/next/no-img-element -- three aligned layers, sized by CSS */}
            <img src="/statue/statue-base.webp" alt="" width={805} height={1200} />
            <div className="veinwrap">
              {REGIONS.map(([k, cat, poly]) => {
                const c = categories.find((x) => x.slug === cat);
                const op = 0.55 + 0.45 * ((c?.score ?? 0) / 100);
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={k}
                    className={`vein ${hl === cat ? "on" : ""}`}
                    src="/statue/statue-veins.webp"
                    alt=""
                    style={{ opacity: op, clipPath: `polygon(${poly.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(",")})` }}
                  />
                );
              })}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="bloom" src="/statue/statue-bloom.png" alt="" />
            </div>
            <div className="surge" ref={surge}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="b" src="/statue/statue-bloom.png" alt="" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/statue/statue-veins.webp" alt="" />
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only">
        Statue at tier {tier.numeral}, {tier.name}. {ordered.map((c) => `${c.name} ${c.score === null ? "not scored" : Math.round(c.score)}`).join(", ")}.
      </p>
    </section>
  );
}
