/**
 * Gemini client and explainer with a MOCKED fetch (no network): request shape
 * and privacy, the retry/fallback policy (ARCHITECTURE 9.6), thinking-level
 * step-down, deadline, AI off, and the facts-keyed cache.
 */
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { analyzeTransaction } from "../app/lib/analyze";
import { createAiBudget, createGeminiExplainer, explainerFromEnv } from "../app/lib/ai/explain";
import { buildExplanationContext, type ExplanationContext } from "../app/lib/ai/facts";
import { resetThinkingMemory } from "../app/lib/ai/gemini";
import { AI } from "../app/lib/config";
import { isCacheable } from "../app/lib/server-state";
import { RateLimiter } from "../app/lib/util/rate-limit";
import { loadFixture, replayFixture } from "./helpers/fake-rpc";

type Reply = { status: number; json: unknown } | "timeout" | "network";
interface Call {
  url: string;
  headers: Record<string, string>;
  body: { generationConfig: Record<string, unknown>; contents: { parts: { text: string }[] }[]; systemInstruction: unknown };
}

const S3_ANSWER = {
  summary: "This transaction gives another address permission to spend unlimited tokens from your account. It also sends 0.01 SOL to F61U...AG9Y.",
  points: ["No tokens move right now when this is signed.", "Address 59WC...v3ZB can move your tokens later without asking."],
  advice: "Do not sign this transaction unless you are certain.",
};
const S2_ANSWER = {
  summary: "This transaction gives 59WC...v3ZB unlimited permission to spend tokens from token account 4is5...Jfc1. No tokens move right now.",
  points: ["The delegate can move them later without asking."],
  advice: "Do not sign this transaction unless you are certain you want to grant this permission.",
};

const ok = (answer: unknown, modelVersion = "gemini-3.6-flash"): Reply => ({
  status: 200,
  json: { candidates: [{ content: { role: "model", parts: [{ text: typeof answer === "string" ? answer : JSON.stringify(answer) }] }, finishReason: "STOP" }], modelVersion },
});
const err = (status: number, message: string, reason?: string): Reply => ({
  status,
  json: { error: { code: status, message, status: "X", details: reason ? [{ reason }] : [] } },
});

function fakeFetch(replies: Reply[] | ((call: Call) => Reply)) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call: Call = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    calls.push(call);
    const reply = typeof replies === "function" ? replies(call) : replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ctx: Record<string, ExplanationContext> = {};
let s3Tx = "";
beforeAll(async () => {
  for (const id of ["s2-unlimited-approval", "s3-hidden-approval", "s8-memo-injection"]) {
    const f = loadFixture(id, "tests/fixtures/scenarios");
    if (id === "s3-hidden-approval") s3Tx = f.txBase64;
    ctx[id] = buildExplanationContext(await analyzeTransaction(f.txBase64, { rpc: replayFixture(f) }));
  }
});
beforeEach(() => resetThinkingMemory());

const far = () => Date.now() + 60_000;

function explainer(replies: Parameters<typeof fakeFetch>[0], extra: { now?: () => number } = {}) {
  const { impl, calls } = fakeFetch(replies);
  const sleeps: number[] = [];
  const logs: string[] = [];
  const e = createGeminiExplainer({
    apiKey: "test-key-not-real",
    model: "gemini-3.5-flash",
    fallbackModel: "gemini-flash-latest",
    fetchImpl: impl,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    log: (m) => logs.push(m),
    ...extra,
  });
  return { e, calls, sleeps, logs };
}

