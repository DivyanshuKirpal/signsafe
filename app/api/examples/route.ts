/**
 * Saved results for "Replay saved example" (ARCHITECTURE 12.6).
 *
 *   GET /api/examples          -> { examples: [{ id, code, pitch, capturedAt, devnetData, explanationSource }], ai }
 *                                 (ai: "on" or "off", whether this server asks Gemini; the page uses it for a hint)
 *   GET /api/examples?id=<id>  -> { result, tx, reveal }
 *                                 result = the saved AnalyzeResponse, unchanged, plus `replay`
 *                                 (capture time and data source) so the page labels it as saved
 *
 * Reads data/fixtures only: no RPC and no AI call, so it works when the network
 * is down. Files are written by `npm run fixtures:save`.
 */
import { aiMode } from "@/app/lib/ai/explain";
import { listSavedResults, loadSavedResult, toReplayResponse } from "@/app/lib/replay/saved-results";
import { getScenario } from "@/app/lib/scenarios/index";
import { revealScenario } from "@/app/lib/scenarios/reveal";
import { jsonError } from "@/app/lib/util/errors";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) return Response.json({ examples: listSavedResults(), ai: aiMode(process.env) });

  const scenario = getScenario(id);
  if (!scenario) return jsonError(404, "UNKNOWN_SCENARIO", "There is no scenario with that id.");
  const saved = loadSavedResult(scenario.id);
  if (!saved) {
    return jsonError(404, "NO_SAVED_RESULT", `There is no saved result for ${scenario.code} on this server yet.`);
  }
  return Response.json({ result: toReplayResponse(saved), tx: saved.txBase64, reveal: revealScenario(scenario) });
}
