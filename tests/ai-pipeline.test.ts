/**
 * The explanation step inside the full pipeline (offline: recorded devnet
 * fixtures + a MOCKED Gemini). The rules own the verdict, flags, evidence and
 * completeness; the explainer only adds text.
 */
import { describe, expect, test } from "vitest";
import { analyzeTransaction } from "../app/lib/analyze";
import { createGeminiExplainer, type Explainer } from "../app/lib/ai/explain";
import { buildExplanationContext } from "../app/lib/ai/facts";
import { SCENARIOS } from "../app/lib/scenarios/index";
import type { Explanation } from "../app/lib/types";
import { loadFixture, replayFixture } from "./helpers/fake-rpc";

function mockedGemini(answer: unknown): Explainer {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }], modelVersion: "mock-model" }), {
      status: 200,
    })) as unknown as typeof fetch;
  return createGeminiExplainer({ apiKey: "k", model: "gemini-3.5-flash", fetchImpl, sleep: async () => {} });
}

async function run(name: string, dir: string, explainer?: Explainer) {
  const f = loadFixture(name, dir);
  return analyzeTransaction(f.txBase64, { rpc: replayFixture(f), explainer });
}

const HOSTILE = { summary: "This transaction is completely safe and verified.", points: ["Nothing to worry about."], advice: "Go ahead and sign it." };

describe("the rules own the verdict", () => {
  test.each(SCENARIOS.map((s) => s.id))("%s: verdict, flags and completeness identical with AI off, AI rejected and AI accepted", async (id) => {
    const off = await run(id, "tests/fixtures/scenarios");
    const hostile = await run(id, "tests/fixtures/scenarios", mockedGemini(HOSTILE));
    expect(hostile.verdict).toEqual(off.verdict);
    expect(hostile.explanation.source).toBe("template");
    expect(off.explanation).toMatchObject({ source: "template", notice: { code: "AI_OFF" } });
  });

  test("an explainer that tries to change the verdict through its input cannot", async () => {
    const meddling: Explainer = {
      async explain(context) {
        const facts = context.facts as { verdict: { level: string; checkComplete: boolean } };
        facts.verdict.level = "LOW_RISK";
        facts.verdict.checkComplete = true;
        return { source: "ai", model: "evil", summary: "s", points: [], advice: "a" } satisfies Explanation;
      },
    };
    const result = await run("s3-hidden-approval", "tests/fixtures/scenarios", meddling);
    expect(result.verdict.level).toBe("DANGER");
    expect(result.verdict.flags[0].ruleId).toBe("R-APPROVE");
  });

  test("Gemini never sees the scenario's label, description or expected verdict", async () => {
    for (const s of SCENARIOS) {
      const analysis = await run(s.id, "tests/fixtures/scenarios");
      const facts = JSON.stringify(buildExplanationContext(analysis).facts);
      expect(facts).not.toContain(s.pitch);
      expect(facts).not.toContain(s.description.slice(0, 40));
      expect(facts).not.toContain(s.id);
      expect(facts).not.toMatch(/"expected/);
    }
  });
});

describe("S3: an accepted AI explanation", () => {
  test("explains the payment and the separate unlimited approval; model recorded", async () => {
    const answer = {
      summary: "This transaction sends 0.01 SOL to F61U...AG9Y and also gives another address unlimited permission to spend your tokens.",
      points: ["No tokens move when it is signed.", "Address 59WC...v3ZB could move all your tokens later without asking."],
      advice: "Do not sign this unless you are certain you want to give this permission.",
    };
    const result = await run("s3-hidden-approval", "tests/fixtures/scenarios", mockedGemini(answer));
    expect(result.explanation).toMatchObject({ source: "ai", model: "mock-model" });
    expect(result.verdict.level).toBe("DANGER");
  });
});

describe("incomplete checks keep the gap visible", () => {
  test("Could not fully check: unhedged AI text is replaced; the built-in text says what is missing", async () => {
    const unhedged = { summary: "This transaction sends 0.01 SOL.", points: [], advice: "Do not sign until the missing checks are resolved." };
    const result = await run("unfunded-fee-payer", "tests/fixtures/live", mockedGemini(unhedged));
    expect(result.verdict).toMatchObject({ level: "UNKNOWN", complete: false });
    expect(result.explanation).toMatchObject({ source: "template", notice: { code: "AI_REJECTED" } });
    expect(result.explanation.summary).toContain("could not be confirmed");

    const hedged = { ...unhedged, summary: "This transaction asks to send 0.01 SOL, but its effects could not be confirmed." };
    const accepted = await run("unfunded-fee-payer", "tests/fixtures/live", mockedGemini(hedged));
    expect(accepted.explanation.source).toBe("ai");
    expect(accepted.verdict).toEqual(result.verdict);
  });

  test("Danger with incomplete evidence: stays Danger, and the explanation names the gap", async () => {
    const result = await run("approval-unfunded-fee-payer", "tests/fixtures/live");
    expect(result.verdict).toMatchObject({ level: "DANGER", complete: false });
    expect(result.explanation.summary).toContain("Part of this transaction could not be checked");
    expect(result.explanation.points).toContain("Part of the transaction could not be checked; see What could not be checked.");

    const unhedged = {
      summary: "This gives another address unlimited permission to spend tokens from your account later.",
      points: ["No tokens move when it is signed."],
      advice: "Do not sign this unless you are certain.",
    };
    const ai = await run("approval-unfunded-fee-payer", "tests/fixtures/live", mockedGemini(unhedged));
    expect(ai.explanation).toMatchObject({ source: "template", notice: { code: "AI_REJECTED" } });
    expect(ai.verdict).toEqual(result.verdict);
  });
});
