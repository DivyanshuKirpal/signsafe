import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET } from "../app/api/examples/route";
import { analyzeTransaction } from "../app/lib/analyze";
import {
  buildSavedResult,
  loadSavedResult,
  parseSavedResult,
  type SavedResultFile,
  shouldReplace,
  toReplayResponse,
} from "../app/lib/replay/saved-results";
import { SCENARIO_IDS } from "../app/lib/scenarios/index";
import type { AnalyzeResponse } from "../app/lib/types";
import { loadFixture, replayFixture } from "./helpers/fake-rpc";

function savedFile(id: string): SavedResultFile {
  return JSON.parse(readFileSync(`data/fixtures/${id}.json`, "utf8")) as SavedResultFile;
}

function withExplanation(file: SavedResultFile, source: "ai" | "template", devnetData: "live" | "recorded"): SavedResultFile {
  return { ...file, devnetData, response: { ...file.response, explanation: { ...file.response.explanation, source } } };
}

async function get(query = ""): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new Request(`http://localhost/api/examples${query}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saved result format", () => {
  test("a result built from recorded devnet traffic round-trips and keeps verdict, completeness and explanation", async () => {
    const fixture = loadFixture("s3-hidden-approval", "tests/fixtures/scenarios");
    const analysis = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    const file = buildSavedResult({
      scenarioId: "s3-hidden-approval",
      txBase64: fixture.txBase64,
      analysis,
      capturedAt: new Date("2026-11-07T09:00:00.000Z"),
      devnetData: "recorded",
      devnetDataAt: fixture.recordedAt,
    });
    const parsed = parseSavedResult(JSON.stringify(file));
    expect(parsed).not.toBeNull();
    const replay = toReplayResponse(parsed!);
    expect(replay.cluster).toBe("devnet");
    expect(replay.verdict.level).toBe("DANGER");
    expect(replay.verdict.complete).toBe(analysis.verdict.complete);
    expect(replay.explanation.source).toBe("template");
    expect(replay.cache).toEqual({ hit: false });
    expect(replay.replay).toEqual({
      scenarioId: "s3-hidden-approval",
      code: "S3",
      capturedAt: "2026-11-07T09:00:00.000Z",
      devnetData: "recorded",
      devnetDataAt: fixture.recordedAt,
    });
  });

  test("rejects files that are not valid saved results", () => {
    const good = savedFile("s1-normal-payment");
    expect(parseSavedResult(JSON.stringify(good))).not.toBeNull();
    const bad: unknown[] = [
      { ...good, kind: "something-else" },
      { ...good, cluster: "mainnet-beta" },
      { ...good, scenarioId: "s9-made-up" },
      { ...good, capturedAt: "yesterday" },
      { ...good, response: { ...good.response, cluster: "mainnet-beta" } },
      { ...good, response: { ...good.response, verdict: { ...good.response.verdict, level: "SAFE" } } },
      { ...good, response: { ...good.response, explanation: { ...good.response.explanation, source: "magic" } } },
      { ...good, txBase64: "" },
    ];
    for (const value of bad) expect(parseSavedResult(JSON.stringify(value))).toBeNull();
    expect(parseSavedResult("{not json")).toBeNull();
  });

  test("only known scenario ids reach the file system", () => {
    for (const id of ["../package", "s3-hidden-approval/../../package", "..\\..\\package", "", "S3"]) {
      expect(loadSavedResult(id)).toBeNull();
    }
    expect(loadSavedResult("s1-normal-payment")?.scenarioId).toBe("s1-normal-payment");
  });
});

describe("a refresh never replaces a better capture", () => {
  const base = savedFile("s1-normal-payment");
  const aiLive = withExplanation(base, "ai", "live");
  const builtInLive = withExplanation(base, "template", "live");
  const builtInRecorded = withExplanation(base, "template", "recorded");

  test("an accepted AI capture is kept when a later run fell back to the built-in text", () => {
    expect(shouldReplace(aiLive, builtInLive)).toBe(false);
    expect(shouldReplace(aiLive, builtInRecorded)).toBe(false);
  });

  test("a live capture is kept over one made from recorded traffic", () => {
    expect(shouldReplace(builtInLive, builtInRecorded)).toBe(false);
  });

  test("equal or better captures replace older ones", () => {
    expect(shouldReplace(null, builtInRecorded)).toBe(true);
    expect(shouldReplace(builtInRecorded, builtInLive)).toBe(true);
    expect(shouldReplace(builtInLive, aiLive)).toBe(true);
    expect(shouldReplace(aiLive, aiLive)).toBe(true);
  });
});

describe("GET /api/examples (replay)", () => {
  test("lists saved results without revealing verdicts", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    const examples = body.examples as Record<string, unknown>[];
    expect(examples.map((e) => e.id)).toEqual([...SCENARIO_IDS]);
    for (const example of examples) {
      expect(Object.keys(example).sort()).toEqual(["capturedAt", "code", "devnetData", "explanationSource", "id", "pitch"]);
    }
  });

  test.each(SCENARIO_IDS)("%s replays the saved response unchanged, labelled with its capture time, without any network call", async (id) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const file = savedFile(id);
    const { status, body } = await get(`?id=${id}`);
    expect(status).toBe(200);
    const result = body.result as AnalyzeResponse;
    const { replay, ...rest } = result;
    expect(rest).toEqual(file.response); // nothing recomputed or dropped
    expect(replay).toMatchObject({ scenarioId: id, capturedAt: file.capturedAt, devnetData: file.devnetData });
    expect(result.cluster).toBe("devnet");
    expect(body.tx).toBe(file.txBase64);
    expect((body.reveal as { id: string }).id).toBe(id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("the committed S3 and S8 saved results carry accepted AI explanations with a model version", () => {
    for (const id of ["s3-hidden-approval", "s8-memo-injection"]) {
      const { response, devnetData } = savedFile(id);
      expect(devnetData).toBe("live");
      expect(response.explanation.source).toBe("ai");
      expect(response.explanation.model).toMatch(/^gemini-/);
      expect(response.verdict.level).toBe("DANGER");
    }
  });

  test("unknown ids get a plain 404", async () => {
    for (const id of ["s9-made-up", "../package", "%2e%2e%2fpackage"]) {
      const { status, body } = await get(`?id=${id}`);
      expect(status).toBe(404);
      expect((body.error as { code: string }).code).toBe("UNKNOWN_SCENARIO");
    }
  });
});
