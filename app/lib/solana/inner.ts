/**
 * Inner instructions (calls programs make to other programs, "CPIs") returned
 * by simulateTransaction.
 *
 * The RPC returns them in one of three shapes:
 *   - parsed by the node:   { programId, program, parsed: { type, info } }   (known programs)
 *   - partially decoded:    { programId, accounts: [addresses], data: base58 } (unknown programs)
 *   - compiled:             { programIdIndex, accounts: [indexes], data: base58 }
 * Raw-data shapes go through our own parser (parseInstruction). The node's
 * parsed shape has no raw bytes, so it is mapped onto our naming (actions and
 * account names match the program clients) and marked decodedBy: "rpc".
 */
import { getBase58Encoder, isAddress } from "@solana/kit";
import { LIMITS } from "../config";
import type { AccountKey, ArgValue, DecodedIx } from "../types";
import { describeInstruction } from "./describe";
import { parseInstruction, type RawAccount, sanitizeUntrustedText, toArgValue } from "./instructions";
import { lookupProgram, UNKNOWN_PROGRAM_NAME } from "./programs";

type Rename = Record<string, string>;

/** RPC "type" names that differ from the program clients' names. */
const ACTION_RENAMES: Record<string, Rename> = {
  system: { transfer: "transferSol", transferWithSeed: "transferSolWithSeed" },
  associatedToken: { create: "createAssociatedToken", createIdempotent: "createAssociatedTokenIdempotent" },
};

/** RPC "info" keys that differ from the program clients' account/arg names, per action. */
const KEY_RENAMES: Record<string, Rename> = {
  "system:transferSol": { lamports: "amount" },
  "system:transferSolWithSeed": { lamports: "amount" },
  "system:createAccount": { source: "payer", owner: "programAddress" },
  "system:createAccountWithSeed": { source: "payer", owner: "programAddress", lamports: "amount" },
  "system:assign": { owner: "programAddress" },
  "system:assignWithSeed": { owner: "programAddress" },
  "system:allocate": { account: "newAccount" },
  "token:setAuthority": { account: "owned", mint: "owned", authority: "owner", multisigAuthority: "owner" },
  "token:mintTo": { account: "token" },
  "token:mintToChecked": { account: "token" },
  "associatedToken:createAssociatedToken": { source: "payer", account: "ata", wallet: "owner" },
  "associatedToken:createAssociatedTokenIdempotent": { source: "payer", account: "ata", wallet: "owner" },
};

/** Address-valued keys that the program clients treat as data, not accounts. */
const ADDRESS_ARGS = new Set(["programAddress", "newAuthority"]);

