/**
 * The analysis pipeline shared by /api/analyze and the scripts:
 * decode -> simulate and diff -> rules and verdict. (AI explanation: M5.)
 *
 * The RPC is passed in, so tests can replay recorded devnet traffic and the
 * route can use the configured endpoints.
 */
import type { AnalyzeResponse, SimulationErrorCode, SimulationResult } from "./types";
import { assessRisk } from "./risk/engine";
import { decodeTransaction, normalizeBase64Input } from "./solana/decode";
import { ensureDevnet, lookupTableFetcher, redactSecrets, type SignSafeRpc } from "./solana/rpc";
import { SimulationUnavailableError, simulateDecoded } from "./solana/simulate";

export interface AnalyzeDeps {
  /** null when no RPC is configured: the transaction is decoded but not simulated. */
  rpc: SignSafeRpc | null;
  /** Optional sink for server-side diagnostics (never shown to users). */
  log?: (message: string) => void;
}

export interface AnalyzeOptions {
  /** "Which address is yours?" Only echoed back for wording; the rules never see it. */
  userAddress?: string;
}

const NOT_RUN_MESSAGES: Record<"RPC_NOT_CONFIGURED" | "RPC_NOT_DEVNET" | "RPC_UNAVAILABLE", string> = {
  RPC_NOT_CONFIGURED: "Simulation is switched off because no devnet RPC endpoint is configured on the server.",
  RPC_NOT_DEVNET: "Simulation was not run because the configured RPC endpoint is not Solana devnet.",
  RPC_UNAVAILABLE: "The devnet RPC could not be reached, so the transaction was not simulated. Try again in a moment.",
};

export function notRun(code: keyof typeof NOT_RUN_MESSAGES): SimulationResult {
  const error: { code: SimulationErrorCode; userMessage: string } = { code, userMessage: NOT_RUN_MESSAGES[code] };
  return {
    ran: false,
    ok: false,
    error,
    logs: [],
    logsTruncated: false,
    innerInstructions: [],
    changes: [],
    watched: [],
    notWatched: [],
    preState: [],
  };
}

type Analysis = Omit<AnalyzeResponse, "requestId">;

/** Throws DecodeError for unusable input; everything else becomes part of the result. */
export async function analyzeTransaction(
  input: string,
  deps: AnalyzeDeps,
  options: AnalyzeOptions = {},
): Promise<Analysis> {
  const started = performance.now();
  const timingsMs: Record<string, number> = {};
  const lap = (name: string, from: number) => {
    timingsMs[name] = Math.round(performance.now() - from);
  };
  const base64 = normalizeBase64Input(input);
  const log = deps.log ?? (() => {});

  // Devnet guard: only ever talk to an endpoint whose genesis hash is devnet's.
  let rpcState: "ok" | "RPC_NOT_CONFIGURED" | "RPC_NOT_DEVNET" | "RPC_UNAVAILABLE" = "RPC_NOT_CONFIGURED";
  if (deps.rpc) {
    try {
      rpcState = (await ensureDevnet(deps.rpc.rpc)) ? "ok" : "RPC_NOT_DEVNET";
    } catch (error) {
      rpcState = "RPC_UNAVAILABLE";
      log(`devnet check failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
    }
  }
  const rpc = rpcState === "ok" && deps.rpc ? deps.rpc : null;

  const decodeStart = performance.now();
  let decoded = await decodeTransaction(base64, rpc ? { fetchLookupTables: lookupTableFetcher(rpc.rpc) } : {});
  lap("decode", decodeStart);

  let simulation: SimulationResult;
  if (!rpc) {
    simulation = notRun(rpcState === "ok" ? "RPC_NOT_CONFIGURED" : rpcState);
  } else {
    const simStart = performance.now();
    try {
      const out = await simulateDecoded(rpc.rpc, base64, decoded);
      decoded = out.decoded;
      simulation = { ...out.simulation, rpcEndpoint: rpc.lastEndpoint() };
    } catch (error) {
      if (!(error instanceof SimulationUnavailableError)) throw error;
      log(`simulation unavailable: ${error.message}`);
      simulation = notRun("RPC_UNAVAILABLE");
    }
    lap("simulate", simStart);
  }

  const rulesStart = performance.now();
  // The verdict depends only on the decoded transaction and the simulation.
  const verdict = assessRisk(decoded, simulation);
  lap("rules", rulesStart);

  lap("total", started);
  const result: Analysis = { cluster: "devnet", decoded, simulation, verdict, timingsMs };
  if (options.userAddress) result.userAddress = options.userAddress;
  return result;
}
