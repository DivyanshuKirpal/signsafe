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

/** A short, non-reversible tag for logs, so the full input is never logged. */
export function inputTag(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
