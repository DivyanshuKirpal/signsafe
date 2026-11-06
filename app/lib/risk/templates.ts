/**
 * Fixed wording written by us (ARCHITECTURE 9.4-9.6). The UI never calls a
 * transaction "safe" or "guaranteed"; tests check every string here.
 */
import type { RuleId, VerdictLevel } from "../types";

export const VERDICT_LABELS: Record<VerdictLevel, string> = {
  DANGER: "Danger: don't sign unless you're certain",
  UNKNOWN: "Could not fully check",
  CAUTION: "Caution: check the details",
  LOW_RISK: "No known risks found",
};

export const VERDICT_REASONS = {
  UNKNOWN: "Part of this transaction could not be checked. See what is listed below before you decide.",
  LOW_RISK: "The decoded instructions and the simulated account changes match none of SignSafe's risk rules.",
};

/**
 * One plain sentence per rule, used by the built-in explanation when the AI
 * is off or fails (M5).
 */
export const FALLBACK_SENTENCES: Record<RuleId, string> = {
  "R-APPROVE": "It gives another address permission to move tokens from a token account later, without asking again.",
  "R-DELEGATE-STATE": "After this transaction, another address would be allowed to move tokens from a token account.",
  "R-SET-AUTHORITY": "It hands control of a token account, or of a token mint, to a different address.",
  "R-ASSIGN": "It hands control of an existing wallet account to a program, which could then move its SOL.",
  "R-OUTFLOW": "A signer would lose a large part of a balance.",
  "R-CLOSE-ACCOUNT": "It closes a token account and sends the SOL held in it to an address other than the owner.",
  "R-UNKNOWN-PROGRAM": "It calls a program SignSafe does not recognise; only the simulated changes show what it does.",
  "R-DURABLE-NONCE": "It does not expire, so it could be submitted much later than you expect.",
  "R-HIGH-FEE": "It pays an unusually high priority fee.",
  "R-SIM-FAILED": "Its effects could not be confirmed because the simulation did not run or failed.",
  "R-UNRESOLVED": "Part of the transaction could not be read, so some effects may be hidden.",
  "R-MEMO": "It carries a note written by its sender, which SignSafe never uses to make decisions.",
};
