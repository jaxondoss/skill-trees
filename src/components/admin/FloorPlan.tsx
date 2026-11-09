"use client";

import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { placeTags, TAG, type Plan, type PlanObject } from "@/lib/admin-items";

export type ObjState = { num: string; warn: boolean; off: boolean; logged: boolean; title: string };

const M = 3.2; // margin around the room (ft) for dimensions and wall names
const sy = (z: number) => -z; // the window wall (Z = +14) is drawn at the top

/**
 * Top-down floor plan of the room (art/room-r6/plan.json): navy ground, cyan 1 px lines, a 1 ft grid, dimension
 * ticks, wall-mounted items as brackets on the wall line, floor items as boxes (dashed where the box is fitted, not
 * exact). Each object carries its tile's callout number; hover or focus lights the object, its tile and leader.
 */
export function FloorPlan({
  plan,
  stateOf,
  tileOf,
  hot,
  onHover,
  onOpen,
}: {
  plan: Plan;
  stateOf: (tileId: string) => ObjState | null;
  tileOf: (o: PlanObject) => string | null;
  hot: string | null;
  onHover: (tileId: string | null) => void;
  onOpen: (tileId: string, from: Element) => void;
}) {
  const { x0, z0, w, d } = plan.room;
  const x1 = x0 + w;
  const z1 = z0 + d;
  const vb = `${x0 - M} ${sy(z1) - M} ${w + 2 * M} ${d + 2 * M}`;
  const ft = Array.from({ length: w + 1 }, (_, i) => x0 + i);
  const fz = Array.from({ length: d + 1 }, (_, i) => z0 + i);
  const win = plan.openings.find((o) => o.kind === "window");
  const door = plan.openings.find((o) => o.kind === "door");

  // walls as segments with the openings cut out
  const wallSegs: [number, number, number, number][] = [
    [x0, sy(z0), x1, sy(z0)], // back
    [x1, sy(z0), x1, sy(z1)], // right
  ];
  if (win) wallSegs.push([x0, sy(z1), win.x0, sy(z1)], [win.x1, sy(z1), x1, sy(z1)]);
  else wallSegs.push([x0, sy(z1), x1, sy(z1)]);
  if (door) wallSegs.push([x0, sy(z1), x0, sy(door.z1)], [x0, sy(door.z0), x0, sy(z0)]);
  else wallSegs.push([x0, sy(z1), x0, sy(z0)]);

  const open = (e: MouseEvent | KeyboardEvent, id: string) => onOpen(id, e.currentTarget);
  // draw small objects last so they sit on top of big ones
  const objects = [...plan.objects].sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0));
  const tags = useMemo(() => placeTags(plan.objects), [plan.objects]);

  return (
    <svg viewBox={vb} role="group" aria-label="Floor plan of the room, window wall at the top" preserveAspectRatio="xMidYMid meet">
      {/* 1 ft grid, 7 ft (beam) lines brighter */}
      <g aria-hidden>
        {ft.map((x) => (
          <line key={`gx${x}`} className={x % 7 === 0 ? "fp-grid-major" : "fp-grid"} x1={x} y1={sy(z0)} x2={x} y2={sy(z1)} />
        ))}
        {fz.map((z) => (
          <line key={`gz${z}`} className={z % 7 === 0 ? "fp-grid-major" : "fp-grid"} x1={x0} y1={sy(z)} x2={x1} y2={sy(z)} />
        ))}
      </g>

      {/* dimension ticks and lines outside the room */}
      <g aria-hidden>
        {ft.map((x) => (
          <line key={`tx${x}`} className="fp-thin" x1={x} y1={sy(z1) - 0.35} x2={x} y2={sy(z1) - (x % 7 === 0 ? 0.9 : 0.55)} />
        ))}
        {fz.map((z) => (
          <line key={`tz${z}`} className="fp-thin" x1={x0 - 0.35} y1={sy(z)} x2={x0 - (z % 7 === 0 ? 0.9 : 0.55)} y2={sy(z)} />
        ))}
        <line className="fp-thin" x1={x0} y1={sy(z1) - 1.9} x2={x1} y2={sy(z1) - 1.9} />
        <line className="fp-thin" x1={x0} y1={sy(z1) - 2.3} x2={x0} y2={sy(z1) - 1.5} />
        <line className="fp-thin" x1={x1} y1={sy(z1) - 2.3} x2={x1} y2={sy(z1) - 1.5} />
        <text className="fp-text big" x={0} y={sy(z1) - 2.15} textAnchor="middle">
          {`${w}' 0"`}
        </text>
        <line className="fp-thin" x1={x0 - 1.9} y1={sy(z0)} x2={x0 - 1.9} y2={sy(z1)} />
        <line className="fp-thin" x1={x0 - 2.3} y1={sy(z0)} x2={x0 - 1.5} y2={sy(z0)} />
        <line className="fp-thin" x1={x0 - 2.3} y1={sy(z1)} x2={x0 - 1.5} y2={sy(z1)} />
        <text className="fp-text big" x={x0 - 2.15} y={0} textAnchor="middle" transform={`rotate(-90 ${x0 - 2.15} 0)`}>
          {`${d}' 0"`}
        </text>
        <text className="fp-text" x={x1} y={sy(z1) - 0.9} textAnchor="end">
          FRONT / WINDOW
        </text>
        <text className="fp-text" x={x1 + 0.9} y={0} textAnchor="middle" transform={`rotate(90 ${x1 + 0.9} 0)`}>
          RIGHT
        </text>
        <text className="fp-text" x={0} y={sy(z0) + 1.2} textAnchor="middle">
          BACK
        </text>
        <text className="fp-text" x={x1} y={sy(z0) + 2.4} textAnchor="end">
          ROOM R6 / 1 SQ = 1 FT
        </text>
      </g>

      {/* walls, window, door, skylight overhead */}
      <g aria-hidden>
        <rect className="fp-room fp-hit" x={x0} y={sy(z1)} width={w} height={d} />
        {wallSegs.map(([a, b, c, e], i) => (
          <line key={`w${i}`} className="fp-wall" x1={a} y1={b} x2={c} y2={e} />
        ))}
        {win && (
          <>
            <line className="fp-thin" x1={win.x0} y1={sy(z1) - 0.2} x2={win.x1} y2={sy(z1) - 0.2} />
            <line className="fp-thin" x1={win.x0} y1={sy(z1) + 0.2} x2={win.x1} y2={sy(z1) + 0.2} />
            <line className="fp-thin" x1={win.x0} y1={sy(z1) - 0.2} x2={win.x0} y2={sy(z1) + 0.2} />
            <line className="fp-thin" x1={win.x1} y1={sy(z1) - 0.2} x2={win.x1} y2={sy(z1) + 0.2} />
          </>
        )}
        {door && (
          <>
            <line className="fp-thin" x1={x0} y1={sy(door.z0)} x2={x0 + (door.z1 - door.z0)} y2={sy(door.z0)} />
            <path className="fp-dash" d={`M ${x0 + (door.z1 - door.z0)} ${sy(door.z0)} A ${door.z1 - door.z0} ${door.z1 - door.z0} 0 0 0 ${x0} ${sy(door.z1)}`} />
            <text className="fp-text" x={x0 + 0.5} y={sy((door.z0 + door.z1) / 2) + 0.25}>
              DOOR
            </text>
          </>
        )}
        {plan.ceiling.map((c) => (
          <g key={c.kind}>
            <rect className="fp-dash" x={c.x0} y={sy(c.z1)} width={c.x1 - c.x0} height={c.z1 - c.z0} />
            <text className="fp-text" x={(c.x0 + c.x1) / 2} y={sy((c.z0 + c.z1) / 2) + 0.22} textAnchor="middle">
              SKYLIGHT ABOVE
            </text>
          </g>
        ))}
      </g>

      {/* objects */}
      {objects.map((o) => {
        const tile = tileOf(o);
        const st = tile ? stateOf(tile) : null;
        if (!tile || !st) return null;
        const cls = ["fp-obj", o.src === "fitted" ? "is-fitted" : "", st.warn ? "is-warn" : "", st.off ? "is-off" : "", hot === tile ? "is-hot" : ""].join(" ");
        const cx = (o.x0 + o.x1) / 2;
        const cz = (o.z0 + o.z1) / 2;
        const label = `${st.num} ${st.title}: ${o.label.toLowerCase()}${st.warn ? ", needs attention" : ""}${st.off ? ", not active" : ""}`;
        return (
          <g
            key={o.id}
            className={cls}
            data-obj={o.id}
            data-tile={tile}
            role="button"
            tabIndex={0}
            aria-label={label}
            onMouseEnter={() => onHover(tile)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(tile)}
            onBlur={() => onHover(null)}
            onClick={(e) => open(e, tile)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open(e, tile);
              }
            }}
          >
            <title>{label}</title>
            {/* a generous invisible hit area: some footprints are a few inches */}
            <rect className="fp-hit" x={cx - 0.9} y={sy(cz) - 0.9} width={1.8} height={1.8} />
            {o.wall ? <Bracket o={o} /> : <rect className="fp-box" x={o.x0} y={sy(o.z1)} width={o.x1 - o.x0} height={o.z1 - o.z0} />}
            <Tag at={tags.get(o.id)!} num={st.num} />
          </g>
        );
      })}
    </svg>
  );
}

