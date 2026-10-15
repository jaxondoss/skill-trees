import { z } from "zod";
import type { IntegrationAdapter } from "./types";

/**
 * Chess rating sync from public APIs, username only (spec 13).
 * Endpoints per the providers' public docs:
 *   Lichess:   GET https://lichess.org/api/user/{username}            -> perfs.{rapid|blitz|classical}.rating
 *   Chess.com: GET https://api.chess.com/pub/player/{username}/stats  -> chess_{rapid|blitz|daily}.last.rating
 * Response shapes are read defensively; a missing time control returns no rating rather than an error.
 */
const Config = z.object({
  platform: z.enum(["lichess", "chess.com"]),
  username: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  timeControl: z.enum(["rapid", "blitz", "classical"]).default("rapid"),
});
export type ChessConfig = z.infer<typeof Config>;

export function chessUrl(c: ChessConfig): string {
  const user = encodeURIComponent(c.username.toLowerCase());
  return c.platform === "lichess" ? `https://lichess.org/api/user/${user}` : `https://api.chess.com/pub/player/${user}/stats`;
}

/** Pulls the rating for a time control out of either provider's response. Null when absent. */
export function parseRating(platform: ChessConfig["platform"], timeControl: ChessConfig["timeControl"], body: unknown): number | null {
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (platform === "lichess") {
    return num(obj(obj(obj(body)?.perfs)?.[timeControl])?.rating);
  }
  // Chess.com has no "classical" pool for live play; daily is the closest.
  const block = obj(obj(body)?.[`chess_${timeControl === "classical" ? "daily" : timeControl}`]);
  const last = block?.last;
  return num(obj(last)?.rating) ?? num(last);
}

export const chessAdapter: IntegrationAdapter<ChessConfig, { rating: number | null }> = {
  id: "chess",
  label: "Chess rating",
  feeds: "Chess: rating milestones claim themselves.",
  fallback: { label: "Enter your rating on the Chess page", href: "/s/chess" },
  available: true,
  needs: [],
  connect: (input) => Config.parse(input),
  async sync(config, _secret, fetchImpl) {
    const res = await fetchImpl(chessUrl(config), {
      headers: { accept: "application/json", "user-agent": "FORGE skill tracker (personal use)" },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) throw new Error(`No ${config.platform} account named ${config.username}.`);
    if (!res.ok) throw new Error(`${config.platform} answered ${res.status}.`);
    return { rating: parseRating(config.platform, config.timeControl, await res.json()) };
  },
  mapToEvents: (raw, { today }) => (raw.rating === null ? [] : [{ kind: "metric", skillSlug: "chess", key: "chess_rating", value: raw.rating, day: today }]),
};
