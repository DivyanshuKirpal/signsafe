/**
 * fixtures:save - saves demo scenario results for "Replay saved example"
 * (ARCHITECTURE 12.6) in data/fixtures/<scenario-id>.json.
 *
 *   npm run fixtures:save                    every scenario, live devnet, AI off (built-in explanation)
 *   npm run fixtures:save -- s3 s8 --ai      only S3 and S8, with the live Gemini explanation step
 *   npm run fixtures:save -- --offline       from the devnet RPC traffic recorded in tests/fixtures/scenarios
 *                                            (no network, AI off; labelled as recorded)
 *
 * Each file holds the AnalyzeResponse produced by the same pipeline and JSON
 * conversion as /api/analyze, plus when and how it was captured. A result is
 * saved only when the simulation ran and the verdict matches the scenario's
 * expected verdict. A refresh never replaces a better capture: an accepted AI
 * explanation is kept when a later run falls back to the built-in text, and a
 * live capture is kept over one made from recorded traffic. To drop a saved
 * result, delete its file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type Explainer, explainerFromEnv } from "../app/lib/ai/explain";
import { analyzeTransaction } from "../app/lib/analyze";
import { AI } from "../app/lib/config";
import {
  buildSavedResult,
  loadSavedResult,
  type SavedResultFile,
  savedResultFile,
  shouldReplace,
} from "../app/lib/replay/saved-results";
import { buildScenario } from "../app/lib/scenarios/build";
import { type DemoConfig, loadDemoConfig } from "../app/lib/scenarios/demo-config";
import { type Scenario, SCENARIOS } from "../app/lib/scenarios/index";
import { createSignSafeRpc, type EndpointLabel, ensureDevnet, redactSecrets, type SignSafeRpc } from "../app/lib/solana/rpc";
import { createReplayRpc, fromFixtureJson, type RecordedExchange } from "../app/lib/solana/rpc-recording";

const args = process.argv.slice(2);
const AI_ON = args.includes("--ai");
const OFFLINE = args.includes("--offline");
const DELAY_MS = 1_500; // keep free RPC plans happy

interface RecordedScenario {
  endpoint: EndpointLabel | null;
  recordedAt: string;
  txBase64: string;
  exchanges: RecordedExchange[];
}

/** "s3", "S3" or "s3-hidden-approval"; none means every scenario. */
function pickScenarios(names: string[]): Scenario[] {
  if (names.length === 0) return [...SCENARIOS];
  return names.map((name) => {
    const wanted = name.toLowerCase();
    const found = SCENARIOS.find((s) => s.id === wanted || s.code.toLowerCase() === wanted);
    if (!found) throw new Error(`Unknown scenario "${name}". Use one of: ${SCENARIOS.map((s) => s.code).join(", ")}.`);
    return found;
  });
}

function describeCapture(saved: SavedResultFile): string {
  const e = saved.response.explanation;
  const text =
    e.source === "ai"
      ? `AI explanation from ${e.model ?? "an unreported model version"}`
      : `built-in explanation${e.notice ? ` (${e.notice.code})` : ""}`;
  const data = saved.devnetData === "live" ? "live devnet" : `devnet traffic recorded ${saved.devnetDataAt}`;
  return `${data}, ${text}, captured ${saved.capturedAt}`;
}

async function liveSetup(): Promise<{ rpc: SignSafeRpc; config: DemoConfig; explainer?: Explainer }> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    throw new Error(".env.local not found (or use --offline).");
  }
  const primary = process.env.SOLANA_RPC_URL?.trim();
  const fallback = process.env.SOLANA_RPC_FALLBACK_URL?.trim() || undefined;
  if (!primary || primary.includes("REPLACE_ME")) throw new Error("SOLANA_RPC_URL is missing in .env.local.");
  const config = loadDemoConfig();
  if (!config) throw new Error("data/demo.devnet.json not found or invalid. Run npm run setup:demo first.");
  const rpc = createSignSafeRpc(primary, fallback);
  if (!(await ensureDevnet(rpc.rpc))) throw new Error("The configured RPC is not devnet.");
  const explainer = AI_ON ? explainerFromEnv(process.env, { log: (m) => console.log(`      ${m}`) }) : undefined;
  return { rpc, config, explainer };
}

