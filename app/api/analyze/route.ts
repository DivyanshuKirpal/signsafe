/**
 * POST /api/analyze
 *
 * M1: validates the request and decodes the transaction. Simulation (M2),
 * rules and verdict (M3) and the AI explanation (M5) are added to this same
 * pipeline later.
 */
import { isAddress } from "@solana/kit";
import { z } from "zod";
import { LIMITS } from "@/app/lib/config";
import { DecodeError, decodeTransaction } from "@/app/lib/solana/decode";
import type { AnalyzeResponse } from "@/app/lib/types";
import { toJsonSafe } from "@/app/lib/util/bigint-json";
import { inputTag, jsonError } from "@/app/lib/util/errors";

// Secrets and the RPC are server-only; this route always runs on Node.js.
export const runtime = "nodejs";

const RequestSchema = z.object({
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("base64"),
      tx: z.string(),
      // Optional and only used to personalise wording later; rules never use it.
      userAddress: z
        .string()
        .trim()
        .refine((value) => isAddress(value), { message: "not a valid Solana address" })
        .optional(),
    }),
  ]),
});

export async function POST(request: Request): Promise<Response> {
  const started = performance.now();
  const requestId = crypto.randomUUID();

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
  const { tx } = parsed.data.input;

  try {
    const decodeStart = performance.now();
    const decoded = await decodeTransaction(tx);
    const decodeMs = Math.round(performance.now() - decodeStart);

    const response: AnalyzeResponse = {
      requestId,
      cluster: "devnet",
      decoded,
      timingsMs: { decode: decodeMs, total: Math.round(performance.now() - started) },
    };
    return Response.json(toJsonSafe(response));
  } catch (error) {
    if (error instanceof DecodeError) {
      return jsonError(400, error.code, error.message);
    }
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error(`[analyze ${requestId}] unexpected failure for input ${inputTag(tx)}: ${reason}`);
    return jsonError(500, "INTERNAL", "Something went wrong while checking this transaction. Please try again.");
  }
}
