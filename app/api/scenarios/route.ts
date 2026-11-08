/**
 * Demo scenarios (ARCHITECTURE 10 and 12). Devnet only; nothing is signed.
 *
 *   GET  /api/scenarios                -> [{ id, code, pitch }]   (no expected verdicts)
 *   GET  /api/scenarios?reveal=<id>    -> { id, code, pitch, description, expected, expectedLabels }
 *                                         (the UI calls this only after the check has run)
 *   POST /api/scenarios { id, owner? } -> { txBase64, owner }     (unsigned; owner defaults to the demo victim)
 *                                         JSON only; 20 builds per minute per IP (each spends RPC requests)
 */
import { isAddress } from "@solana/kit";
import { z } from "zod";
import { buildScenario } from "@/app/lib/scenarios/build";
import { loadDemoConfig } from "@/app/lib/scenarios/demo-config";
import { getScenario, SCENARIO_IDS, SCENARIOS } from "@/app/lib/scenarios/index";
import { revealScenario } from "@/app/lib/scenarios/reveal";
import { ensureDevnet, redactSecrets } from "@/app/lib/solana/rpc";
import { getServerRpc } from "@/app/lib/solana/server-rpc";
import { getScenarioRateLimiter } from "@/app/lib/server-state";
import { jsonError, rateLimited, requireJson } from "@/app/lib/util/errors";
import { clientKey } from "@/app/lib/util/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const reveal = new URL(request.url).searchParams.get("reveal");
  if (reveal !== null) {
    const scenario = getScenario(reveal);
    if (!scenario) return jsonError(404, "UNKNOWN_SCENARIO", "There is no scenario with that id.");
    return Response.json(revealScenario(scenario));
  }
  return Response.json({
    ready: loadDemoConfig() !== null,
    scenarios: SCENARIOS.map(({ id, code, pitch }) => ({ id, code, pitch })),
  });
}

const BuildSchema = z.object({
  id: z.enum(SCENARIO_IDS),
  owner: z
    .string()
    .trim()
    .refine((v) => isAddress(v), { message: "not a valid Solana address" })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  const notJson = requireJson(request);
  if (notJson) return notJson;
  const text = await request.text();
  if (text.length > 2_000) return jsonError(413, "TOO_LARGE", "The request is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "BAD_JSON", "The request body is not valid JSON.");
  }
  const parsed = BuildSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "BAD_REQUEST", "Send { \"id\": \"<scenario id>\" } with an optional valid owner address.");

  // Each build spends devnet RPC requests, so builds have their own per-IP limit.
  const limit = getScenarioRateLimiter().check(clientKey(request));
  if (!limit.allowed) return rateLimited(limit.retryAfterMs, "demo transactions");

  const config = loadDemoConfig();
  if (!config) return jsonError(503, "DEMO_NOT_SET_UP", "The demo accounts are not set up yet. Run npm run setup:demo first.");
  const client = getServerRpc();
  if (!client) return jsonError(503, "RPC_NOT_CONFIGURED", "No devnet RPC endpoint is configured on the server.");

  try {
    if (!(await ensureDevnet(client.rpc))) {
      return jsonError(503, "RPC_NOT_DEVNET", "The configured RPC endpoint is not Solana devnet.");
    }
    const built = await buildScenario(parsed.data.id, config, client.rpc, parsed.data.owner);
    return Response.json(built);
  } catch (error) {
    console.error(`[scenarios] build failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
    return jsonError(502, "RPC_UNAVAILABLE", "The devnet RPC could not be reached to build the scenario. Try again in a moment.");
  }
}
