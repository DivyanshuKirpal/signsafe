/**
 * scenarios:check - runs every demo scenario through the real pipeline on
 * devnet (no UI) and compares the verdict with the expected one
 * (ARCHITECTURE 12.5). Exits 1 on any mismatch. Run it before recording.
 *
 *   npm run scenarios:check                       check all scenarios (AI off)
 *   npm run scenarios:check -- --record           also save RPC traffic of scenarios
 *                                                 without a fixture to tests/fixtures/scenarios/
 *   npm run scenarios:check -- --record --overwrite   re-record all
 *
 * The AI step does not exist until M5 and verdicts never depend on it, so this
 * always runs with AI off. Transactions are built unsigned and only simulated.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { analyzeTransaction } from "../app/lib/analyze";
import { buildScenario } from "../app/lib/scenarios/build";
import { loadDemoConfig } from "../app/lib/scenarios/demo-config";
import { SCENARIOS } from "../app/lib/scenarios/index";
import { createSignSafeRpc, ensureDevnet, redactSecrets } from "../app/lib/solana/rpc";
import { createRecordingTransport, type RecordedExchange, toFixtureJson } from "../app/lib/solana/rpc-recording";

const RECORD = process.argv.includes("--record");
const OVERWRITE = process.argv.includes("--overwrite");
const FIXTURE_DIR = "tests/fixtures/scenarios";
const DELAY_MS = 1_500; // keep free RPC plans happy

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    throw new Error(".env.local not found.");
  }
  const primary = process.env.SOLANA_RPC_URL?.trim();
  const fallback = process.env.SOLANA_RPC_FALLBACK_URL?.trim() || undefined;
  if (!primary || primary.includes("REPLACE_ME")) throw new Error("SOLANA_RPC_URL is missing in .env.local.");
  const config = loadDemoConfig();
  if (!config) throw new Error("data/demo.devnet.json not found or invalid. Run npm run setup:demo first.");

  const builder = createSignSafeRpc(primary, fallback);
  if (!(await ensureDevnet(builder.rpc))) throw new Error("The configured RPC is not devnet.");
  if (process.argv.includes("--ai")) console.log("Note: --ai has no effect yet (the AI step arrives in M5).");
  console.log(`AI: off. Owner: demo victim ${config.victim}. ${SCENARIOS.length} scenarios.\n`);

  let mismatches = 0;
  for (const [i, scenario] of SCENARIOS.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    const { txBase64 } = await buildScenario(scenario.id, config, builder.rpc);
    const sink: RecordedExchange[] = [];
    const client = createSignSafeRpc(primary, fallback, (t) => createRecordingTransport(t, sink));
    const { verdict, simulation } = await analyzeTransaction(txBase64, { rpc: client });
    const ok = scenario.expected.includes(verdict.level);
    if (!ok) mismatches++;

    console.log(`${ok ? "PASS" : "FAIL"}  ${scenario.code} [${scenario.priority}] "${scenario.pitch}"`);
    console.log(`      expected ${scenario.expected.join(" or ")}, got ${verdict.level} ("${verdict.label}")${verdict.complete ? "" : ", check incomplete"}`);
    console.log(`      simulation: ${simulation.ran ? (simulation.ok ? "ok" : `failed [${simulation.error?.code}]`) : "not run"}`);
    for (const flag of verdict.flags) {
      console.log(`      [${flag.severity}] ${flag.ruleId}${flag.relatedRuleIds ? " + " + flag.relatedRuleIds.join(", ") : ""}: ${flag.title}`);
    }

    const path = `${FIXTURE_DIR}/${scenario.id}.json`;
    if (RECORD && (OVERWRITE || !existsSync(path))) {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      const fixture = {
        case: scenario.id,
        description: scenario.description,
        source: "live devnet RPC, recorded by scripts/scenarios-check.ts",
        endpoint: simulation.rpcEndpoint ?? null,
        recordedAt: new Date().toISOString(),
        txBase64,
        exchanges: sink,
      };
      writeFileSync(path, toFixtureJson(fixture) + "\n");
      console.log(`      recorded ${path}`);
    }
  }

  const must = SCENARIOS.filter((s) => s.priority === "must").map((s) => s.code).join(", ");
  console.log(`\nscenarios:check: ${mismatches === 0 ? "all verdicts match" : `${mismatches} mismatch(es)`} (Must: ${must}).`);
  process.exitCode = mismatches === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`scenarios:check: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
