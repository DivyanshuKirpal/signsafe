import { couldNotCheckMessages } from "../lib/gaps";
import type { DecodedTx, SimulationResult } from "../lib/types";
import { Address } from "./address";

/**
 * Everything that limited the check, in one place: decoding warnings (lookup
 * tables, undecodable instructions, watch-list cap), a simulation that did not
 * run or failed, and accounts that were not compared.
 */
export function CouldNotCheck({ decoded, simulation }: { decoded: DecodedTx; simulation: SimulationResult }) {
  // Same sentences the AI is given (app/lib/gaps.ts), so both always agree.
  const items = couldNotCheckMessages(decoded, simulation);
  if (items.length === 0 && simulation.notWatched.length === 0) return null;

  return (
    <section aria-labelledby="unchecked-heading" role="note" className="rounded-lg border border-border p-4 text-sm">
      <h2 id="unchecked-heading" className="font-semibold">
        What could not be checked
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
        {simulation.notWatched.length > 0 && (
          <li>
            These accounts are written to but their before/after state was not compared:{" "}
            {simulation.notWatched.map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                <Address value={a} />
              </span>
            ))}
            .
          </li>
        )}
      </ul>
    </section>
  );
}
