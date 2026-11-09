"use client";

import { useMemo, useState } from "react";

const WEATHER = ["clear", "partly", "overcast", "fog", "drizzle", "rain", "storm", "snow"] as const;

/** The room's query flags (engine/core.js, light.js, weather.js) as a form. No database writes. */
export type DebugFlags = {
  el: number | null;
  weather: string;
  precip: number | null;
  wind: number | null;
  p: number | null;
  tier: number | null;
  night: "" | "1" | "0";
  score: number | null;
  level: number | null;
  gl: boolean;
  motion: boolean;
};

export const EMPTY_FLAGS: DebugFlags = { el: null, weather: "", precip: null, wind: null, p: null, tier: null, night: "", score: null, level: null, gl: true, motion: true };

/** Flags -> the room URL ("/" plus only the flags that are set). Pure, unit tested. */
export function roomUrl(f: DebugFlags): string {
  const q = new URLSearchParams();
  if (f.el !== null) q.set("el", String(f.el));
  if (f.weather) q.set("weather", f.weather);
  if (f.precip !== null) q.set("precip", String(f.precip));
  if (f.wind !== null) q.set("wind", String(f.wind));
  if (f.p !== null) q.set("p", String(f.p));
  if (f.tier !== null) q.set("tier", String(f.tier));
  if (f.night) q.set("night", f.night);
  if (f.score !== null) q.set("score", String(f.score));
  if (f.level !== null) q.set("level", String(f.level));
  if (!f.gl) q.set("gl", "off");
  if (!f.motion) q.set("motion", "0");
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

function Num({ label, value, min, max, step = 1, onChange }: { label: string; value: number | null; min: number; max: number; step?: number; onChange: (v: number | null) => void }) {
  return (
    <div className="adm-fields">
      <label className="adm-fields">
        <span className="lbl-a">{label}</span>
        <input className="adm-input" type="range" min={min} max={max} step={step} value={value ?? min} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={value === null ? "live" : String(value)} />
      </label>
      <span style={{ minWidth: 48 }}>{value === null ? "LIVE" : value}</span>
      <button type="button" className="adm-btn" disabled={value === null} onClick={() => onChange(null)} aria-label={`${label}: back to live`}>
        LIVE
      </button>
    </div>
  );
}

/** Room debug: time of day (sun elevation), weather, completion, tier, statue score/level, renderer and motion flags. */
export function RoomDebug() {
  const [f, setF] = useState<DebugFlags>(EMPTY_FLAGS);
  const [preview, setPreview] = useState<string | null>(null);
  const url = useMemo(() => roomUrl(f), [f]);
  const set = <K extends keyof DebugFlags>(k: K) => (v: DebugFlags[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <section className="adm-sec" aria-labelledby="adm-sec-debug">
      <h3 id="adm-sec-debug">ROOM DEBUG / QUERY FLAGS</h3>
      <div className="adm-sec-body">
        <Num label="SUN EL" value={f.el} min={-20} max={60} step={0.5} onChange={set("el")} />
        <label className="adm-fields">
          <span className="lbl-a">WEATHER</span>
          <select value={f.weather} onChange={(e) => set("weather")(e.target.value)}>
            <option value="">live</option>
            {WEATHER.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <Num label="PRECIP" value={f.precip} min={0} max={20} step={0.5} onChange={set("precip")} />
        <Num label="WIND" value={f.wind} min={0} max={60} onChange={set("wind")} />
        <Num label="TODAY %" value={f.p} min={0} max={100} onChange={set("p")} />
        <Num label="ROOM TIER" value={f.tier} min={1} max={5} onChange={set("tier")} />
        <Num label="SCORE" value={f.score} min={0} max={100} step={0.5} onChange={set("score")} />
        <Num label="LEVEL" value={f.level} min={0} max={100} onChange={set("level")} />
        <label className="adm-fields">
          <span className="lbl-a">NIGHT</span>
          <select value={f.night} onChange={(e) => set("night")(e.target.value as DebugFlags["night"])}>
            <option value="">clock</option>
            <option value="1">on</option>
            <option value="0">off</option>
          </select>
        </label>
        <div className="adm-fields">
          <span className="lbl-a">RENDER</span>
          <button type="button" className="adm-btn" aria-pressed={!f.gl} onClick={() => set("gl")(!f.gl)}>
            CANVAS2D (GL OFF)
          </button>
          <button type="button" className="adm-btn" aria-pressed={!f.motion} onClick={() => set("motion")(!f.motion)}>
            NO MOTION
          </button>
          <button type="button" className="adm-btn" onClick={() => setF(EMPTY_FLAGS)}>
            RESET
          </button>
        </div>
        <p>
          <span className="adm-muted">URL </span>
          <code className="adm-url" data-room-url>
            {url}
          </code>
        </p>
        <div className="adm-fields">
          <a className="adm-btn" href={url} data-room-open>
            OPEN ROOM WITH THESE
          </a>
          <button type="button" className="adm-btn" onClick={() => setPreview(url)}>
            {preview ? "RELOAD PREVIEW" : "LOAD LIVE PREVIEW"}
          </button>
        </div>
        <p className="adm-muted">Skill stage overrides have no room flag yet; use SCORE and LEVEL for the statue. The preview runs the full room.</p>
        {preview && <iframe key={preview} className="adm-frame" src={preview} title="Room preview with these flags" />}
      </div>
    </section>
  );
}
