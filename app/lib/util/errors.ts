/**
 * API error responses: a stable code plus a plain message. Never a stack trace
 * (CLAUDE.md section 9).
 */
import { createHash } from "node:crypto";
import type { ApiError } from "../types";

export function jsonError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

/**
 * POST routes accept JSON only. A cross-site page can send text/plain without
 * a CORS preflight; requiring application/json forces the preflight, which
 * fails because SignSafe sends no CORS headers. Returns the error to send, or null.
 */
export function requireJson(request: Request): Response | null {
  const type = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  if (type === "application/json" || type.startsWith("application/json;")) return null;
  return jsonError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as JSON (Content-Type: application/json).");
}

/** Plain 429 with Retry-After, shared by the rate-limited routes. */
export function rateLimited(retryAfterMs: number, what: string): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const res = jsonError(429, "RATE_LIMITED", `Too many ${what} in a short time. Please wait about ${seconds} seconds and try again.`);
  res.headers.set("Retry-After", String(seconds));
  return res;
}

/** A short, non-reversible tag for logs, so the full input is never logged. */
export function inputTag(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
