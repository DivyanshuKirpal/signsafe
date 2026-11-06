/**
 * Per-client sliding-window rate limit, in memory (ARCHITECTURE 9.7):
 * at most `maxRequests` per `windowMs` per key (the client IP).
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  maxTrackedClients: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records the request if allowed. retryAfterMs says when the next one would be allowed. */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => t - at < this.config.windowMs);
    if (recent.length >= this.config.maxRequests) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: Math.max(0, this.config.windowMs - (t - recent[0])) };
    }
    recent.push(t);
    this.hits.delete(key);
    this.hits.set(key, recent);
    while (this.hits.size > this.config.maxTrackedClients) {
      this.hits.delete(this.hits.keys().next().value as string);
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(): void {
    this.hits.clear();
  }
}

/**
 * The client's IP for rate limiting. Behind a proxy or on Vercel the first
 * x-forwarded-for entry is the client; locally there is no header, so all
 * local requests share one bucket.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}
