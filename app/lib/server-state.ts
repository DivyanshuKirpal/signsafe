/**
 * Per-process server state for /api/analyze (ARCHITECTURE 9.7): the analysis
 * cache, the per-IP rate limiter, and the explainer built from the environment
 * (with its own cache of accepted AI explanations). In memory only.
 */
import { createHash } from "node:crypto";
import { type Explainer, explainerFromEnv } from "./ai/explain";
import { CACHE, RATE_LIMIT } from "./config";
import type { AnalyzeResponse, Explanation } from "./types";
import { TtlCache } from "./util/cache";
import { RateLimiter } from "./util/rate-limit";

export type CachedAnalysis = Omit<AnalyzeResponse, "requestId" | "cache">;

let analysisCache = new TtlCache<CachedAnalysis>(CACHE.maxEntries, CACHE.ttlMs);
let explanationCache = new TtlCache<Explanation>(CACHE.maxEntries, CACHE.ttlMs);
let rateLimiter = new RateLimiter(RATE_LIMIT);
let explainer: Explainer | undefined;

export function getAnalysisCache(): TtlCache<CachedAnalysis> {
  return analysisCache;
}

export function getRateLimiter(): RateLimiter {
  return rateLimiter;
}

export function getExplainer(log?: (message: string) => void): Explainer {
  if (!explainer) explainer = explainerFromEnv(process.env, { cache: explanationCache, log: (m) => (log ?? console.warn)(m) });
  return explainer;
}

/** Cache key for an analysis: the transaction plus the optional user address (ARCHITECTURE 9.7). */
export function analysisKey(base64: string, userAddress?: string): string {
  return createHash("sha256").update(base64).update("\n").update(userAddress ?? "").digest("hex");
}

/**
 * Whether a result may be served from the cache later: only when the
 * simulation ran and the explanation did not fail for a passing reason
 * (busy or slow AI), so a retry can still get the AI text.
 */
export function isCacheable(result: CachedAnalysis): boolean {
  const code = result.explanation.notice?.code;
  return result.simulation.ran && code !== "AI_UNAVAILABLE" && code !== "AI_TIMEOUT";
}

/** Tests only: start from empty state. */
export function resetServerState(): void {
  analysisCache = new TtlCache<CachedAnalysis>(CACHE.maxEntries, CACHE.ttlMs);
  explanationCache = new TtlCache<Explanation>(CACHE.maxEntries, CACHE.ttlMs);
  rateLimiter = new RateLimiter(RATE_LIMIT);
  explainer = undefined;
}
