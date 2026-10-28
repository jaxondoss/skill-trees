import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chessAdapter, chessUrl, parseRating } from "./chess";
import { decryptSecret, encryptSecret, parseKey } from "./crypto";
import { ADAPTERS } from "./index";

describe("secret encryption", () => {
  const key = randomBytes(32);

  it("round-trips and never stores plaintext", () => {
    const sealed = encryptSecret("canvas-token-123", key);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("canvas-token-123");
    expect(decryptSecret(sealed, key)).toBe("canvas-token-123");
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("rejects tampering and the wrong key", () => {
    const sealed = encryptSecret("secret", key);
    const parts = sealed.split(".");
    const tampered = [...parts.slice(0, 3), Buffer.from("other").toString("base64url")].join(".");
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow();
  });

  it("validates the key", () => {
    expect(() => parseKey(undefined)).toThrow(/not set/);
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(parseKey(key.toString("base64"))).toHaveLength(32);
  });
});

describe("chess adapter", () => {
  it("builds the documented URLs", () => {
    expect(chessUrl({ platform: "lichess", username: "Jaxon_D", timeControl: "rapid" })).toBe("https://lichess.org/api/user/jaxon_d");
    expect(chessUrl({ platform: "chess.com", username: "JaxonD", timeControl: "rapid" })).toBe("https://api.chess.com/pub/player/jaxond/stats");
  });

  it("reads ratings from either provider's shape, and returns null when missing", () => {
    expect(parseRating("lichess", "rapid", { perfs: { rapid: { rating: 1312, games: 40 } } })).toBe(1312);
    expect(parseRating("lichess", "blitz", { perfs: { rapid: { rating: 1312 } } })).toBeNull();
    expect(parseRating("chess.com", "rapid", { chess_rapid: { last: { rating: 1040, date: 1 }, best: {} } })).toBe(1040);
    expect(parseRating("chess.com", "rapid", { chess_rapid: { last: 1055 } })).toBe(1055);
    expect(parseRating("chess.com", "classical", { chess_daily: { last: { rating: 990 } } })).toBe(990);
    expect(parseRating("chess.com", "rapid", {})).toBeNull();
    expect(parseRating("lichess", "rapid", null)).toBeNull();
  });

  it("validates config and syncs through an injected fetch", async () => {
    expect(() => chessAdapter.connect({ platform: "lichess", username: "a b" })).toThrow();
    const config = chessAdapter.connect({ platform: "lichess", username: "jaxon" });
    expect(config.timeControl).toBe("rapid");
    const fake = (async (url: string) => {
      expect(url).toBe("https://lichess.org/api/user/jaxon");
      return new Response(JSON.stringify({ perfs: { rapid: { rating: 1100 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await chessAdapter.sync(config, null, fake);
    expect(chessAdapter.mapToEvents(raw, { today: "2026-10-15", config })).toEqual([
      { kind: "metric", skillSlug: "chess", key: "chess_rating", value: 1100, day: "2026-10-15" },
    ]);
    const missing = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    await expect(chessAdapter.sync(config, null, missing)).rejects.toThrow(/No lichess account/);
  });
});

describe("pending adapters", () => {
  it("say exactly what they need and never pretend to connect", () => {
    for (const a of ADAPTERS.filter((x) => !x.available)) {
      expect(a.needs.length).toBeGreaterThan(0);
      expect(a.fallback.href).toMatch(/^(\/s\/|https:\/\/)/);
      expect(() => a.connect({})).toThrow(/Needs:/);
    }
    expect(ADAPTERS.map((a) => a.id)).toEqual(["chess", "lyfta", "strava", "google_calendar", "canvas"]);
  });
});
