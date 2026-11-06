/**
 * The input every rule receives, and small helpers the rules share.
 * Rules are pure: they read this context and return flags. No network.
 *
 * Permission checks use the account's state BEFORE the transaction (its real
 * owner and balance), never "the user" and never the instruction's own claim
 * about who the owner is: a drainer can be the fee payer or a co-signer, and
 * can put any address in an instruction's owner field.
 */
import { RISK } from "../config";
import { describeChange } from "../solana/describe-change";
import { formatSol, formatTokenAmount, shortAddress } from "../solana/format";
import { lookupProgram } from "../solana/programs";
import type {
  AccountState,
  ArgValue,
  DecodedIx,
  DecodedTx,
  FlagSource,
  RiskFlag,
  SimulationResult,
  StateChange,
} from "../types";

export interface RiskContext {
  decoded: DecodedTx;
  simulation: SimulationResult;
  /** Top-level instructions, then inner instructions reported by the simulation. */
  instructions: DecodedIx[];
  /** Pre-transaction state by address (empty when the RPC was not reached). */
  pre: ReadonlyMap<string, AccountState>;
  signers: ReadonlySet<string>;
  /** State changes; empty unless the simulation ran and succeeded. */
  changes: StateChange[];
  thresholds: typeof RISK;
}

export function buildContext(decoded: DecodedTx, simulation: SimulationResult, thresholds = RISK): RiskContext {
  return {
    decoded,
    simulation,
    instructions: [...decoded.instructions, ...simulation.innerInstructions],
    pre: new Map(simulation.preState.map((s) => [s.address, s])),
    signers: new Set(decoded.signers),
    changes: simulation.ran && simulation.ok ? simulation.changes : [],
    thresholds,
  };
}

/** A flag before merging; flags with the same key describe the same problem. */
export type RawFlag = RiskFlag & { key: string };
export type Rule = (ctx: RiskContext) => RawFlag[];

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function big(value: ArgValue | string | null | undefined): bigint | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return undefined;
  return BigInt(value);
}

/** part is at least pct% of whole, in integer math: part * 100 >= pct * whole. */
export function atLeastPct(part: bigint, whole: bigint, pct: bigint): boolean {
  return part * 100n >= pct * whole;
}

/** Whole-number percentage, rounded down. */
export function floorPct(part: bigint, whole: bigint): string {
  return whole > 0n ? `${(part * 100n) / whole}%` : "n/a";
}

export function programKey(ix: DecodedIx) {
  return lookupProgram(ix.programId)?.key;
}

export function isTokenIx(ix: DecodedIx): boolean {
  const key = programKey(ix);
  return key === "token" || key === "token2022";
}

export function isSystemIx(ix: DecodedIx): boolean {
  return programKey(ix) === "system";
}

export function ixSource(ix: DecodedIx): FlagSource {
  return { type: "instruction", path: ix.path, inner: ix.inner, summary: ix.summary };
}

export function changeSource(change: StateChange): FlagSource {
  const t = describeChange(change);
  return {
    type: "stateChange",
    address: change.address,
    changeKind: change.kind,
    description: `${t.label}: ${t.before} -> ${t.after}${t.delta ? ` (${t.delta})` : ""}`,
  };
}

/** Shared wording of R-UNRESOLVED, so flags from different rules merge cleanly. */
export const UNRESOLVED_TITLE = "Part of this transaction could not be checked";
export const UNRESOLVED_DETAIL =
  "SignSafe could not see everything this transaction does or touches, so some effects may be hidden. The gaps are listed below.";

/**
 * A rule needed an account's state before the transaction (its real owner or
 * balance) and it was not available. The check is then incomplete: this adds
 * to the single R-UNRESOLVED flag, which makes the verdict "Could not fully
 * check" unless something else is already Danger.
 */
export function missingState(address: string, what: string): RawFlag {
  return {
    key: "unresolved",
    ruleId: "R-UNRESOLVED",
    severity: "caution",
    title: UNRESOLVED_TITLE,
    detail: UNRESOLVED_DETAIL,
    evidence: {},
    sources: [{ type: "missingState", address, message: `The ${what} of ${shortAddress(address)} before the transaction could not be read.` }],
  };
}

export function tokenText(raw: bigint, decimals?: number): string {
  return formatTokenAmount(raw, decimals);
}

export function solText(lamports: bigint): string {
  return formatSol(lamports);
}

export const short = shortAddress;
