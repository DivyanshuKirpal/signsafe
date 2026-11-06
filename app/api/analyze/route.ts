/**
 * POST /api/analyze
 *
 * Decodes the transaction, simulates it on devnet and applies the risk rules
 * (verdict). The AI explanation (M5) is added to the same pipeline later.
 */
import { isAddress } from "@solana/kit";
import { z } from "zod";
import { analyzeTransaction } from "@/app/lib/analyze";
import { LIMITS } from "@/app/lib/config";
import { DecodeError } from "@/app/lib/solana/decode";
import { redactSecrets } from "@/app/lib/solana/rpc";
import { getServerRpc } from "@/app/lib/solana/server-rpc";
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
  const { tx, userAddress } = parsed.data.input;

  try {
    const analysis = await analyzeTransaction(tx, {
      rpc: getServerRpc(),
      log: (message) => console.warn(`[analyze ${requestId}] input ${inputTag(tx)}: ${message}`),
    }, { userAddress: userAddress || undefined });
    const response: AnalyzeResponse = { requestId, ...analysis };
    return Response.json(toJsonSafe(response));
  } catch (error) {
    if (error instanceof DecodeError) {
      return jsonError(400, error.code, error.message);
    }
    const reason = redactSecrets(error instanceof Error ? error.message : "unknown error");
    console.error(`[analyze ${requestId}] unexpected failure for input ${inputTag(tx)}: ${reason}`);
    return jsonError(500, "INTERNAL", "Something went wrong while checking this transaction. Please try again.");
  }
}
