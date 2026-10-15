import { regionOpacity } from "@/engine/scoring";
import { BODY, REGION_PARTS, visibleVeins, type Region } from "./geometry";

/** Stone base silhouette: whole shapes only (chest and core are drawn as one torso). */
const SILHOUETTE = [BODY.leftLeg, BODY.rightLeg, BODY.leftArm, BODY.rightArm, BODY.torso, BODY.neck, BODY.head];

/**
 * The central figure (spec 5), layered:
 * 1. aura behind the body, stronger per tier (light rays and a halo at Tier V)
 * 2. base: matte dark stone silhouette (a generated tier image can replace this layer)
 * 3. gold kintsugi veins, clipped to each region; vein opacity = 0.15 + 0.85 x category score / 100,
 *    and the share of veins shown grows with the overall tier
 * 4. rim light from Tier III, floating particles from Tier III, dust motes at Tier I
 * Idle breathing comes from the .figure-idle class on the parent. Pure SVG, server-renderable.
 */
export type FigureProps = {
  id: string;
  tier: number;
  scores: Partial<Record<Region, number>>;
  /** Draw veins in over time (tier-up moment). */
  drawVeins?: boolean;
};

const AURA: Record<number, number> = { 1: 0.05, 2: 0.12, 3: 0.2, 4: 0.3, 5: 0.42 };
const REGIONS: Region[] = ["head", "left_arm", "right_arm", "left_leg_core", "right_leg_chest"];
const PARTICLES: Record<number, number> = { 1: 0, 2: 0, 3: 6, 4: 12, 5: 18 };

export function Figure({ id, tier, scores, drawVeins }: FigureProps) {
  const t = Math.max(1, Math.min(5, tier));
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-aura`} cx="50" cy="68" r="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#D4AF37" stopOpacity={AURA[t]} />
          <stop offset="0.6" stopColor="#D4AF37" stopOpacity={AURA[t]! * 0.35} />
          <stop offset="1" stopColor="#D4AF37" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-stone`} x1="40" y1="25" x2="60" y2="127" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2e2d31" />
          <stop offset="0.45" stopColor="#1b1a1d" />
          <stop offset="1" stopColor="#0f0f11" />
        </linearGradient>
        <radialGradient id={`${id}-sheen`} cx="46" cy="44" r="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
        {REGIONS.map((r) => (
          <clipPath key={r} id={`${id}-clip-${r}`}>
            {REGION_PARTS[r].map((d) => (
              <path key={d} d={d} />
            ))}
          </clipPath>
        ))}
      </defs>

      {/* 1. aura, rays, halo */}
      <circle cx="50" cy="68" r="44" fill={`url(#${id}-aura)`} className="aura-pulse" />
      {t === 5 && (
        <g className="rays" opacity="0.18">
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            const x = 50 + Math.cos(a) * 46;
            const y = 52 + Math.sin(a) * 46;
            return <path key={i} d={`M50 52 L${(x - 2).toFixed(1)} ${y.toFixed(1)} L${(x + 2).toFixed(1)} ${y.toFixed(1)} Z`} fill="#D4AF37" />;
          })}
        </g>
      )}
      <ellipse cx="50" cy="126.9" rx="12" ry="1.7" fill="black" opacity="0.7" />
      <ellipse cx="50" cy="126.9" rx="9" ry="1" fill="#D4AF37" opacity={AURA[t]! * 0.5} />

      {/* rim light from Tier III: a soft gold glow behind the silhouette */}
      {t >= 3 && (
        <g filter={`url(#${id}-glow)`} opacity={0.18 + (t - 3) * 0.12}>
          {SILHOUETTE.map((d) => (
            <path key={`rim-${d}`} d={d} fill="#D4AF37" />
          ))}
        </g>
      )}

      {/* 2. stone base */}
      {SILHOUETTE.map((d) => (
        <path key={d} d={d} fill={`url(#${id}-stone)`} />
      ))}
      {SILHOUETTE.map((d) => (
        <path key={`s-${d}`} d={d} fill={`url(#${id}-sheen)`} />
      ))}

      {/* 3. veins per region */}
      {REGIONS.map((r) => {
        const veins = visibleVeins(r, t);
        const opacity = regionOpacity(scores[r] ?? 0);
        return (
          <g key={r} clipPath={`url(#${id}-clip-${r})`} opacity={opacity} className={drawVeins ? "vein-draw" : undefined}>
            <g filter={`url(#${id}-glow)`} opacity="0.8">
              {veins.map((v, i) => (
                <path key={i} d={v.d} stroke="#F2C14E" strokeWidth={v.width * 2.2} fill="none" strokeLinecap="round" pathLength={1} />
              ))}
            </g>
            {veins.map((v, i) => (
              <path key={i} d={v.d} stroke="#FFE3A1" strokeWidth={v.width} fill="none" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
            ))}
          </g>
        );
      })}

      {/* 4. halo, particles, dust */}
      {t === 5 && (
        <ellipse cx="50" cy="23.6" rx="6.2" ry="1.3" fill="none" stroke="#FFE3A1" strokeWidth="0.45" opacity="0.7" filter={`url(#${id}-glow)`} />
      )}
      {Array.from({ length: PARTICLES[t] ?? 0 }, (_, i) => (
        <circle
          key={i}
          cx={30 + ((i * 37) % 40)}
          cy={118 - ((i * 53) % 84)}
          r={0.18 + (i % 3) * 0.07}
          fill="#FFE3A1"
          className="particle"
          style={{ animationDelay: `${(i * 0.7) % 6}s`, animationDuration: `${6 + (i % 4)}s` }}
        />
      ))}
      {t === 1 &&
        Array.from({ length: 8 }, (_, i) => (
          <circle key={i} cx={34 + ((i * 41) % 32)} cy={40 + ((i * 29) % 80)} r="0.25" fill="#9a958d" opacity="0.35" className="particle" style={{ animationDelay: `${i}s`, animationDuration: "11s" }} />
        ))}
    </g>
  );
}