describe("request shape and privacy", () => {
  test("key only in the header; JSON output; lowest thinking level; only facts in the prompt", async () => {
    const { e, calls } = explainer([ok(S3_ANSWER)]);
    await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    const [call] = calls;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
    expect(call.url).not.toMatch(/key=/);
    expect(call.headers["x-goog-api-key"]).toBe("test-key-not-real");
    expect(call.body.generationConfig).toMatchObject({
      temperature: 0.2,
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object", required: ["summary", "points", "advice"] },
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
    const prompt = call.body.contents[0].parts[0].text;
    expect(prompt).not.toContain(s3Tx); // never the raw transaction
    expect(prompt).not.toMatch(/claim a reward|expected|s3-hidden-approval/i); // never the scenario label or expected verdict
    expect(prompt).toContain('"level": "DANGER"');
    expect(JSON.stringify(call.body)).not.toContain("test-key-not-real");
  });

  test("S8: the hostile memo appears only inside the untrusted block, capped", async () => {
    const { e, calls } = explainer([ok(S2_ANSWER)]);
    await e.explain(ctx["s8-memo-injection"], { deadline: far() });
    const prompt = calls[0].body.contents[0].parts[0].text;
    const untrustedAt = prompt.indexOf('"untrusted"');
    expect(untrustedAt).toBeGreaterThan(0);
    // The memo text (and the Memo program's log line that repeats it) appear only after "untrusted".
    expect(prompt.slice(0, untrustedAt)).not.toContain("verified safe");
    expect(prompt.slice(untrustedAt)).toContain("verified safe");
    const { memos, programLogs } = ctx["s8-memo-injection"].facts.untrusted;
    expect(memos[0].length).toBeLessThanOrEqual(203);
    expect(programLogs.every((l) => l.length <= 123)).toBe(true);
  });
});

describe("answers", () => {
  test("a valid answer is used, labelled AI, with the returned modelVersion", async () => {
    const { e } = explainer([ok(S3_ANSWER, "gemini-3.6-flash")]);
    const out = await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    expect(out).toMatchObject({ source: "ai", model: "gemini-3.6-flash", advice: S3_ANSWER.advice });
    expect(out.notice).toBeUndefined();
  });

  test("thought parts are skipped", async () => {
    const reply: Reply = {
      status: 200,
      json: { candidates: [{ content: { parts: [{ thought: true, text: "thinking..." }, { text: JSON.stringify(S3_ANSWER) }] } }], modelVersion: "m" },
    };
    const { e } = explainer([reply]);
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
  });

  test("invalid JSON -> built-in explanation with a notice", async () => {
    const { e, logs } = explainer([ok("Sure! Here is my answer: {oops")]);
    const out = await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    expect(out).toMatchObject({ source: "template", notice: { code: "AI_REJECTED", message: "The AI answer was not used because it was not valid JSON." } });
    expect(logs.join("\n")).not.toContain("oops"); // the answer text is never logged
  });

  test("valid JSON saying 'go ahead and sign' for a Danger verdict -> built-in explanation", async () => {
    const goAhead = { summary: "This is a normal approval.", points: ["It lets 59WC...v3ZB spend your tokens later."], advice: "Go ahead and sign it." };
    const { e } = explainer([ok(goAhead)]);
    const out = await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    expect(out.source).toBe("template");
    expect(out.notice?.message).toBe("The AI answer was not used because it gave signing advice that contradicts the verdict.");
    expect(JSON.stringify(out)).not.toMatch(/go ahead/i);
    expect(out.advice).toMatch(/^Do not sign/);
  });

  test("an empty or blocked answer -> built-in explanation", async () => {
    const { e } = explainer([{ status: 200, json: { promptFeedback: { blockReason: "SAFETY" } } }]);
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).notice).toMatchObject({ code: "AI_REJECTED" });
  });
});

