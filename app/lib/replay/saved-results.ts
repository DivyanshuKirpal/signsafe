/**
 * Saved results for "Replay saved example" (ARCHITECTURE 12.6).
 *
 * `npm run fixtures:save` runs demo scenarios through the same pipeline as
 * /api/analyze and stores the response, unchanged, in
 * data/fixtures/<scenario-id>.json, together with when and how it was captured.
 * A replay only reads that file: no RPC and no AI, so it still works when the
 * network is down. The UI labels a replay as a saved result above the verdict.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LIMITS } from "../config";
import { getScenario, SCENARIO_IDS, type ScenarioId } from "../scenarios/index";
import type { AnalyzeResponse, ReplayInfo } from "../types";
import { toJsonSafe } from "../util/bigint-json";

export const SAVED_RESULT_KIND = "signsafe-saved-result";
export const SAVED_RESULT_FORMAT = 1;

export interface SavedResultFile {
  kind: typeof SAVED_RESULT_KIND;
  format: typeof SAVED_RESULT_FORMAT;
  scenarioId: ScenarioId;
  /** When this result was produced (ISO 8601). A replay never changes it. */
  capturedAt: string;
  cluster: "devnet";
  /** "live": simulated against devnet at capturedAt. "recorded": from devnet RPC traffic recorded at devnetDataAt. */
  devnetData: "live" | "recorded";
  devnetDataAt: string;
  /** The unsigned demo transaction that was checked (public devnet data), so "Check again" can re-check it. */
  txBase64: string;
  /** Exactly what /api/analyze returned, in its JSON form. */
  response: AnalyzeResponse;
}

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "not a date");

/** The parts the replay and the result page rely on. Everything else is kept as saved. */
const ResponseShape = z.object({
  requestId: z.string(),
  cluster: z.literal("devnet"),
  decoded: z.object({ instructions: z.array(z.unknown()) }),
  simulation: z.object({
    ran: z.boolean(),
    ok: z.boolean(),
    logs: z.array(z.string()),
    innerInstructions: z.array(z.unknown()),
    changes: z.array(z.unknown()),
    watched: z.array(z.unknown()),
    notWatched: z.array(z.unknown()),
  }),
  verdict: z.object({
    level: z.enum(["DANGER", "UNKNOWN", "CAUTION", "LOW_RISK"]),
    label: z.string(),
    reason: z.string(),
    complete: z.boolean(),
    flags: z.array(z.unknown()),
  }),
  explanation: z.object({
    source: z.enum(["ai", "template"]),
    model: z.string().optional(),
    summary: z.string(),
    points: z.array(z.string()),
    advice: z.string(),
  }),
  timingsMs: z.record(z.string(), z.number()),
});

const FileShape = z.object({
  kind: z.literal(SAVED_RESULT_KIND),
  format: z.literal(SAVED_RESULT_FORMAT),
  scenarioId: z.enum(SCENARIO_IDS),
  capturedAt: isoDate,
  cluster: z.literal("devnet"),
  devnetData: z.enum(["live", "recorded"]),
  devnetDataAt: isoDate,
  txBase64: z.string().min(1).max(LIMITS.maxInputChars),
  response: ResponseShape,
});

export function isScenarioId(value: string): value is ScenarioId {
  return (SCENARIO_IDS as readonly string[]).includes(value);
}

/** Returns the file exactly as saved (nothing stripped), or null when it is not a valid saved result. */
export function parseSavedResult(text: string): SavedResultFile | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return FileShape.safeParse(json).success ? (json as SavedResultFile) : null;
}

/** Repo-relative location, for scripts and messages. */
export function savedResultFile(id: ScenarioId): string {
  return `data/fixtures/${id}.json`;
}

/** Reads data/fixtures/<id>.json. Null when the id is unknown or the file is missing or invalid. */
export function loadSavedResult(id: string): SavedResultFile | null {
  if (!isScenarioId(id)) return null; // only known ids ever reach the file system
  let text: string;
  try {
    // A fixed folder plus a validated id, so the build traces only data/fixtures.
    text = readFileSync(path.join(process.cwd(), "data", "fixtures", `${id}.json`), "utf8");
  } catch {
    return null;
  }
  const saved = parseSavedResult(text);
  return saved !== null && saved.scenarioId === id ? saved : null;
}

/** What the replay list shows: enough to pick one, nothing about the verdict. */
export interface SavedResultSummary {
  id: ScenarioId;
  code: string;
  pitch: string;
  capturedAt: string;
  devnetData: "live" | "recorded";
  explanationSource: "ai" | "template";
}

export function listSavedResults(): SavedResultSummary[] {
  const out: SavedResultSummary[] = [];
  for (const id of SCENARIO_IDS) {
    const saved = loadSavedResult(id);
    const scenario = getScenario(id);
    if (!saved || !scenario) continue;
    out.push({
      id,
      code: scenario.code,
      pitch: scenario.pitch,
      capturedAt: saved.capturedAt,
      devnetData: saved.devnetData,
      explanationSource: saved.response.explanation.source,
    });
  }
  return out;
}

export function replayInfo(saved: SavedResultFile): ReplayInfo {
  return {
    scenarioId: saved.scenarioId,
    code: getScenario(saved.scenarioId)?.code ?? saved.scenarioId,
    capturedAt: saved.capturedAt,
    devnetData: saved.devnetData,
    devnetDataAt: saved.devnetDataAt,
  };
}

/** The saved response, unchanged, marked as a replay. */
export function toReplayResponse(saved: SavedResultFile): AnalyzeResponse {
  return { ...saved.response, replay: replayInfo(saved) };
}

/** Builds the file for a finished analysis, wrapping it exactly like /api/analyze does. */
export function buildSavedResult(input: {
  scenarioId: ScenarioId;
  txBase64: string;
  analysis: Omit<AnalyzeResponse, "requestId">;
  capturedAt: Date;
  devnetData: "live" | "recorded";
  devnetDataAt: string;
}): SavedResultFile {
  const response: AnalyzeResponse = { requestId: crypto.randomUUID(), ...input.analysis, cache: { hit: false } };
  return {
    kind: SAVED_RESULT_KIND,
    format: SAVED_RESULT_FORMAT,
    scenarioId: input.scenarioId,
    capturedAt: input.capturedAt.toISOString(),
    cluster: "devnet",
    devnetData: input.devnetData,
    devnetDataAt: input.devnetDataAt,
    txBase64: input.txBase64,
    // Same JSON conversion as the route (BigInt -> decimal strings).
    response: toJsonSafe(response) as AnalyzeResponse,
  };
}

/** Higher is better: an accepted AI explanation first, then live devnet data over recorded traffic. */
export function captureRank(saved: SavedResultFile): number {
  return (saved.response.explanation.source === "ai" ? 2 : 0) + (saved.devnetData === "live" ? 1 : 0);
}

/**
 * A refresh never replaces a better capture: an accepted AI explanation is kept
 * when a later run fell back to the built-in text, and a live capture is kept
 * over one made from recorded traffic. Equal or better captures replace older ones.
 */
export function shouldReplace(existing: SavedResultFile | null, next: SavedResultFile): boolean {
  return existing === null || captureRank(next) >= captureRank(existing);
}
