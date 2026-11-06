/**
 * /api/analyze caching, "Check again" and rate limiting, with the server RPC
 * replaced by a replay of the recorded S3 devnet traffic (no network). Gemini
 * is not configured in tests, so the built-in explanation is used.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../app/lib/solana/server-rpc", async () => {
  const { loadFixture, replayFixture } = await import("./helpers/fake-rpc");
  const rpc = replayFixture(loadFixture("s3-hidden-approval", "tests/fixtures/scenarios"));
  return { getServerRpc: () => rpc };
});

import { POST } from "../app/api/analyze/route";
import { resetServerState } from "../app/lib/server-state";
import type { AnalyzeResponse, ApiError } from "../app/lib/types";
import { loadFixture } from "./helpers/fake-rpc";

const TX = loadFixture("s3-hidden-approval", "tests/fixtures/scenarios").txBase64;
const VICTIM = "4gow1QUNG34T5UhNEjnAph9oovSxTbbyWVQYkezBpj9r";

async function post(body: unknown, ip = "203.0.113.9"): Promise<{ status: number; json: AnalyzeResponse & ApiError; retryAfter: string | null }> {
  const res = await POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as AnalyzeResponse & ApiError, retryAfter: res.headers.get("retry-after") };
}

beforeEach(() => resetServerState());

describe("analysis cache and Check again", () => {
  test("a repeat is served from the cache; fresh recomputes; the verdict and explanation match", async () => {
    const first = await post({ input: { kind: "base64", tx: TX } });
    expect(first.status).toBe(200);
    expect(first.json.cache).toEqual({ hit: false });
    expect(first.json.verdict.level).toBe("DANGER");
    expect(first.json.explanation).toMatchObject({ source: "template", notice: { code: "AI_NOT_CONFIGURED" } });

    const second = await post({ input: { kind: "base64", tx: TX } });
    expect(second.json.cache?.hit).toBe(true);
    expect(second.json.cache?.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(second.json.verdict).toEqual(first.json.verdict);
    expect(second.json.explanation).toEqual(first.json.explanation);
    expect(second.json.requestId).not.toBe(first.json.requestId);

    const again = await post({ input: { kind: "base64", tx: TX }, fresh: true });
    expect(again.json.cache).toEqual({ hit: false });
  });

  test("a different user address is a different cache entry (and the same verdict)", async () => {
    await post({ input: { kind: "base64", tx: TX } });
    const mine = await post({ input: { kind: "base64", tx: TX, userAddress: VICTIM } });
    expect(mine.json.cache).toEqual({ hit: false });
    expect(mine.json.userAddress).toBe(VICTIM);
  });
});

describe("rate limit", () => {
  test("10 fresh analyses per minute per IP; the 11th gets 429 with Retry-After; cached answers stay free", async () => {
    await post({ input: { kind: "base64", tx: TX } }); // 1 (now cached)
    for (let i = 2; i <= 10; i++) expect((await post({ input: { kind: "base64", tx: TX }, fresh: true })).status).toBe(200);
    const limited = await post({ input: { kind: "base64", tx: TX }, fresh: true });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("RATE_LIMITED");
    expect(Number(limited.retryAfter)).toBeGreaterThan(0);
    // A cached answer costs nothing and is still served.
    expect((await post({ input: { kind: "base64", tx: TX } })).status).toBe(200);
    // Another client is unaffected.
    expect((await post({ input: { kind: "base64", tx: TX }, fresh: true }, "198.51.100.1")).status).toBe(200);
  });

  test("bad requests are rejected before counting", async () => {
    for (let i = 0; i < 12; i++) expect((await post({ input: { kind: "base64", tx: "not base64!" } })).status).toBe(400);
    expect((await post({ input: { kind: "base64", tx: TX } })).status).toBe(200);
  });
});
