/**
 * Explanation in the UI (jsdom). Analyses are produced by the real pipeline
 * from recorded devnet fixtures, with Gemini MOCKED, then served to the page
 * through a mocked /api/analyze.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Checker } from "../app/components/checker";
import { ExplanationPanel } from "../app/components/explanation-panel";
import { analyzeTransaction } from "../app/lib/analyze";
import { createGeminiExplainer, type Explainer } from "../app/lib/ai/explain";
import type { AnalyzeResponse } from "../app/lib/types";
import { toJsonSafe } from "../app/lib/util/bigint-json";
import { loadFixture, replayFixture } from "./helpers/fake-rpc";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockedGemini(answer: unknown): Explainer {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }], modelVersion: "gemini-3.6-flash" }), {
      status: 200,
    })) as unknown as typeof fetch;
  return createGeminiExplainer({ apiKey: "k", model: "gemini-3.5-flash", fetchImpl, sleep: async () => {} });
}

async function analysisFor(name: string, dir: string, explainer?: Explainer, cache?: AnalyzeResponse["cache"]) {
  const f = loadFixture(name, dir);
  const result = await analyzeTransaction(f.txBase64, { rpc: replayFixture(f), explainer });
  const response = toJsonSafe({ requestId: "00000000-0000-4000-8000-000000000001", ...result, cache: cache ?? { hit: false } }) as AnalyzeResponse;
  return { tx: f.txBase64, response };
}

/** Renders the page with /api/analyze answering `response`; returns the request bodies sent. */
async function showResult(tx: string, response: AnalyzeResponse) {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/scenarios") return new Response(JSON.stringify({ ready: false, scenarios: [] }));
      if (url === "/api/examples") return new Response(JSON.stringify({ examples: [] }));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(response), { status: 200 });
    }),
  );
  render(<Checker />);
  fireEvent.change(screen.getByLabelText(/Transaction \(base64/), { target: { value: tx } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  await screen.findByRole("heading", { name: response.verdict.label });
  return bodies;
}

describe("ExplanationPanel labels", () => {
  test("AI explanation shows the model; built-in shows the reason", () => {
    const { rerender } = render(
      <ExplanationPanel explanation={{ source: "ai", model: "gemini-3.6-flash", summary: "S.", points: ["P."], advice: "A." }} />,
    );
    expect(screen.getByRole("heading", { name: "AI explanation" })).toBeTruthy();
    expect(screen.getByText(/model gemini-3.6-flash/)).toBeTruthy();
    rerender(
      <ExplanationPanel
        explanation={{ source: "template", summary: "S.", points: [], advice: "A.", notice: { code: "AI_OFF", message: "AI explanations are switched off on this server." } }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Built-in explanation" })).toBeTruthy();
    expect(screen.getByText(/switched off on this server/)).toBeTruthy();
  });
});

describe("pages", () => {
  test("Gemini says 'go ahead and sign' for a Danger verdict -> the page shows the built-in explanation", async () => {
    const goAhead = { summary: "This is a normal approval.", points: ["It lets 59WC...v3ZB spend your tokens later."], advice: "Go ahead and sign it." };
    const { tx, response } = await analysisFor("s3-hidden-approval", "tests/fixtures/scenarios", mockedGemini(goAhead));
    await showResult(tx, response);
    expect(screen.getByRole("heading", { name: "Danger: don't sign unless you're certain" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Built-in explanation" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "AI explanation" })).toBeNull();
    expect(screen.getByText(/gave signing advice that contradicts the verdict/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/go ahead/i);
    // S3's built-in text covers both the payment and the permission.
    expect(document.body.textContent).toContain("It asks to send 0.01 SOL");
    expect(document.body.textContent).toContain("No tokens move when it is signed; the permission can be used later.");
  });

  test("Could not fully check: the gap stays visible in the panel and in the explanation", async () => {
    const { tx, response } = await analysisFor("unfunded-fee-payer", "tests/fixtures/live");
    await showResult(tx, response);
    expect(screen.getByRole("heading", { name: "Could not fully check" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What could not be checked" })).toBeTruthy();
    expect(screen.getByText("SignSafe could not fully check this transaction, so its effects could not be confirmed.")).toBeTruthy();
  });

  test("Danger with incomplete evidence: stays Danger, and the gap is shown three times over", async () => {
    const { tx, response } = await analysisFor("approval-unfunded-fee-payer", "tests/fixtures/live");
    await showResult(tx, response);
    expect(screen.getByRole("heading", { name: "Danger: don't sign unless you're certain" })).toBeTruthy();
    expect(screen.getByText(/could not be checked as well/)).toBeTruthy(); // VerdictCard
    expect(screen.getByRole("heading", { name: "What could not be checked" })).toBeTruthy(); // panel
    expect(screen.getByText(/Part of this transaction could not be checked\./)).toBeTruthy(); // explanation
  });

  test("an accepted AI explanation is labelled with its model; Check again asks for a fresh result", async () => {
    const answer = {
      summary: "This transaction sends 0.01 SOL to F61U...AG9Y and also gives another address unlimited permission to spend your tokens.",
      points: ["No tokens move when it is signed.", "Address 59WC...v3ZB could move all your tokens later without asking."],
      advice: "Do not sign this unless you are certain you want to give this permission.",
    };
    const { tx, response } = await analysisFor("s3-hidden-approval", "tests/fixtures/scenarios", mockedGemini(answer), {
      hit: true,
      storedAt: "2026-11-07T00:00:00.000Z",
    });
    const bodies = await showResult(tx, response);
    expect(screen.getByRole("heading", { name: "AI explanation" })).toBeTruthy();
    expect(screen.getByText(/model gemini-3.6-flash/)).toBeTruthy();
    expect(screen.getByText(/Cached result from/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByRole("heading", { name: response.verdict.label });
    expect(bodies).toEqual([
      { input: { kind: "base64", tx }, stream: true },
      { input: { kind: "base64", tx }, fresh: true, stream: true },
    ]);
  });
});
