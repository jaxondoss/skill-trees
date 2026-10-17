// Splits the tier V statue into a clean obsidian base, a gold vein layer and a pre-blurred bloom layer.
// All three come from the same image, so they line up exactly. Usage: node scripts/figure-layers.mjs <tier-v.png> <out-dir>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [require.resolve("next")] }));
const [src, outDir] = process.argv.slice(2);
const H = 1200, W = Math.round((1696 / 2528) * H);
const rgb = await sharp(src).resize(W, H).removeAlpha().raw().toBuffer();
const N = W * H;
const clamp = (v) => Math.max(0, Math.min(1, v));

// 1. Gold mask: warm, bright, red well above blue. Rim light is blue and specular highlights are grey, so both fall out.
const m0 = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
  const warm = clamp((r - b - 12) / 40), bright = clamp((r - 50) / 55), order = g > b * 1.02 ? 1 : 0;
  m0[i] = Math.round(255 * warm * bright * order);
}
// Grow the mask a touch so inpainting also removes the gold's soft edge.
const grown = await sharp(Buffer.from(m0), { raw: { width: W, height: H, channels: 1 } }).blur(2.2).raw().toBuffer();
const m = new Float32Array(N);
for (let i = 0; i < N; i++) m[i] = clamp(Math.max(m0[i], grown[i] * 3.5) / 255);

// 2. Inpaint by normalized convolution, in floating point (8-bit blurs band badly where the weights are small).
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) { let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc * k; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc * k; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
const gauss = (a, r) => boxBlur(boxBlur(boxBlur(a, W, H, r), W, H, r), W, H, r);
// A wider mask for removal than for the vein layer, so the gold's soft edge goes too.
let wide = new Float32Array(N); for (let i = 0; i < N; i++) wide[i] = m0[i] / 255;
wide = gauss(wide, 2); for (let i = 0; i < N; i++) wide[i] = clamp(wide[i] * 6);
const wgtF = new Float32Array(N); for (let i = 0; i < N; i++) wgtF[i] = 1 - wide[i];
const wB = gauss(wgtF, 5);
const base = Buffer.alloc(N * 3);
for (let c = 0; c < 3; c++) {
  const ch = new Float32Array(N); for (let i = 0; i < N; i++) ch[i] = rgb[i * 3 + c] * wgtF[i];
  const cB = gauss(ch, 5);
  for (let i = 0; i < N; i++) { const fill = wB[i] > 1e-4 ? cB[i] / wB[i] : rgb[i * 3 + c]; base[i * 3 + c] = Math.round(rgb[i * 3 + c] * (1 - wide[i]) + fill * wide[i]); }
}

// 3. Veins: the original gold colour, lifted slightly, alpha from the mask.
const veins = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const a = clamp(m0[i] / 255 * 1.6);
  veins[i * 4] = Math.min(255, rgb[i * 3] * 1.08); veins[i * 4 + 1] = Math.min(255, rgb[i * 3 + 1] * 1.05); veins[i * 4 + 2] = rgb[i * 3 + 2];
  veins[i * 4 + 3] = Math.round(a * 255);
}
// 4. Bloom: the vein mask blurred wide in floating point, in gold, with a clean floor so it never tints the background.
let bl = new Float32Array(N); for (let i = 0; i < N; i++) bl[i] = m0[i] / 255;
bl = gauss(gauss(bl, 6), 6);
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, bl[i]);
const bloom = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const v = clamp((bl[i] / peak - 0.03) / 0.97);
  bloom[i * 4] = 255; bloom[i * 4 + 1] = 196; bloom[i * 4 + 2] = 72; bloom[i * 4 + 3] = Math.round(255 * Math.pow(v, 1.15) * 0.62);
}

const raw = (buf, ch) => sharp(buf, { raw: { width: W, height: H, channels: ch } });
await Promise.all([
  raw(base, 3).webp({ quality: 90, smartSubsample: true }).toFile(`${outDir}/statue-base.webp`),
  raw(veins, 4).webp({ quality: 88, alphaQuality: 100 }).toFile(`${outDir}/statue-veins.webp`),
  raw(bloom, 4).png({ compressionLevel: 9 }).toFile(`${outDir}/statue-bloom.png`),
  raw(rgb, 3).webp({ quality: 84 }).toFile(`${outDir}/statue-v-reference.webp`),
]);
let goldPx = 0; for (let i = 0; i < N; i++) if (m0[i] > 60) goldPx++;
console.log({ W, H, goldPct: (100 * goldPx / N).toFixed(2) });
