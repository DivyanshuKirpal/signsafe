/**
 * The explanation step (ARCHITECTURE 9.6): runs AFTER the verdict is final.
 *
 *   facts -> cache (same facts only) -> Gemini -> parse -> validate -> AI explanation
 *                                                           | any failure -> built-in explanation + notice
 *
 * The cache key is a hash of the exact facts (verdict, findings, evidence,
 * account changes, completeness) and the model names, so a fresh analysis
 * with a different verdict or evidence can never reuse an old explanation.
 * Only accepted AI answers are cached; "Check again" (fresh) skips the read.
 */
import { createHash } from "node:crypto";
import { AI, CACHE } from "../config";
import type { Explanation, ExplanationNoticeCode } from "../types";
import { TtlCache } from "../util/cache";
import { RateLimiter } from "../util/rate-limit";
import type { ExplanationContext } from "./facts";
import { type GeminiFailure, type GeminiOptions, generateExplanationText } from "./gemini";
import { buildUserPrompt, SYSTEM_INSTRUCTION } from "./prompt";
import { templateExplanation } from "./template";
import { parseAnswer, type RejectCode, validateExplanation } from "./validate";

export interface ExplainOptions {
  /** Epoch ms by which the whole request must finish. */
  deadline: number;
  /** "Check again": do not reuse a cached explanation. */
  fresh?: boolean;
}

export interface Explainer {
  explain(context: ExplanationContext, options: ExplainOptions): Promise<Explanation>;
}

const NOTICES: Record<Exclude<ExplanationNoticeCode, "AI_REJECTED">, string> = {
  AI_OFF: "AI explanations are switched off on this server.",
  AI_NOT_CONFIGURED: "No AI key is configured on this server.",
  AI_AUTH: "The AI service did not accept the server's key.",
  AI_UNAVAILABLE: "The AI service was busy or unavailable.",
  AI_TIMEOUT: "The AI service did not answer in time.",
  AI_BAD_REQUEST: "The AI service could not process the request.",
  AI_BUDGET: "This server has used its AI explanations for now.",
  AI_TOO_LARGE: "This transaction is too large for an AI explanation.",
};

const REJECTED: Record<RejectCode | "BLOCKED", string> = {
  INVALID_JSON: "was not valid JSON",
  SCHEMA: "did not have the expected structure",
  FORMAT: "did not follow the required format",
  GUARANTEE: "implied a guarantee",
  SIGNING_ADVICE: "gave signing advice that contradicts the verdict",
  DOWNPLAYS_RISK: "played down the danger",
  CLAIMS_RISK: "claimed a risk that the rules did not find",
  UNGROUNDED_AMOUNT: "mentioned an amount that is not in the findings",
  UNGROUNDED_ADDRESS: "mentioned an address that is not in the findings",
  INVENTED_TRANSFER: "described a transfer that the findings do not show",
  UNVERIFIED_AS_CONFIRMED: "presented effects that could not be checked as confirmed",
  MISSING_COVERAGE: "left out part of the findings",
  BLOCKED: "was empty or blocked by the AI service",
};

export function noticeFor(code: Exclude<ExplanationNoticeCode, "AI_REJECTED">): NonNullable<Explanation["notice"]> {
  return { code, message: NOTICES[code] };
}

export function rejectedNotice(code: RejectCode | "BLOCKED"): NonNullable<Explanation["notice"]> {
  return { code: "AI_REJECTED", message: `The AI answer was not used because it ${REJECTED[code]}.` };
}

const FAILURE_NOTICE: Record<Exclude<GeminiFailure, "blocked">, Exclude<ExplanationNoticeCode, "AI_REJECTED">> = {
  auth: "AI_AUTH",
  unavailable: "AI_UNAVAILABLE",
  not_found: "AI_UNAVAILABLE",
  timeout: "AI_TIMEOUT",
  deadline: "AI_TIMEOUT",
  bad_request: "AI_BAD_REQUEST",
  budget: "AI_BUDGET",
};

/** The built-in explanation, with the reason it is shown. */
export function builtIn(context: ExplanationContext, notice: NonNullable<Explanation["notice"]>): Explanation {
  return { source: "template", ...templateExplanation(context), notice };
}

/** An explainer that never calls an AI (AI_ENABLED=false, no key, tests). */
export function templateOnly(notice: NonNullable<Explanation["notice"]>): Explainer {
  return { explain: async (context) => builtIn(context, notice) };
}

export function factsFingerprint(context: ExplanationContext, models: string): string {
  return createHash("sha256").update(JSON.stringify(context.facts)).update("|").update(models).digest("hex");
}

/** The per-instance AI budget: Gemini HTTP attempts per window (in memory, like the other limits). */
export function createAiBudget(now?: () => number): RateLimiter {
  return new RateLimiter({ maxRequests: AI.budgetMaxRequests, windowMs: AI.budgetWindowMs, maxTrackedClients: 1 }, now);
}

export function createGeminiExplainer(
  options: GeminiOptions & { cache?: TtlCache<Explanation>; budget?: RateLimiter },
): Explainer {
  const cache = options.cache ?? new TtlCache<Explanation>(CACHE.maxEntries, CACHE.explanationTtlMs, options.now);
  const budget = options.budget ?? createAiBudget(options.now);
  const log = options.log ?? (() => {});
  const models = `${options.model}|${options.fallbackModel ?? ""}`;
  const gemini: GeminiOptions = { ...options, allowAttempt: () => budget.check("gemini").allowed };

  return {
    async explain(context, { deadline, fresh }) {
      const key = factsFingerprint(context, models);
      if (!fresh) {
        const hit = cache.get(key);
        if (hit) return { ...hit.value, reused: true };
      }

      const user = buildUserPrompt(context.facts);
      if (user.length > AI.maxPromptChars) {
        log(`[ai] not asked: the facts are ${user.length} characters (limit ${AI.maxPromptChars})`);
        return builtIn(context, noticeFor("AI_TOO_LARGE"));
      }

      const result = await generateExplanationText(gemini, { system: SYSTEM_INSTRUCTION, user }, deadline);
      if (!result.ok) {
        return builtIn(context, result.failure === "blocked" ? rejectedNotice("BLOCKED") : noticeFor(FAILURE_NOTICE[result.failure]));
      }

      let raw: unknown;
      try {
        raw = parseAnswer(result.text);
      } catch {
        log(`[ai] answer rejected: INVALID_JSON (${result.model})`);
        return builtIn(context, rejectedNotice("INVALID_JSON"));
      }
      const validation = validateExplanation(raw, context.meta);
      if (!validation.ok) {
        // Only the reason code is logged, never the answer text (it may echo untrusted content).
        log(`[ai] answer rejected: ${validation.code} (${result.model})`);
        return builtIn(context, rejectedNotice(validation.code));
      }

      const explanation: Explanation = { source: "ai", model: result.modelVersion ?? result.model, ...validation.value };
      cache.set(key, explanation);
      return explanation;
    },
  };
}

/** AI_ENABLED=false -> built-in only; no key -> built-in only; else Gemini with the configured models. */
export function explainerFromEnv(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<GeminiOptions> & { cache?: TtlCache<Explanation> } = {},
): Explainer {
  if (env.AI_ENABLED?.trim().toLowerCase() === "false") return templateOnly(noticeFor("AI_OFF"));
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.includes("REPLACE_ME")) return templateOnly(noticeFor("AI_NOT_CONFIGURED"));
  return createGeminiExplainer({
    apiKey,
    model: env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
    fallbackModel: env.GEMINI_FALLBACK_MODEL?.trim() || undefined,
    ...extra,
  });
}