function familyOf(programId: string): string | undefined {
  const key = lookupProgram(programId)?.key;
  if (key === "token" || key === "token2022") return "token";
  return key;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

/** Maps one node-parsed instruction onto our DecodedIx shape. */
export function fromRpcParsed(
  programId: string,
  type: string,
  info: unknown,
  path: string,
): DecodedIx {
  const program = lookupProgram(programId);
  const family = familyOf(programId) ?? "";
  const action = ACTION_RENAMES[family]?.[type] ?? type;
  const renames = KEY_RENAMES[`${family}:${action}`] ?? {};
  const accounts: Record<string, string> = {};
  const args: Record<string, ArgValue> = {};

  const entries = typeof info === "object" && info !== null ? Object.entries(info) : [];
  for (const [rawKey, value] of entries) {
    const key = renames[rawKey] ?? rawKey;
    if (key === "tokenAmount" && typeof value === "object" && value !== null) {
      const t = value as { amount?: unknown; decimals?: unknown };
      if (typeof t.amount === "string") args.amount = t.amount;
      const decimals = asNumber(t.decimals);
      if (decimals !== undefined) args.decimals = decimals;
      continue;
    }
    if (key === "authorityType" && typeof value === "string") {
      args.authorityType = value.charAt(0).toUpperCase() + value.slice(1);
      continue;
    }
    if (typeof value === "string" && isAddress(value) && !ADDRESS_ARGS.has(key)) {
      accounts[key] = value;
      continue;
    }
    const converted = toArgValue(value);
    if (converted !== undefined) args[key] = converted;
  }

  const ix: Omit<DecodedIx, "summary"> = {
    path,
    programId,
    programName: program?.name ?? UNKNOWN_PROGRAM_NAME,
    known: program !== undefined,
    action,
    accounts,
    args,
    inner: true,
    accountCount: Object.keys(accounts).length,
    dataLength: 0,
    decodedBy: "rpc",
  };
  return { ...ix, summary: describeInstruction(ix) };
}

function memoFromRpc(programId: string, text: string, path: string): DecodedIx {
  const clean = sanitizeUntrustedText(text, LIMITS.maxMemoChars);
  const ix: Omit<DecodedIx, "summary"> = {
    path,
    programId,
    programName: lookupProgram(programId)?.name ?? "Memo",
    known: lookupProgram(programId) !== undefined,
    action: "memo",
    accounts: {},
    args: { text: clean.text, truncated: clean.truncated, untrusted: true },
    inner: true,
    accountCount: 0,
    dataLength: 0,
    decodedBy: "rpc",
  };
  return { ...ix, summary: describeInstruction(ix) };
}

function rawAccountFor(address: string, keys: readonly AccountKey[]): RawAccount {
  const key = keys.find((k) => k.address === address);
  return { address, signer: key?.signer ?? false, writable: key?.writable ?? false };
}

function decodeBase58(data: unknown): Uint8Array | undefined {
  if (typeof data !== "string") return undefined;
  try {
    return Uint8Array.from(getBase58Encoder().encode(data));
  } catch {
    return undefined;
  }
}

function unreadable(path: string, reason: string): DecodedIx {
  const ix: Omit<DecodedIx, "summary"> = {
    path,
    programId: "?",
    programName: UNKNOWN_PROGRAM_NAME,
    known: false,
    action: "unknown",
    accounts: {},
    args: {},
    inner: true,
    accountCount: 0,
    dataLength: 0,
    parseError: reason,
  };
  return { ...ix, summary: "An inner instruction could not be read." };
}

/** Converts one inner instruction of any shape. Never throws. */
export function decodeInnerInstruction(raw: unknown, path: string, keys: readonly AccountKey[]): DecodedIx {
  if (typeof raw !== "object" || raw === null) return unreadable(path, "unexpected shape");
  const r = raw as Record<string, unknown>;

  // Parsed by the node.
  if (typeof r.programId === "string" && "parsed" in r) {
    if (typeof r.parsed === "string") return memoFromRpc(r.programId, r.parsed, path);
    const parsed = r.parsed as { type?: unknown; info?: unknown } | null;
    if (parsed && typeof parsed.type === "string") return fromRpcParsed(r.programId, parsed.type, parsed.info, path);
    return unreadable(path, "unexpected parsed shape");
  }

  const data = decodeBase58(r.data);
  if (!data) return unreadable(path, "missing instruction data");

  // Partially decoded: addresses given directly.
  if (typeof r.programId === "string" && Array.isArray(r.accounts)) {
    const accounts = r.accounts.filter((a): a is string => typeof a === "string").map((a) => rawAccountFor(a, keys));
    return parseInstruction({ programAddress: r.programId, accounts, data }, path, true);
  }

  // Compiled: indexes into the transaction's full account list.
  const programIndex = asNumber(r.programIdIndex);
  if (programIndex !== undefined && Array.isArray(r.accounts)) {
    const program = keys[programIndex];
    const indexes = r.accounts.map(asNumber);
    if (!program || indexes.some((i) => i === undefined || !keys[i])) {
      return unreadable(path, "account index out of range");
    }
    const accounts = indexes.map((i) => {
      const k = keys[i as number];
      return { address: k.address, signer: k.signer, writable: k.writable };
    });
    return parseInstruction({ programAddress: program.address, accounts, data }, path, true);
  }
  return unreadable(path, "unexpected shape");
}

/** Flattens the RPC's innerInstructions list into DecodedIx[] with paths "i.j". */
export function decodeInnerInstructions(list: unknown, keys: readonly AccountKey[]): DecodedIx[] {
  if (!Array.isArray(list)) return [];
  const out: DecodedIx[] = [];
  for (const group of list) {
    if (typeof group !== "object" || group === null) continue;
    const g = group as { index?: unknown; instructions?: unknown };
    const index = asNumber(g.index);
    if (index === undefined || !Array.isArray(g.instructions)) continue;
    g.instructions.forEach((ix, j) => out.push(decodeInnerInstruction(ix, `${index}.${j}`, keys)));
  }
  return out;
}
