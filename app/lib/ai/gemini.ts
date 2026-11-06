/**
 * Server-only Gemini REST client (ARCHITECTURE 9.6).
 *
 *   POST {base}/models/{model}:generateContent   key in the x-goog-api-key header (never in the URL)
 *   generationConfig: temperature 0.2, maxOutputTokens, responseMimeType application/json +
 *   responseJsonSchema, thinkingConfig.thinkingLevel at the lowest level the model accepts.
 *
 * Field names checked against the API reference and live on 7 Nov 2026:
 * gemini-3.5-flash accepts thinkingLevel MINIMAL (0 thought tokens);
 * gemini-flash-latest rejects MINIMAL with a 400 naming the thinking level;
 * an invalid key returns 400 with reason API_KEY_INVALID (not 401/403).
 *
 * Retry policy (every attempt bounded by the route deadline):
 *   429 / 5xx / timeout / network -> wait 1-2 s, retry once; then the fallback model once; then give up
 *   404                            -> the fallback model once; then give up
 *   400 naming the thinking level  -> next lower level (MINIMAL -> LOW -> no thinkingConfig), remembered per model
 *   other 400                      -> once more without the optional fields; then give up
 *   401 / 403 / API_KEY_INVALID    -> give up at once (log "check GEMINI_API_KEY", never the key)
 */
import { AI } from "../config";
import { RESPONSE_JSON_SCHEMA } from "./prompt";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fallbackModel?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  log?: (message: string) => void;
  baseUrl?: string;
}

export type GeminiFailure = "auth" | "unavailable" | "timeout" | "deadline" | "bad_request" | "not_found" | "blocked";

export type GeminiResult =
  | { ok: true; text: string; modelVersion?: string; model: string; attempts: number }
  | { ok: false; failure: GeminiFailure; attempts: number };

type Thinking = (typeof AI.thinkingLevels)[number] | null;

/** The thinking level each model accepted last (per server process). */
const thinkingIndexByModel = new Map<string, number>();

export function resetThinkingMemory(): void {
  thinkingIndexByModel.clear();
}

function thinkingFor(model: string): Thinking {
  const index = thinkingIndexByModel.get(model) ?? 0;
  return index < AI.thinkingLevels.length ? AI.thinkingLevels[index] : null;
}

export function buildRequestBody(system: string, user: string, structured: boolean, thinking: Thinking) {
  const generationConfig: Record<string, unknown> = { temperature: AI.temperature, maxOutputTokens: AI.maxOutputTokens };
  if (structured) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = RESPONSE_JSON_SCHEMA;
  }
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  };
}

type HttpOutcome = { kind: "http"; status: number; json: unknown } | { kind: "timeout" } | { kind: "network" };
type Classified = "ok" | "transient" | "auth" | "not_found" | "bad_thinking" | "bad_request";

function errorInfo(json: unknown): { message: string; reasons: string[]; status: string } {
  const error = (json as { error?: { message?: unknown; status?: unknown; details?: unknown } } | null)?.error;
  const details = Array.isArray(error?.details) ? error.details : [];
  return {
    message: typeof error?.message === "string" ? error.message : "",
    status: typeof error?.status === "string" ? error.status : "",
    reasons: details.map((d) => (d as { reason?: unknown })?.reason).filter((r): r is string => typeof r === "string"),
  };
}

function classify(outcome: HttpOutcome): Classified {
  if (outcome.kind !== "http") return "transient";
  const { status, json } = outcome;
  if (status === 200) return "ok";
  if (status === 429 || status >= 500) return "transient";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400) {
    const info = errorInfo(json);
    if (info.reasons.includes("API_KEY_INVALID") || /api key/i.test(info.message)) return "auth";
    if (/thinking/i.test(info.message)) return "bad_thinking";
    return "bad_request";
  }
  return "transient";
}

