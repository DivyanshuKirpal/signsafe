/**
 * The result page's states: streamed steps with the verdict shown before the
 * explanation, saved-result replays (labelled, no new analysis), Check again,
 * errors with Try again, the rate-limit countdown, and the saved result offered
 * when devnet is down. /api calls are mocked; the data is the real saved S3 result.
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Checker } from "../app/components/checker";
import { type SavedResultFile, toReplayResponse } from "../app/lib/replay/saved-results";
import { getScenario } from "../app/lib/scenarios/index";
import { revealScenario } from "../app/lib/scenarios/reveal";
import type { AnalyzeResponse, AnalyzeStreamEvent, VerdictStage } from "../app/lib/types";

const S3 = JSON.parse(readFileSync("data/fixtures/s3-hidden-approval.json", "utf8")) as SavedResultFile;
/** The saved response, served as if it were a new check. */
const RESULT: AnalyzeResponse = { ...S3.response, cache: { hit: false } };
const STAGE: VerdictStage = { cluster: RESULT.cluster, decoded: RESULT.decoded, simulation: RESULT.simulation, verdict: RESULT.verdict };
const LABEL = RESULT.verdict.label;
const REVEAL = revealScenario(getScenario("s3-hidden-approval")!);

type Handler = (init?: RequestInit) => Response | Promise<Response>;
let requests: { method: string; url: string; body?: unknown }[] = [];

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** /api/analyze answers with `analyze`; `overrides` replace other routes by "METHOD url". */
function mockFetch(analyze: Handler, overrides: Record<string, Handler> = {}) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const override = overrides[`${method} ${url}`];
      if (override) return override(init);
      if (url === "/api/analyze") return analyze(init);
      if (url === "/api/scenarios" && method === "GET") {
        return json({ ready: true, scenarios: [{ id: "s3-hidden-approval", code: "S3", pitch: REVEAL.pitch }] });
      }
      if (url === "/api/examples") {
        return json({
          examples: [{ id: "s3-hidden-approval", code: "S3", pitch: REVEAL.pitch, capturedAt: S3.capturedAt, devnetData: S3.devnetData, explanationSource: "ai" }],
        });
      }
      if (url === "/api/examples?id=s3-hidden-approval") return json({ result: toReplayResponse(S3), tx: S3.txBase64, reveal: REVEAL });
      if (url.startsWith("/api/scenarios?reveal=")) return json(REVEAL);
      return json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
    }),
  );
}

/** An NDJSON answer the test feeds one event at a time. */
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } }),
    send: (event: AnalyzeStreamEvent) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")),
    end: () => controller.close(),
  };
}