describe("failure policy (ARCHITECTURE 9.6)", () => {
  test.each([
    ["401", err(401, "Unauthenticated")],
    ["403", err(403, "Permission denied")],
    ["400 API_KEY_INVALID (what an invalid key really returns)", err(400, "API key not valid. Please pass a valid API key.", "API_KEY_INVALID")],
  ])("%s -> built-in at once, log 'check GEMINI_API_KEY', key never logged", async (_label, reply) => {
    const { e, calls, logs } = explainer([reply]);
    const out = await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    expect(out.notice?.code).toBe("AI_AUTH");
    expect(calls).toHaveLength(1);
    expect(logs.join("\n")).toContain("check GEMINI_API_KEY");
    expect(logs.join("\n")).not.toContain("test-key-not-real");
  });

  test("429 -> wait 1-2 s, retry the same model once", async () => {
    const { e, calls, sleeps } = explainer([err(429, "quota"), ok(S3_ANSWER)]);
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
    expect(calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1])).toEqual(["gemini-3.5-flash", "gemini-3.5-flash"]);
    expect(sleeps).toEqual([1500]);
  });

  test("429 then 503 -> the fallback model once", async () => {
    const { e, calls } = explainer([err(429, "quota"), err(503, "high demand"), ok(S3_ANSWER, "fallback-version")]);
    expect(await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).toMatchObject({ source: "ai", model: "fallback-version" });
    expect(calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1])).toEqual(["gemini-3.5-flash", "gemini-3.5-flash", "gemini-flash-latest"]);
  });

  test("busy three times -> built-in, AI_UNAVAILABLE; timeouts -> AI_TIMEOUT; network errors retry", async () => {
    const busy = explainer([err(503, "high demand")]);
    expect((await busy.e.explain(ctx["s3-hidden-approval"], { deadline: far() })).notice?.code).toBe("AI_UNAVAILABLE");
    expect(busy.calls).toHaveLength(3);
    const slow = explainer(["timeout"]);
    expect((await slow.e.explain(ctx["s3-hidden-approval"], { deadline: far() })).notice?.code).toBe("AI_TIMEOUT");
    expect(slow.calls).toHaveLength(3);
    const flaky = explainer(["network", ok(S3_ANSWER)]);
    expect((await flaky.e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
  });

  test("404 -> the fallback model; 404 twice -> built-in", async () => {
    const one = explainer([err(404, "model not found"), ok(S3_ANSWER)]);
    expect((await one.e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
    expect(one.calls[1].url).toContain("gemini-flash-latest");
    const both = explainer([err(404, "model not found")]);
    expect((await both.e.explain(ctx["s3-hidden-approval"], { deadline: far() })).notice?.code).toBe("AI_UNAVAILABLE");
    expect(both.calls).toHaveLength(2);
  });

  test("400 naming the thinking level -> next lower level, remembered per model", async () => {
    const replies = (call: Call): Reply =>
      (call.body.generationConfig.thinkingConfig as { thinkingLevel?: string } | undefined)?.thinkingLevel === "MINIMAL"
        ? err(400, "Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.")
        : ok(S3_ANSWER);
    const { e, calls } = explainer(replies);
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
    expect(calls.map((c) => (c.body.generationConfig.thinkingConfig as { thinkingLevel: string }).thinkingLevel)).toEqual(["MINIMAL", "LOW"]);
    await e.explain(ctx["s3-hidden-approval"], { deadline: far(), fresh: true });
    expect((calls[2].body.generationConfig.thinkingConfig as { thinkingLevel: string }).thinkingLevel).toBe("LOW");
  });

  test("other 400 -> once more without the optional fields; twice -> built-in", async () => {
    const one = explainer([err(400, "Invalid JSON payload received. Unknown name responseJsonSchema"), ok(S3_ANSWER)]);
    expect((await one.e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
    expect(one.calls[1].body.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 1024 });
    const both = explainer([err(400, "Invalid argument")]);
    expect((await both.e.explain(ctx["s3-hidden-approval"], { deadline: far() })).notice?.code).toBe("AI_BAD_REQUEST");
    expect(both.calls).toHaveLength(2);
  });
});

describe("deadline", () => {
  test("no time left -> no call at all, built-in with AI_TIMEOUT", async () => {
    const { e, calls } = explainer([ok(S3_ANSWER)]);
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: Date.now() + 500 })).notice?.code).toBe("AI_TIMEOUT");
    expect(calls).toHaveLength(0);
  });

  test("time runs out between attempts -> stop instead of retrying", async () => {
    let t = 1_000_000;
    const { e, calls } = explainer(
      (): Reply => {
        t += 34_000; // the first attempt takes almost the whole budget
        return err(503, "high demand");
      },
      { now: () => t },
    );
    const out = await e.explain(ctx["s3-hidden-approval"], { deadline: 1_000_000 + 35_000 });
    expect(out.source).toBe("template");
    expect(calls).toHaveLength(1);
  });

  test("a hanging attempt is cut off at the time left before the deadline (real timer)", async () => {
    const calls: string[] = [];
    const hanging = (async (url: string, init: RequestInit) => {
      calls.push(url);
      return new Promise<Response>((_, rejectPromise) => init.signal?.addEventListener("abort", () => rejectPromise(init.signal?.reason)));
    }) as unknown as typeof fetch;
    const e = createGeminiExplainer({ apiKey: "k", model: "gemini-3.5-flash", fallbackModel: "gemini-flash-latest", fetchImpl: hanging, sleep: async () => {} });
    const started = Date.now();
    const out = await e.explain(ctx["s3-hidden-approval"], { deadline: started + 2_300 });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(out.notice?.code).toBe("AI_TIMEOUT");
    expect(calls).toHaveLength(1);
  });
});

describe("configuration", () => {
  test("AI_ENABLED=false -> built-in, Gemini never called", async () => {
    const { impl, calls } = fakeFetch([ok(S3_ANSWER)]);
    const e = explainerFromEnv({ AI_ENABLED: "false", GEMINI_API_KEY: "present" }, { fetchImpl: impl });
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).notice).toEqual({
      code: "AI_OFF",
      message: "AI explanations are switched off on this server.",
    });
    expect(calls).toHaveLength(0);
  });

  test("no key or a placeholder key -> built-in, AI_NOT_CONFIGURED", async () => {
    for (const env of [{}, { GEMINI_API_KEY: "REPLACE_ME" }, { GEMINI_API_KEY: "  " }]) {
      const out = await explainerFromEnv(env).explain(ctx["s3-hidden-approval"], { deadline: far() });
      expect(out.notice?.code).toBe("AI_NOT_CONFIGURED");
    }
  });
});

