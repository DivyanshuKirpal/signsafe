/**
 * Builders for rule tests: hand-written (synthetic) decoded transactions,
 * pre-transaction state and state changes. No network.
 */
import { buildContext, type RiskContext } from "../../app/lib/risk/context";
import { lookupProgram } from "../../app/lib/solana/programs";
import type { AccountState, DecodedIx, DecodedTx, SimulationResult, StateChange } from "../../app/lib/types";

export const SYSTEM = "11111111111111111111111111111111";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const UNKNOWN_PROGRAM = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

export const VICTIM = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export const FRIEND = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
export const ATTACKER = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
export const TOKEN_ACCOUNT = "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9";
export const MINT = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
export const U64_MAX_TEXT = "18446744073709551615";

export function ix(
  programId: string,
  action: string,
  accounts: Record<string, string>,
  args: DecodedIx["args"] = {},
  extra: Partial<DecodedIx> = {},
): DecodedIx {
  const program = lookupProgram(programId);
  return {
    path: "0",
    programId,
    programName: program?.name ?? "Unknown program",
    known: program !== undefined,
    action,
    accounts,
    args,
    inner: false,
    summary: `${program?.name ?? "Unknown program"}: ${action}`,
    accountCount: Object.keys(accounts).length,
    dataLength: 1,
    ...extra,
  };
}

export function tokenState(
  address: string,
  t: { owner: string; amount: string; decimals?: number; delegate?: string | null; delegatedAmount?: string; closeAuthority?: string | null },
): AccountState {
  return {
    address,
    exists: true,
    lamports: "2039280",
    owner: TOKEN,
    token: {
      program: "token",
      mint: MINT,
      owner: t.owner,
      amount: t.amount,
      decimals: t.decimals ?? 6,
      delegate: t.delegate ?? null,
      delegatedAmount: t.delegatedAmount ?? "0",
      closeAuthority: t.closeAuthority ?? null,
    },
  };
}

export function walletState(address: string, lamports: string, owner = SYSTEM): AccountState {
  return { address, exists: true, lamports, owner };
}

export interface CtxInput {
  instructions?: DecodedIx[];
  inner?: DecodedIx[];
  changes?: StateChange[];
  pre?: AccountState[];
  signers?: string[];
  decoded?: Partial<DecodedTx>;
  simulation?: Partial<SimulationResult>;
}

export function decodedOf(input: CtxInput): DecodedTx {
  const signers = input.signers ?? [VICTIM];
  return {
    version: "legacy",
    sizeBytes: 200,
    feePayer: signers[0],
    signers,
    writable: [],
    signatures: signers.map((address) => ({ address, present: false })),
    accountKeys: [],
    lifetimeToken: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
    usesDurableNonce: false,
    lookupTables: [],
    budget: { source: "none" },
    instructions: (input.instructions ?? []).map((x, i) => ({ ...x, path: x.inner ? x.path : String(i) })),
    warnings: [],
    ...input.decoded,
  };
}

export function simulationOf(input: CtxInput): SimulationResult {
  return {
    ran: true,
    ok: true,
    feeLamports: "5000",
    logs: [],
    logsTruncated: false,
    innerInstructions: input.inner ?? [],
    changes: input.changes ?? [],
    watched: [],
    notWatched: [],
    preState: input.pre ?? [],
    ...input.simulation,
  };
}

export function ctxOf(input: CtxInput): RiskContext {
  return buildContext(decodedOf(input), simulationOf(input));
}

export function approveIx(amount: string, opts: { delegate?: string; owner?: string; program?: string; inner?: boolean; decimals?: number } = {}): DecodedIx {
  const checked = opts.decimals !== undefined;
  return ix(
    opts.program ?? TOKEN,
    checked ? "approveChecked" : "approve",
    { source: TOKEN_ACCOUNT, delegate: opts.delegate ?? ATTACKER, owner: opts.owner ?? VICTIM, ...(checked ? { mint: MINT } : {}) },
    checked ? { amount, decimals: opts.decimals ?? 6 } : { amount },
    opts.inner ? { inner: true, path: "0.0", decodedBy: "rpc" } : {},
  );
}

export function delegateChange(after: string | null, allowanceAfter: string, before: string | null = null, allowanceBefore = "0"): StateChange {
  return { address: TOKEN_ACCOUNT, kind: "delegate", before, after, allowanceBefore, allowanceAfter, mint: MINT, decimals: 6, tokenAccountOwner: VICTIM };
}

export function solChange(address: string, before: string, after: string, fee?: string): StateChange {
  const change: StateChange = { address, kind: "sol", before, after, delta: (BigInt(after) - BigInt(before)).toString() };
  if (fee) change.includesFeeLamports = fee;
  return change;
}