/** The answer text (thought parts skipped), or null when the response carries none. */
export function answerText(json: unknown): { text: string; modelVersion?: string } | null {
  const body = json as {
    candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[];
    promptFeedback?: { blockReason?: unknown };
    modelVersion?: unknown;
  } | null;
  if (!body || body.promptFeedback?.blockReason) return null;
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
  if (!text.trim()) return null;
  return { text, modelVersion: typeof body.modelVersion === "string" ? body.modelVersion : undefined };
}

export async function generateExplanationText(
  options: GeminiOptions,
  prompt: { system: string; user: string },
  deadline: number,
): Promise<GeminiResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const log = options.log ?? (() => {});
  const base = options.baseUrl ?? GEMINI_BASE_URL;

  const fallback = options.fallbackModel && options.fallbackModel !== options.model ? options.fallbackModel : undefined;
  if (!MODEL_NAME.test(options.model) || (fallback && !MODEL_NAME.test(fallback))) return { ok: false, failure: "bad_request", attempts: 0 };

  let model = options.model;
  let usedFallback = false;
  let retriedTransient = false;
  let stripped = false;
  let attempts = 0;
  let lastTransient: GeminiFailure = "unavailable";

  while (attempts < 8) {
    const remaining = deadline - now();
    if (remaining < AI.minAttemptMs) return { ok: false, failure: attempts === 0 ? "deadline" : lastTransient === "timeout" ? "timeout" : "deadline", attempts };
    attempts++;
    const thinking = stripped ? null : thinkingFor(model);
    const body = buildRequestBody(prompt.system, prompt.user, !stripped, thinking);

    let outcome: HttpOutcome;
    try {
      const res = await fetchImpl(`${base}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(AI.attemptTimeoutMs, remaining)),
      });
      const json: unknown = await res.json().catch(() => null);
      outcome = { kind: "http", status: res.status, json };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      outcome = name === "TimeoutError" || name === "AbortError" ? { kind: "timeout" } : { kind: "network" };
    }

    const kind = classify(outcome);
    if (kind === "ok" && outcome.kind === "http") {
      const answer = answerText(outcome.json);
      if (!answer) {
        log(`[ai] ${model}: no usable answer (blocked or empty)`);
        return { ok: false, failure: "blocked", attempts };
      }
      return { ok: true, text: answer.text, modelVersion: answer.modelVersion, model, attempts };
    }

    const label = outcome.kind === "http" ? `HTTP ${outcome.status} ${errorInfo(outcome.json).status}`.trim() : outcome.kind;
    log(`[ai] ${model}: ${label} (attempt ${attempts})`);

    if (kind === "auth") {
      log("[ai] authentication failed: check GEMINI_API_KEY");
      return { ok: false, failure: "auth", attempts };
    }
    if (kind === "bad_thinking" && thinking) {
      // Step down to the next lower thinking level for this model (or drop the field).
      thinkingIndexByModel.set(model, (thinkingIndexByModel.get(model) ?? 0) + 1);
      continue;
    }
    if (kind === "bad_request" || kind === "bad_thinking") {
      if (!stripped) {
        stripped = true;
        continue;
      }
      return { ok: false, failure: "bad_request", attempts };
    }
    if (kind === "not_found") {
      if (fallback && !usedFallback) {
        model = fallback;
        usedFallback = true;
        continue;
      }
      return { ok: false, failure: "not_found", attempts };
    }
    // Transient: 429, 5xx, timeout, network.
    lastTransient = outcome.kind === "timeout" ? "timeout" : "unavailable";
    if (!retriedTransient) {
      retriedTransient = true;
      const delay = AI.retryDelayMinMs + Math.floor(random() * (AI.retryDelayMaxMs - AI.retryDelayMinMs));
      await sleep(Math.max(0, Math.min(delay, deadline - now() - AI.minAttemptMs)));
      continue;
    }
    if (fallback && !usedFallback) {
      model = fallback;
      usedFallback = true;
      continue;
    }
    return { ok: false, failure: lastTransient, attempts };
  }
  return { ok: false, failure: "unavailable", attempts };
}
