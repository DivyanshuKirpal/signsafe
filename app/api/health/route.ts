/**
 * GET /api/health -> { status, cluster, ai, commit }
 *
 * For checking a deployment: whether the AI step is on, and which commit is
 * live (VERCEL_GIT_COMMIT_SHA, set by Vercel). No RPC or AI call, no secrets.
 */
import { aiMode } from "@/app/lib/ai/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      status: "ok",
      cluster: "devnet",
      ai: aiMode(process.env),
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
