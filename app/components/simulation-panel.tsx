import { formatSol } from "../lib/solana/format";
import type { SimulationResult } from "../lib/types";
import { InstructionList } from "./instruction-list";
import { StateChanges } from "./state-changes";

function statusText(simulation: SimulationResult): string {
  if (!simulation.ran) return "Not simulated.";
  if (simulation.ok) return "Simulated on devnet: the transaction would succeed with the changes below.";
  return "Simulated on devnet: the transaction would fail.";
}

export function SimulationPanel({ simulation }: { simulation: SimulationResult }) {
  return (
    <section aria-labelledby="simulation-heading" className="space-y-4">
      <h2 id="simulation-heading" className="text-lg font-semibold">
        What would change (devnet simulation)
      </h2>
      <div className="space-y-1 text-sm">
        <p>{statusText(simulation)}</p>
        {simulation.ran && !simulation.ok && simulation.error && <p>{simulation.error.userMessage}</p>}
        {simulation.feeLamports !== undefined && (
          <p className="text-muted">
            Network fee: {formatSol(BigInt(simulation.feeLamports))} (reported by the devnet RPC), paid by the fee payer.
          </p>
        )}
        {simulation.unitsConsumed !== undefined && (
          <p className="text-muted">Compute units used: {simulation.unitsConsumed.toLocaleString("en-US")}.</p>
        )}
      </div>

      {simulation.ran && simulation.ok && <StateChanges changes={simulation.changes} watched={simulation.watched} />}

      {simulation.innerInstructions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold">Calls made by programs (inner instructions)</h3>
          <p className="text-xs text-muted">
            Programs can call other programs. These calls were reported by the simulation; known ones were decoded
            by the RPC node.
          </p>
          <InstructionList instructions={simulation.innerInstructions} />
        </div>
      )}

      {simulation.ran && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">
            Raw details: program logs{simulation.logsTruncated ? " (shortened)" : ""} and accounts compared
          </summary>
          <p className="mt-2 text-muted">Logs are written by the programs themselves. Treat them as untrusted text.</p>
          <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-border p-2 font-mono whitespace-pre-wrap break-all">
            {simulation.logs.length > 0 ? simulation.logs.join("\n") : "(no logs)"}
          </pre>
          {simulation.error?.raw && <p className="mt-2 font-mono break-all">Raw error: {simulation.error.raw}</p>}
          <p className="mt-2 text-muted">
            {simulation.watched.length} account(s) compared
            {simulation.slots?.simulation ? `, simulated at slot ${simulation.slots.simulation}` : ""}
            {simulation.rpcEndpoint ? ` (${simulation.rpcEndpoint} RPC endpoint)` : ""}.
          </p>
        </details>
      )}
    </section>
  );
}
