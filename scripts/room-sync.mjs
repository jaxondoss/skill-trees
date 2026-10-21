// Copies the room prototype (engine, ui, styles, art bundle) into public/room for the app's /room route.
// The prototype in docs/redesign/room-prototype stays the source of truth. Run: node scripts/room-sync.mjs
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const src = join(root, "docs", "redesign", "room-prototype");
const out = join(root, "public", "room");
const art = existsSync(join(src, "art-v3.js")) ? "art-v3.js" : "art.js";

// public/room/user (the owner's own photo) is left alone.
for (const f of ["engine", "ui", "styles.css", "art.js"]) rmSync(join(out, f), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ["engine", "ui"]) cpSync(join(src, dir), join(out, dir), { recursive: true });
cpSync(join(src, "styles.css"), join(out, "styles.css"));
cpSync(join(src, art), join(out, "art.js"));
console.log(`public/room: engine, ui, styles.css, art.js (from ${art})`);