function submit(tx = S3.txBase64) {
  render(<Checker />);
  fireEvent.change(screen.getByLabelText(/Transaction \(base64/), { target: { value: tx } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
}

function stepStatus(label: string): string | null | undefined {
  const steps = screen.getByRole("list", { name: "Steps" });
  return within(steps).getByText(label).closest("li")?.querySelector("span")?.textContent;
}

const analyzeBodies = () => requests.filter((r) => r.url === "/api/analyze").map((r) => r.body);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("streamed check", () => {
  test("each step shows as it runs, and the verdict appears before the explanation is written", async () => {
    const stream = controllableStream();
    mockFetch(() => stream.response);
    submit();
    await screen.findByText("Checking the transaction...");

    stream.send({ type: "step", step: "decode" });
    stream.send({ type: "step", step: "simulate" });
    await waitFor(() => expect(stepStatus("Simulate on devnet and compare the accounts")).toBe("Running"));
    expect(stepStatus("Decode the instructions")).toBe("Done");
    expect(stepStatus("Write the plain-English explanation")).toBe("Waiting");

    stream.send({ type: "step", step: "rules" });
    stream.send({ type: "verdict", result: STAGE });
    stream.send({ type: "step", step: "explain" });
    await screen.findByRole("heading", { name: LABEL });
    expect(screen.getByText("Writing the plain-English explanation...")).toBeTruthy();
    expect(stepStatus("Write the plain-English explanation")).toBe("Running");
    expect(screen.queryByRole("heading", { name: "AI explanation" })).toBeNull();

    stream.send({ type: "result", result: RESULT });
    stream.end();
    await screen.findByRole("heading", { name: "AI explanation" });
    expect(screen.queryByText("Checking the transaction...")).toBeNull();
    expect(screen.getByText(/^New check, finished in/)).toBeTruthy();
    // Screen readers hear the outcome without hunting for it.
    expect(screen.getByText(`Check finished: ${LABEL}.`).getAttribute("role")).toBe("status");
    expect(analyzeBodies()).toEqual([{ input: { kind: "base64", tx: S3.txBase64 }, stream: true }]);
  });

  test("an error line from the server ends the check with its plain message and Try again", async () => {
    const stream = controllableStream();
    mockFetch(() => stream.response);
    submit();
    stream.send({ type: "step", step: "decode" });
    stream.send({ type: "error", status: 400, error: { code: "TRUNCATED", message: "The transaction bytes end too early." } });
    stream.end();
    await screen.findByText("The transaction bytes end too early.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("saved result replay", () => {
  test("is labelled as saved above the verdict, keeps the saved explanation, and makes no analysis request", async () => {
    mockFetch(() => json(RESULT));
    render(<Checker />);
    fireEvent.click(await screen.findByText(/Replay a saved result/));
    fireEvent.click(await screen.findByRole("button", { name: /S3 saved .*AI explanation/ }));

    const banner = await screen.findByRole("heading", { name: /^Saved result from / });
    const verdict = screen.getByRole("heading", { name: LABEL });
    expect(banner.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("A replay, not a new check")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AI explanation" })).toBeTruthy();
    expect(screen.getByText(`model ${S3.response.explanation.model}`)).toBeTruthy();
    expect(screen.getByText(S3.response.explanation.summary)).toBeTruthy();
    expect(screen.getByText(/Demo scenario S3: what it really was/)).toBeTruthy();
    expect(analyzeBodies()).toEqual([]);
    expect((screen.getByLabelText(/Transaction \(base64/) as HTMLTextAreaElement).value).toBe(S3.txBase64);
  });

  test("the result is scrolled into view when it arrives (the buttons sit above it)", async () => {
    const scrolled: Element[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value(this: HTMLElement) {
        scrolled.push(this);
      },
    });
    try {
      mockFetch(() => json(RESULT));
      render(<Checker />);
      fireEvent.click(await screen.findByRole("button", { name: /S3 saved/ }));
      await screen.findByRole("heading", { name: /^Saved result from / });
      await waitFor(() => expect(scrolled.at(-1)?.querySelector("#replay-heading")).toBeTruthy());
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test("Check again on a replay runs a fresh check of the saved transaction", async () => {
    mockFetch(() => json(RESULT));
    render(<Checker />);
    fireEvent.click(await screen.findByRole("button", { name: /S3 saved/ }));
    await screen.findByRole("heading", { name: /^Saved result from / });

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText(/^New check/);
    expect(screen.queryByText("A replay, not a new check")).toBeNull();
    expect(analyzeBodies()).toEqual([{ input: { kind: "base64", tx: S3.txBase64 }, fresh: true, stream: true }]);
  });

  test("when devnet cannot build a demo transaction, the saved result of that scenario is offered", async () => {
    mockFetch(() => json(RESULT), {
      "POST /api/scenarios": () =>
        json({ error: { code: "RPC_UNAVAILABLE", message: "The devnet RPC could not be reached to build the scenario. Try again in a moment." } }, 502),
    });
    render(<Checker />);
    await screen.findByRole("button", { name: /S3 saved/ });
    fireEvent.click(await screen.findByRole("button", { name: /S3 Send 0.01 SOL/ }));
    await screen.findByText(/could not be reached to build the scenario/);
    fireEvent.click(screen.getByRole("button", { name: "Replay the saved result of S3 instead" }));
    await screen.findByRole("heading", { name: /^Saved result from / });
    expect(analyzeBodies()).toEqual([]);
  });
});

describe("errors", () => {
  test("a rate limit shows the server's message and counts down before Try again", async () => {
    mockFetch(() =>
      json({ error: { code: "RATE_LIMITED", message: "Too many checks in a short time. Please wait about 30 seconds and try again." } }, 429, {
        "retry-after": "30",
      }),
    );
    submit();
    await screen.findByText(/Too many checks in a short time/);
    expect(screen.getByRole("alert").textContent).toContain("Could not check this transaction");
    const retry = screen.getByRole("button", { name: /^Try again in \d+ s$/ }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
  });

  test("Try again repeats exactly the same request after a server error", async () => {
    let calls = 0;
    mockFetch(() =>
      ++calls === 1
        ? json({ error: { code: "INTERNAL", message: "Something went wrong while checking this transaction. Please try again." } }, 500)
        : json(RESULT),
    );
    submit();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: LABEL });
    const bodies = analyzeBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
  });
});
