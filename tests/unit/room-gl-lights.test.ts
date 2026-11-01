// Room v3.5 GPU light selection (docs/redesign/room-prototype/engine/gl.js selectLights; PLAN R7, D4 3.3).
// The data lights are chosen from the whole view, never from the frame, so every framing lights the same set.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const G = require("../../docs/redesign/room-prototype/engine/gl.js");

type L = { id: string; bb: number[]; sk: number };
const light = (id: string, x: number, y: number, r: number, sk: number): L => ({ id, bb: [x - r, y - r, x + r, y + r], sk });
const ART = [-122, -104, 800, 560];

describe("gl.selectLights", () => {
  it("keeps the strongest n by the stable key, ties in input order", () => {
    const c = [light("a", 0, 0, 10, 1), light("b", 10, 0, 10, 5), light("c", 20, 0, 10, 5), light("d", 30, 0, 10, 3)];
    expect(G.selectLights(c, ART, 3).map((l: L) => l.id)).toEqual(["b", "c", "d"]);
  });

  it("drops lights outside the view's art rect, whatever the frame", () => {
    const c = [light("in", 100, 100, 20, 1), light("out", 2000, 100, 20, 9), light("edge", -130, 0, 10, 2)];
    expect(G.selectLights(c, ART, 16).map((l: L) => l.id)).toEqual(["edge", "in"]);
  });

  it("is a pure function of the candidates: same input, same set (framing independent)", () => {
    const c = Array.from({ length: 40 }, (_, i) => light("l" + i, (i * 37) % 600, (i * 53) % 400, 30, (i * 7) % 11));
    const a = G.selectLights(c, ART, 16).map((l: L) => l.id);
    const b = G.selectLights(c.slice(), ART, 16).map((l: L) => l.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(16);
  });

  it("caps at n and takes no lights when n is 0", () => {
    const c = [light("a", 0, 0, 10, 1), light("b", 0, 0, 10, 2)];
    expect(G.selectLights(c, null, 1).map((l: L) => l.id)).toEqual(["b"]);
    expect(G.selectLights(c, ART, 0)).toEqual([]);
  });
});
