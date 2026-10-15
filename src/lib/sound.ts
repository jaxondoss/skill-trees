/**
 * Sound design (spec 11.5), synthesized with Web Audio so there are no files to load.
 * Everything is under one second and mixed quiet. iOS web has no vibration, so sound is
 * the main non-visual feedback. Each call is a no-op where audio is unavailable.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Soft glass tink, pitched up a semitone with each completion that day. */
export function playTink(nthToday: number) {
  const base = 1318.5 * 2 ** (Math.min(nthToday, 12) / 12); // E6 upward
  tone(base, 0, 0.35, 0.05);
  tone(base * 2.76, 0, 0.18, 0.015); // glassy partial
}

/** Quiet liquid pour: a short filtered noise sweep. */
export function playPour() {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.6);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(500, a.currentTime);
  filter.frequency.exponentialRampToValueAtTime(1400, a.currentTime + 0.6);
  const g = a.createGain();
  g.gain.value = 0.03;
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
}

/** Deep struck bell for a tier-up. */
export function playBell() {
  [110, 220, 276.8, 330, 440].forEach((f, i) => tone(f, 0, 0.95 - i * 0.1, i === 0 ? 0.08 : 0.03));
}

/** Low, short stone crack for a broken streak. */
export function playCrack() {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.25);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 700;
  const g = a.createGain();
  g.gain.value = 0.12;
  src.connect(filter).connect(g).connect(a.destination);
  src.start();
  tone(70, 0, 0.3, 0.06, "triangle");
}
