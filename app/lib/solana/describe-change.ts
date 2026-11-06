/**
 * Plain-English rendering of a StateChange for the UI, the scripts and (in M5)
 * the AI prompt facts. Integer math only.
 */
import type { StateChange } from "../types";
import { formatSol, formatTokenAmount, shortAddress } from "./format";
import { lookupProgram } from "./programs";

export interface ChangeText {
  label: string;
  before: string;
  after: string;
  /** Signed difference for balances, e.g. "-0.010005 SOL". */
  delta?: string;
  note?: string;
}

function big(value: string | null | undefined): bigint | undefined {
  return value !== null && value !== undefined && /^-?\d+$/.test(value) ? BigInt(value) : undefined;
}

function signed(text: string, value: bigint): string {
  return value > 0n ? `+${text}` : text;
}

function programLabel(address: string | null): string {
  if (!address) return "none";
  return lookupProgram(address)?.name ?? `program ${shortAddress(address)}`;
}

function tokens(raw: string | null | undefined, decimals?: number): string {
  const value = big(raw);
  return value === undefined ? "unknown" : formatTokenAmount(value, decimals);
}

export function describeChange(c: StateChange): ChangeText {
  switch (c.kind) {
    case "sol": {
      const before = big(c.before) ?? 0n;
      const after = big(c.after) ?? 0n;
      const delta = after - before;
      const fee = big(c.includesFeeLamports);
      return {
        label: "SOL balance",
        before: formatSol(before),
        after: formatSol(after),
        delta: signed(formatSol(delta), delta),
        note: fee !== undefined ? `Includes the network fee of ${formatSol(fee)} (this account pays the fee).` : undefined,
      };
    }
    case "token": {
      const delta = big(c.delta) ?? 0n;
      const magnitude = formatTokenAmount(delta < 0n ? -delta : delta, c.decimals);
      return {
        label: `Token balance${c.mint ? ` (mint ${shortAddress(c.mint)})` : ""}`,
        before: tokens(c.before, c.decimals),
        after: tokens(c.after, c.decimals),
        delta: `${delta < 0n ? "-" : "+"}${magnitude}`,
      };
    }
    case "delegate": {
      const side = (delegate: string | null, allowance?: string) =>
        delegate ? `${shortAddress(delegate)} may spend ${tokens(allowance, c.decimals)}` : "no one";
      return {
        label: "Spending permission (delegate)",
        before: side(c.before, c.allowanceBefore),
        after: side(c.after, c.allowanceAfter),
        note: "An approval moves no tokens now; the delegate can move them later without asking again.",
      };
    }
    case "tokenOwner":
      return {
        label: "Token account owner",
        before: c.before ? shortAddress(c.before) : "none",
        after: c.after ? shortAddress(c.after) : "none",
      };
    case "closeAuthority":
      return {
        label: "Close authority",
        before: c.before ? shortAddress(c.before) : "none (the owner)",
        after: c.after ? shortAddress(c.after) : "none (the owner)",
      };
    case "programOwner":
      return {
        label: "Owning program",
        before: programLabel(c.before),
        after: programLabel(c.after),
        note: "The owning program controls this account's data and SOL.",
      };
    case "created":
      return { label: "Account created", before: "did not exist", after: `owned by ${programLabel(c.after)}` };
    case "closed":
      return { label: "Account closed", before: `owned by ${programLabel(c.before)}`, after: "removed" };
  }
}