/** Wall-mounted item: a bracket on the inside face of its wall, ticks toward the wall. */
function Bracket({ o }: { o: PlanObject }) {
  const k = 0.35; // inset from the wall line
  const t = 0.3; // tick length
  if (o.wall === "front" || o.wall === "back") {
    const z = o.wall === "front" ? o.z1 : o.z0;
    const inward = o.wall === "front" ? k : -k; // screen y: front wall at the top, so inward is +y
    const y = sy(z) + inward;
    const yt = y - Math.sign(inward) * t;
    return <polyline className="fp-bracket" points={`${o.x0},${yt} ${o.x0},${y} ${o.x1},${y} ${o.x1},${yt}`} />;
  }
  const x = o.wall === "right" ? o.x1 - k : o.x0 + k;
  const xt = o.wall === "right" ? x + t : x - t;
  return <polyline className="fp-bracket" points={`${xt},${sy(o.z1)} ${x},${sy(o.z1)} ${x},${sy(o.z0)} ${xt},${sy(o.z0)}`} />;
}

/** The callout: a small square with the tile number; a hairline back to the object when it had to move away. */
function Tag({ at, num }: { at: { x: number; y: number; ax: number; ay: number }; num: string }) {
  const far = Math.hypot(at.x - at.ax, at.y - at.ay) > TAG * 0.75;
  return (
    <>
      {far && <line className="fp-thin" x1={at.x} y1={at.y} x2={at.ax} y2={at.ay} />}
      <rect className="fp-tag" x={at.x - TAG / 2} y={at.y - TAG / 2} width={TAG} height={TAG} />
      <text className="fp-num" x={at.x} y={at.y + 0.03}>
        {num}
      </text>
    </>
  );
}
