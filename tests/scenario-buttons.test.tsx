import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Checker } from "../app/components/checker";
import type { AnalyzeResponse } from "../app/lib/types";
import { decodedOf, simulationOf } from "./helpers/risk-ctx";

const TX = "AQAAAA-demo-scenario-tx";

const analysis: AnalyzeResponse = {
  requestId: "00000000-0000-4000-8000-000000000000",
  cluster: "devnet",
  decoded: decodedOf({}),
  simulation: simulationOf({}),
  verdict: { level: "DANGER", label: "Danger: don't sign unless you're certain", reason: "Unlimited permission to spend tokens from a token account", complete: true, flags: [] },
  explanation: {
    source: "template",
    summary: "Danger: unlimited permission to spend tokens from a token account.",
    points: [],
    advice: "Do not sign this unless you are certain you want to allow exactly what is described here.",
    notice: { code: "AI_OFF", message: "AI explanations are switched off on this server." },
  },
  timingsMs: { total: 1 },
};

let calls: string[];
let analyzedBody: unknown;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url === "/api/scenarios" && method === "GET") {
        return json({ ready: true, scenarios: [{ id: "s3-hidden-approval", code: "S3", pitch: "Send 0.01 SOL to claim a reward" }] });
      }
      if (url === "/api/scenarios" && method === "POST") return json({ txBase64: TX, owner: "4gow1QUNG34T5UhNEjnAph9oovSxTbbyWVQYkezBpj9r" });
      if (url === "/api/analyze") {
        analyzedBody = JSON.parse(String(init?.body));
        return json(analysis);
      }
      if (url.startsWith("/api/scenarios?reveal=")) {
        return json({
          id: "s3-hidden-approval",
          code: "S3",
          pitch: "Send 0.01 SOL to claim a reward",
          description: "Looks like a 0.01 SOL payment, but a second instruction gives the attacker unlimited permission.",
          expected: ["DANGER"],
          expectedLabels: ["Danger: don't sign unless you're certain"],
        });
      }
      return json({ error: { code: "NOT_FOUND", message: "no" } }, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("scenario buttons", () => {
  test("a button builds the unsigned tx, runs the normal check, and only then reveals the scenario", async () => {
    render(<Checker />);
    const button = await screen.findByRole("button", { name: /S3 Send 0.01 SOL to claim a reward/ });
    // Before the check nothing about the expected verdict is on the page.
    expect(document.body.textContent).not.toMatch(/Expected verdict|What it actually does/);

    fireEvent.click(button);
    await screen.findByText(/Demo scenario S3: what it really was/);

    // Same analysis path as a pasted transaction: kind "base64" with the tx from the paste box.
    expect(analyzedBody).toEqual({ input: { kind: "base64", tx: TX }, stream: true });
    expect((screen.getByLabelText(/Transaction \(base64/) as HTMLTextAreaElement).value).toBe(TX);
    // The reveal is requested only after the analysis answered.
    expect(calls.filter((c) => c !== "GET /api/examples")).toEqual([
      "GET /api/scenarios",
      "POST /api/scenarios",
      "POST /api/analyze",
      "GET /api/scenarios?reveal=s3-hidden-approval",
    ]);
    expect(screen.getByRole("heading", { name: "Danger: don't sign unless you're certain" })).toBeTruthy();
    expect(screen.getByText(/\(matches\)/)).toBeTruthy();
  });

  test("editing the paste box hides a previous scenario reveal", async () => {
    render(<Checker />);
    fireEvent.click(await screen.findByRole("button", { name: /S3/ }));
    await screen.findByText(/Demo scenario S3/);
    fireEvent.change(screen.getByLabelText(/Transaction \(base64/), { target: { value: "something else" } });
    await waitFor(() => expect(screen.queryByText(/Demo scenario S3/)).toBeNull());
  });
});
