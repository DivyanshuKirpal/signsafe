/**
 * POST /api/analyze  { input: { kind: "base64", tx, userAddress? }, fresh?, stream? }
 *
 * decode -> simulate on devnet -> rules and verdict -> explanation (AI or built-in).
 *
 * - Answer: one JSON AnalyzeResponse, or with "stream": true NDJSON lines
 *   (AnalyzeStreamEvent): each step as it starts, the verdict as soon as the
 *   rules have run, then the full result. Bad requests, rate limits and cached
 *   answers are always plain JSON.
 * - Cache (ARCHITECTURE 9.7): results are kept 10 minutes by sha256(tx + userAddress);
 *   "fresh": true ("Check again") skips the cache. Cached answers say so (cache.hit).
 * - Rate limit: 10 fresh analyses per minute per client IP; cached answers are free.
 * - Deadline: the whole request, AI attempts included, is bounded by AI.routeDeadlineMs.
 * - Secrets (RPC URL, Gemini key) stay on the server; responses carry no raw
 *   transaction, no prompts and no keys.
 */
import { isAddress } from "@solana/kit";
import { z } from "zod";
import { type AnalyzeProgress, analyzeTransaction } from "@/app/lib/analyze";
import { AI, LIMITS } from "@/app/lib/config";
import { analysisKey, getAnalysisCache, getExplainer, getRateLimiter, isCacheable } from "@/app/lib/server-state";
import { DecodeError, normalizeBase64Input } from "@/app/lib/solana/decode";
import { redactSecrets } from "@/app/lib/solana/rpc";
import { getServerRpc } from "@/app/lib/solana/server-rpc";
import type { AnalyzeResponse, AnalyzeStreamEvent } from "@/app/lib/types";
import { toJsonSafe } from "@/app/lib/util/bigint-json";
import { inputTag, jsonError } from "@/app/lib/util/errors";
import { clientKey } from "@/app/lib/util/rate-limit";

// Secrets and the RPC are server-only; this route always runs on Node.js.
export const runtime = "nodejs";
// Vercel: allow the full route deadline (ARCHITECTURE 9.7).
export const maxDuration = 40;

const RequestSchema = z.object({
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("base64"),
      tx: z.string(),
      // Optional; used only for wording ("your wallet"), never by the rules.
      userAddress: z
        .string()
        .trim()
        .refine((value) => isAddress(value), { message: "not a valid Solana address" })
        .optional(),
    }),
  ]),
  /** "Check again": skip the cached result and the cached explanation. */
  fresh: z.boolean().optional(),
  /** Stream progress as NDJSON (AnalyzeStreamEvent lines) instead of one JSON answer. */
  stream: z.boolean().optional(),
});

const encoder = new TextEncoder();

/** Plain error for the browser; unexpected failures are logged without the input or secrets. */
function failure(error: unknown, requestId: string, tx: string): { status: number; code: string; message: string } {
  if (error instanceof DecodeError) return { status: 400, code: error.code, message: error.message };
  const reason = redactSecrets(error instanceof Error ? error.message : "unknown error");
  console.error(`[analyze ${requestId}] unexpected failure for input ${inputTag(tx)}: ${reason}`);
  return { status: 500, code: "INTERNAL", message: "Something went wrong while checking this transaction. Please try again." };
}

/**
 * One AnalyzeStreamEvent per line, sent as each step starts. The verdict is
 * sent as soon as the rules have run, before the explanation is written.
 */
function streamResponse(
  run: (onProgress: (event: AnalyzeProgress) => void) => Promise<AnalyzeResponse>,
  onError: (error: unknown) => { status: number; code: string; message: string },
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalyzeStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(toJsonSafe(event)) + "\n"));
        } catch {
          // The browser went away; the check still finishes and is cached.
        }
      };
      try {
        send({ type: "result", result: await run(send) });
      } catch (error) {
        const { status, code, message } = onError(error);
        send({ type: "error", status, error: { code, message } });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the browser.
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const deadline = Date.now() + AI.routeDeadlineMs;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > LIMITS.maxRequestBodyChars) {
    return jsonError(413, "TOO_LARGE", "The request is too large.");
  }
  const text = await request.text();
  if (text.length > LIMITS.maxRequestBodyChars) {
    return jsonError(413, "TOO_LARGE", "The request is too large.");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "BAD_JSON", "The request body is not valid JSON.");
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const badAddress = parsed.error.issues.some((issue) => issue.path.includes("userAddress"));
    return badAddress
      ? jsonError(400, "INVALID_ADDRESS", "The address you entered is not a valid Solana address.")
      : jsonError(400, "BAD_REQUEST", 'Expected { "input": { "kind": "base64", "tx": "..." } }.');
  }
  const { tx, userAddress } = parsed.data.input;
  const fresh = parsed.data.fresh === true;

  try {
    const base64 = normalizeBase64Input(tx);
    const key = analysisKey(base64, userAddress);
    const cache = getAnalysisCache();

    if (!fresh) {
      const hit = cache.get(key);
      if (hit) {
        const response: AnalyzeResponse = { requestId, ...hit.value, cache: { hit: true, storedAt: new Date(hit.storedAt).toISOString() } };
        return Response.json(toJsonSafe(response));
      }
    }

    const limit = getRateLimiter().check(clientKey(request));
    if (!limit.allowed) {
      const seconds = Math.ceil(limit.retryAfterMs / 1000);
      const res = jsonError(429, "RATE_LIMITED", `Too many checks in a short time. Please wait about ${seconds} seconds and try again.`);
      res.headers.set("Retry-After", String(seconds));
      return res;
    }

    const log = (message: string) => console.warn(`[analyze ${requestId}] input ${inputTag(base64)}: ${message}`);
    const run = async (onProgress?: (event: AnalyzeProgress) => void): Promise<AnalyzeResponse> => {
      const analysis = await analyzeTransaction(
        base64,
        { rpc: getServerRpc(), explainer: getExplainer(log), log },
        { userAddress: userAddress || undefined, deadline, fresh, onProgress },
      );
      if (isCacheable(analysis)) cache.set(key, analysis);
      return { requestId, ...analysis, cache: { hit: false } };
    };

    if (parsed.data.stream === true) return streamResponse(run, (error) => failure(error, requestId, tx));
    return Response.json(toJsonSafe(await run()));
  } catch (error) {
    const { status, code, message } = failure(error, requestId, tx);
    return jsonError(status, code, message);
  }
}