describe("explanation cache (keyed by the exact facts)", () => {
  const byFacts = (call: Call): Reply => (call.body.contents[0].parts[0].text.includes("Send 0.01 SOL") ? ok(S3_ANSWER) : ok(S2_ANSWER));

  test("same facts -> reused; 'Check again' -> asked again", async () => {
    const { e, calls } = explainer(byFacts);
    const first = await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    const second = await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    expect(calls).toHaveLength(1);
    expect(second).toEqual({ ...first, reused: true });
    await e.explain(ctx["s3-hidden-approval"], { deadline: far(), fresh: true });
    expect(calls).toHaveLength(2);
  });

  test("different verdict or evidence -> never the cached explanation of other facts", async () => {
    const { e, calls } = explainer(byFacts);
    const s3 = await e.explain(ctx["s3-hidden-approval"], { deadline: far() });
    const s2 = await e.explain(ctx["s2-unlimited-approval"], { deadline: far() });
    expect(calls).toHaveLength(2);
    expect(s2.summary).not.toBe(s3.summary);
    // Same transaction facts, but the evidence changed (for example on-chain state moved).
    const changed: ExplanationContext = {
      ...ctx["s3-hidden-approval"],
      facts: { ...ctx["s3-hidden-approval"].facts, verdict: { ...ctx["s3-hidden-approval"].facts.verdict, checkComplete: false } },
    };
    await e.explain(changed, { deadline: far() });
    expect(calls).toHaveLength(3);
  });

  test("only accepted AI answers are cached", async () => {
    const { e, calls } = explainer([ok({ summary: "Go ahead.", points: [], advice: "Go ahead and sign it." }), ok(S3_ANSWER)]);
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("template");
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
    expect(calls).toHaveLength(2);
  });
});

describe("per-instance AI budget and prompt size (docs/SECURITY_REVIEW.md M1, M2)", () => {
  const byFacts = (call: Call): Reply => (call.body.contents[0].parts[0].text.includes("Send 0.01 SOL") ? ok(S3_ANSWER) : ok(S2_ANSWER));

  test("every HTTP attempt counts; when the budget is used up the built-in text is shown without a request", async () => {
    let t = 0;
    const { impl, calls } = fakeFetch((call) => (calls.length === 1 ? err(503, "overloaded") : byFacts(call)));
    const e = createGeminiExplainer({
      apiKey: "test-key-not-real",
      model: "gemini-3.5-flash",
      fetchImpl: impl,
      sleep: async () => {},
      random: () => 0.5,
      budget: new RateLimiter({ maxRequests: 2, windowMs: 60_000, maxTrackedClients: 1 }, () => t),
    });
    // 503, then accepted: two attempts, the whole budget.
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).source).toBe("ai");
    expect(calls).toHaveLength(2);
    const over = await e.explain(ctx["s2-unlimited-approval"], { deadline: far() });
    expect(over).toMatchObject({ source: "template", notice: { code: "AI_BUDGET" } });
    expect(calls).toHaveLength(2);
    // Cached answers cost nothing, even with the budget used up.
    expect((await e.explain(ctx["s3-hidden-approval"], { deadline: far() })).reused).toBe(true);
    // Once the oldest attempts leave the window, the AI is asked again.
    t = 60_001;
    expect((await e.explain(ctx["s2-unlimited-approval"], { deadline: far() })).source).toBe("ai");
    expect(calls).toHaveLength(3);
  });

  test("the default budget is the configured per-instance allowance", () => {
    const budget = createAiBudget(() => 0);
    for (let i = 0; i < AI.budgetMaxRequests; i++) expect(budget.check("gemini").allowed).toBe(true);
    expect(budget.check("gemini").allowed).toBe(false);
  });

  test("a prompt over the size limit is never sent", async () => {
    const { e, calls } = explainer([ok(S3_ANSWER)]);
    const base = ctx["s3-hidden-approval"];
    const huge: ExplanationContext = {
      ...base,
      facts: { ...base.facts, findings: base.facts.findings.map((f, i) => (i === 0 ? { ...f, detail: "x".repeat(AI.maxPromptChars) } : f)) },
    };
    expect(await e.explain(huge, { deadline: far() })).toMatchObject({ source: "template", notice: { code: "AI_TOO_LARGE" } });
    expect(calls).toHaveLength(0);
  });

  test("results with AI_BUDGET are not cached, so a later check can still get AI text", () => {
    const result = { simulation: { ran: true }, explanation: { notice: { code: "AI_BUDGET" } } } as unknown as Parameters<typeof isCacheable>[0];
    expect(isCacheable(result)).toBe(false);
  });
});
