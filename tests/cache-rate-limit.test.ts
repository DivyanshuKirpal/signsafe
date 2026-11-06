import { describe, expect, test } from "vitest";
import { TtlCache } from "../app/lib/util/cache";
import { clientKey, RateLimiter } from "../app/lib/util/rate-limit";

describe("TtlCache", () => {
  test("expires entries after the time limit", () => {
    let t = 0;
    const cache = new TtlCache<string>(10, 1_000, () => t);
    cache.set("a", "1");
    t = 999;
    expect(cache.get("a")?.value).toBe("1");
    t = 1_000;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test("keeps at most maxEntries, dropping the least recently used", () => {
    const cache = new TtlCache<number>(2, 60_000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a is now the most recent
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")?.value).toBe(1);
    expect(cache.get("c")?.value).toBe(3);
  });
});

describe("RateLimiter", () => {
  test("allows maxRequests per window, then says when to retry", () => {
    let t = 0;
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000, maxTrackedClients: 10 }, () => t);
    expect([1, 2, 3].map(() => limiter.check("ip").allowed)).toEqual([true, true, true]);
    t = 10_000;
    expect(limiter.check("ip")).toEqual({ allowed: false, retryAfterMs: 50_000 });
    expect(limiter.check("other").allowed).toBe(true);
    t = 60_000;
    expect(limiter.check("ip").allowed).toBe(true);
  });

  test("tracks a bounded number of clients", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000, maxTrackedClients: 2 });
    limiter.check("a");
    limiter.check("b");
    limiter.check("c"); // "a" is forgotten
    expect(limiter.check("a").allowed).toBe(true);
  });

  test("client key: first x-forwarded-for entry, then x-real-ip, else one local bucket", () => {
    const req = (headers: Record<string, string>) => new Request("http://localhost/api/analyze", { headers });
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientKey(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientKey(req({}))).toBe("local");
  });
});