async function main(): Promise<void> {
  if (AI_ON && OFFLINE) throw new Error("--ai needs the network, so it cannot be combined with --offline.");
  const scenarios = pickScenarios(args.filter((a) => !a.startsWith("--")));
  const live = OFFLINE ? null : await liveSetup();
  console.log(
    `Source: ${OFFLINE ? "recorded devnet traffic (offline)" : "live devnet"}. AI: ${AI_ON ? "on (live Gemini explanation step)" : "off"}. ${scenarios.length} scenario(s).\n`,
  );

  let saved = 0;
  let kept = 0;
  let failed = 0;
  let aiAccepted = 0;
  for (const [i, scenario] of scenarios.entries()) {
    if (i > 0 && live) await new Promise((r) => setTimeout(r, DELAY_MS));

    let txBase64: string;
    let rpc: SignSafeRpc;
    let devnetData: "live" | "recorded";
    let devnetDataAt: string | undefined;
    if (live) {
      ({ txBase64 } = await buildScenario(scenario.id, live.config, live.rpc.rpc));
      rpc = live.rpc;
      devnetData = "live";
    } else {
      const recorded = fromFixtureJson<RecordedScenario>(readFileSync(`tests/fixtures/scenarios/${scenario.id}.json`, "utf8"));
      txBase64 = recorded.txBase64;
      rpc = { rpc: createReplayRpc(recorded.exchanges), lastEndpoint: () => recorded.endpoint ?? undefined };
      devnetData = "recorded";
      devnetDataAt = recorded.recordedAt;
    }

    const capturedAt = new Date();
    const analysis = await analyzeTransaction(
      txBase64,
      { rpc, explainer: live?.explainer, log: (m) => console.log(`      ${redactSecrets(m)}`) },
      { deadline: Date.now() + AI.routeDeadlineMs },
    );
    const { verdict, simulation, explanation } = analysis;

    const problems: string[] = [];
    if (!simulation.ran) problems.push("the simulation did not run");
    if (!scenario.expected.includes(verdict.level)) {
      problems.push(`verdict ${verdict.level}, expected ${scenario.expected.join(" or ")}`);
    }
    if (problems.length > 0) {
      failed++;
      console.log(`FAIL  ${scenario.code}: not saved (${problems.join("; ")}).`);
      continue;
    }

    const next = buildSavedResult({
      scenarioId: scenario.id,
      txBase64,
      analysis,
      capturedAt,
      devnetData,
      devnetDataAt: devnetDataAt ?? capturedAt.toISOString(),
    });
    if (explanation.source === "ai") aiAccepted++;
    const existing = loadSavedResult(scenario.id);
    if (!shouldReplace(existing, next)) {
      kept++;
      console.log(`KEPT  ${scenario.code}: ${savedResultFile(scenario.id)} already holds a better capture (${describeCapture(existing!)}).`);
      console.log(`      This run gave: ${describeCapture(next)}${explanation.notice ? ` - ${explanation.notice.message}` : ""}`);
      continue;
    }

    mkdirSync("data/fixtures", { recursive: true });
    writeFileSync(savedResultFile(scenario.id), JSON.stringify(next, null, 2) + "\n");
    saved++;
    console.log(`SAVED ${scenario.code}: ${verdict.level} ("${verdict.label}")${verdict.complete ? "" : ", check incomplete"}.`);
    console.log(`      ${describeCapture(next)} -> ${savedResultFile(scenario.id)}`);
    if (AI_ON) {
      if (explanation.source === "ai") {
        console.log(`      summary: ${explanation.summary}`);
        for (const point of explanation.points) console.log(`      - ${point}`);
        console.log(`      advice: ${explanation.advice}`);
      } else {
        console.log(`      AI not used: ${explanation.notice?.code}: ${explanation.notice?.message}`);
      }
    }
  }

  const aiNote = AI_ON ? ` AI explanations accepted for ${aiAccepted} of ${scenarios.length - failed}.` : "";
  console.log(`\nfixtures:save: ${saved} saved, ${kept} kept, ${failed} failed.${aiNote}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`fixtures:save: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
