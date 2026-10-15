// Renders the app icons from one SVG. Run: node scripts/make-icons.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [require.resolve("next")] }));

// A stone disc with a gold kintsugi seam: the figure's motif at icon size.
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0A0A0B"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <defs>
      <radialGradient id="aura" cx="256" cy="256" r="250" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#D4AF37" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#D4AF37" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="stone" x1="150" y1="90" x2="360" y2="430" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#34333a"/>
        <stop offset="1" stop-color="#18171a"/>
      </linearGradient>
    </defs>
    <circle cx="256" cy="256" r="250" fill="url(#aura)"/>
    <circle cx="256" cy="256" r="170" fill="url(#stone)"/>
    <path d="M190 112 L236 196 L208 250 L276 318 L250 400" fill="none" stroke="#D4AF37" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M236 196 L322 168 M276 318 L352 300" fill="none" stroke="#D4AF37" stroke-width="9" stroke-linecap="round" opacity="0.85"/>
  </g>
</svg>`;

const out = [
  ["public/icons/icon-192.png", 192, 0],
  ["public/icons/icon-512.png", 512, 0],
  ["public/icons/maskable-512.png", 512, 64],
  ["src/app/apple-icon.png", 180, 24],
];
for (const [file, size, pad] of out) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile(file);
}
writeFileSync("src/app/icon.svg", svg(0));
console.log("icons written");
