/**
 * Everything that limited a check, as plain sentences. Shared by the
 * "What could not be checked" panel and the facts given to the AI, so both
 * always list the same gaps.
 */
import type { DecodedTx, SimulationResult } from "./types";
import { shortAddress } from "./solana/format";

/** Decoding warnings and a simulation that did not run or failed. */
export function couldNotCheckMessages(decoded: DecodedTx, simulation: SimulationResult): string[] {
  const items: string[] = decoded.warnings.map((w) => w.message);
  if (!simulation.ran && simulation.error) {
    items.push(simulation.error.userMessage);
  } else if (simulation.ran && !simulation.ok && simulation.error) {
    items.push(`The simulation failed, so the effects could not be confirmed. ${simulation.error.userMessage}`);
  }
  return items;
}

/** The messages plus the accounts left out of the before/after comparison, as text. */
export function couldNotCheckItems(decoded: DecodedTx, simulation: SimulationResult): string[] {
  const items = couldNotCheckMessages(decoded, simulation);
  if (simulation.notWatched.length > 0) {
    items.push(
      `These accounts are written to but their before/after state was not compared: ${simulation.notWatched.map(shortAddress).join(", ")}.`,
    );
  }
  return items;
}
