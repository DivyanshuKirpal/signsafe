/**
 * Maps simulation errors (Solana TransactionError values) to plain messages
 * (ARCHITECTURE section 9.3). The raw error is kept for the Raw details panel.
 */
import { LIMITS } from "../config";
import type { DecodedTx, SimulationError } from "../types";
import { stringifyJson } from "../util/bigint-json";

const ANOTHER_NETWORK =
  "If this transaction was made for another network (for example mainnet), check it there instead; SignSafe simulates on devnet only.";

function rawText(err: unknown): string {
  const text = typeof err === "string" ? err : stringifyJson(err);
  return text.length > LIMITS.maxArgChars ? `${text.slice(0, LIMITS.maxArgChars)}...` : text;
}

function asIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

/** Plain wording for the instruction errors that matter most in practice. */
function instructionDetail(detail: unknown): { code: SimulationError["code"]; text: string } {
  if (detail === "ComputationalBudgetExceeded") {
    return { code: "COMPUTE_BUDGET_EXCEEDED", text: "ran out of compute units" };
  }
  if (detail === "InsufficientFunds") return { code: "INSTRUCTION_FAILED", text: "failed: insufficient funds" };
  if (detail === "MissingRequiredSignature") {
    return { code: "INSTRUCTION_FAILED", text: "failed: a required signature is missing" };
  }
  if (typeof detail === "object" && detail !== null && "Custom" in detail) {
    const custom = asIndex((detail as { Custom: unknown }).Custom);
    return { code: "INSTRUCTION_FAILED", text: `failed with program error code ${custom ?? "unknown"}` };
  }
  return { code: "INSTRUCTION_FAILED", text: `failed (${typeof detail === "string" ? detail : rawText(detail)})` };
}

/**
 * The node can also refuse to simulate at all (a JSON-RPC error rather than a
 * failed simulation), for example when a lookup table was deactivated: the
 * table account still exists, but the runtime no longer loads it.
 */
export function mapRpcRefusal(serverMessage: string): SimulationError {
  const raw = serverMessage.length > LIMITS.maxArgChars ? `${serverMessage.slice(0, LIMITS.maxArgChars)}...` : serverMessage;
  if (/address (lookup )?table|lookup table/i.test(serverMessage)) {
    return {
      code: "LOOKUP_TABLE_INVALID",
      userMessage:
        "A lookup table this transaction uses no longer works on devnet (it is missing or was deactivated), so the transaction would fail and its effects could not be simulated.",
      raw,
    };
  }
  return {
    code: "SIMULATION_FAILED",
    userMessage: `The RPC node refused to simulate this transaction (${raw}), so its effects could not be confirmed.`,
    raw,
  };
}

export function mapSimulationError(err: unknown, decoded: DecodedTx): SimulationError {
  const raw = rawText(err);

  if (err === "AccountNotFound" || err === "InvalidAccountForFee" || err === "InsufficientFundsForFee") {
    return {
      code: "FEE_PAYER_UNFUNDED",
      userMessage: `The fee payer has no SOL on devnet or does not exist there, so the transaction could not run. ${ANOTHER_NETWORK}`,
      raw,
    };
  }
  if (err === "ProgramAccountNotFound" || err === "InvalidProgramForExecution") {
    return {
      code: "PROGRAM_NOT_FOUND",
      userMessage: `A program this transaction calls does not exist on devnet. ${ANOTHER_NETWORK}`,
      raw,
    };
  }
  if (
    err === "AddressLookupTableNotFound" ||
    err === "InvalidAddressLookupTableIndex" ||
    err === "InvalidAddressLookupTableData" ||
    err === "InvalidAddressLookupTableOwner"
  ) {
    return {
      code: "LOOKUP_TABLE_INVALID",
      userMessage: `A lookup table this transaction uses is missing or invalid on devnet. ${ANOTHER_NETWORK}`,
      raw,
    };
  }
  if (typeof err === "object" && err !== null) {
    if ("InstructionError" in err) {
      const [rawIndex, detail] = (err as { InstructionError: [unknown, unknown] }).InstructionError;
      const index = asIndex(rawIndex);
      const ix = index !== undefined ? decoded.instructions[index] : undefined;
      const { code, text } = instructionDetail(detail);
      const where = ix ? `Instruction #${index} (${ix.programName})` : `Instruction #${index ?? "?"}`;
      return {
        code,
        userMessage: `${where} ${text}, so the whole transaction would fail and nothing would change.`,
        raw,
        instructionIndex: index,
        programId: ix?.programId,
      };
    }
    if ("InsufficientFundsForRent" in err) {
      return {
        code: "INSUFFICIENT_FUNDS_FOR_RENT",
        userMessage: "An account would be left with too little SOL to stay open (rent), so the transaction would fail.",
        raw,
      };
    }
  }
  return {
    code: "SIMULATION_FAILED",
    userMessage: `The simulation failed (${raw}), so the effects of this transaction could not be confirmed.`,
    raw,
  };
}
