/**
 * The public deployment's configuration: AI_ENABLED=false and no Gemini key.
 * A fresh check (and "Check again") must still run the devnet analysis, keep
 * the rules verdict, use the built-in explanation and make zero Gemini
 * requests. The server RPC is a replay of recorded S3 devnet traffic, so no
 * fetch call is expected at all.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../app/lib/solana/server-rpc", async () => {
  const { loadFixture, replayFixture } = await import("./helpers/fake-rpc");
  const rpc = replayFixture(loadFixture("s3-hidden-approval", "tests/fixtures/scenarios"));
  return { getServerRpc: () => rpc };
});

import { POST } from "../app/api/analyze/route";
import { GET as examplesGet } from "../app/api/examples/route";
import { GET as healthGet } from "../app/api/health/route";
import { aiMode, explainerFromEnv } from "../app/lib/ai/explain";
import { buildExplanationContext } from "../app/lib/ai/facts";
import { analyzeTransaction } from "../app/lib/analyze";
import { resetServerState } from "../app/lib/server-state";
import type { AnalyzeResponse, AnalyzeStreamEvent } from "../app/lib/types";
import { loadFixture, replayFixture } from "./helpers/fake-rpc";

const S3 = loadFixture("s3-hidden-approval", "tests/fixtures/scenarios");

async function check(fresh: boolean): Promise<AnalyzeResponse> {
  const res = await POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.20" },
      body: JSON.stringify({ input: { kind: "base64", tx: S3.txBase64 }, stream: true, ...(fresh ? { fresh: true } : {}) }),
    }),
  );
  expect(res.status).toBe(200);
  const text = await res.text();
  if (!(res.headers.get("content-type") ?? "").includes("ndjson")) return JSON.parse(text) as AnalyzeResponse; // a cached answer
  const last = text.trim().split("\n").map((line) => JSON.parse(line) as AnalyzeStreamEvent).at(-1);
  if (last?.type !== "result") throw new Error("the check did not finish");
  return last.result;
}

beforeEach(() => {
  vi.stubEnv("AI_ENABLED", "false");
  vi.stubEnv("GEMINI_API_KEY", "");
  resetServerState(); // the explainer is built from the environment on first use
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("public deployment: AI_ENABLED=false, no Gemini key", () => {
  test("a check and Check again run the devnet analysis, keep the rules verdict, use the built-in text, and make no Gemini request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const first = await check(false);
    const again = await check(true); // "Check again"
    for (const result of [first, again]) {
      expect(result.simulation.ran).toBe(true);
      expect(result.simulation.ok).toBe(true);
      expect(result.verdict.level).toBe("DANGER");
      expect(result.verdict.flags[0].ruleId).toBe("R-APPROVE");
      expect(result.explanation).toMatchObject({ source: "template", notice: { code: "AI_OFF" } });
      expect(result.explanation.model).toBeUndefined();
    }
    expect(again.cache).toEqual({ hit: false });
    expect(again.requestId).not.toBe(first.requestId);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("the built-in text covers the 0.01 SOL payment and the separate unlimited permission (S3)", async () => {
    const result = await check(true);
    const text = [result.explanation.summary, ...result.explanation.points, result.explanation.advice].join(" ");
    expect(text).toContain("It asks to send 0.01 SOL");
    expect(text).toMatch(/permission/i);
    expect(result.verdict.flags[0].detail).toMatch(/UNLIMITED/);
  });

  test("an explicit false wins in any case or spacing, even if a key were present", async () => {
    for (const value of ["false", "FALSE", " False "]) {
      expect(aiMode({ AI_ENABLED: value, GEMINI_API_KEY: "present-but-unused" })).toBe("off");
      const fetchImpl = vi.fn();
      const explainer = explainerFromEnv({ AI_ENABLED: value, GEMINI_API_KEY: "present-but-unused" }, { fetchImpl: fetchImpl as unknown as typeof fetch });
      const context = buildExplanationContext(await analyzeTransaction(S3.txBase64, { rpc: replayFixture(S3) }));
      expect(await explainer.explain(context, { deadline: Date.now() + 10_000, fresh: true })).toMatchObject({ notice: { code: "AI_OFF" } });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    expect(aiMode({ GEMINI_API_KEY: "present" })).toBe("on");
    expect(aiMode({})).toBe("off");
  });

  test("health and the replay list report the AI as off, without secrets", async () => {
    const health = (await (await healthGet()).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ status: "ok", cluster: "devnet", ai: "off" });
    expect(Object.keys(health).sort()).toEqual(["ai", "cluster", "commit", "status"]);
    const list = (await (await examplesGet(new Request("http://localhost/api/examples"))).json()) as { ai: string };
    expect(list.ai).toBe("off");
  });
});
