/**
 * Parses one instruction into a DecodedIx. Used for top-level instructions
 * (M1) and, later, for inner instructions returned by simulation (M2).
 *
 * Known programs are parsed with their official program clients
 * (identify + parse helpers). A parse failure becomes action "unknown" with a
 * parseError; this function never throws.
 */
import {
  AccountRole,
  type Address,
  type Instruction,
  type InstructionWithData,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { parseSystemInstruction, SystemInstruction } from "@solana-program/system";
import {
  AssociatedTokenInstruction,
  AuthorityType as TokenAuthorityType,
  parseAssociatedTokenInstruction,
  parseTokenInstruction,
  TokenInstruction,
} from "@solana-program/token";
import {
  AuthorityType as Token2022AuthorityType,
  parseToken2022Instruction,
  Token2022Instruction,
} from "@solana-program/token-2022";
import {
  ComputeBudgetInstruction,
  parseComputeBudgetInstruction,
} from "@solana-program/compute-budget";
import { LIMITS } from "../config";
import type { ArgValue, DecodedIx } from "../types";
import { stringifyJson, toJsonSafe } from "../util/bigint-json";
import { describeInstruction } from "./describe";
import { lookupProgram, type ProgramKey, UNKNOWN_PROGRAM_NAME } from "./programs";

/** One account of an instruction, with its role from the message header. */
export interface RawAccount {
  address: string;
  signer: boolean;
  writable: boolean;
}

/** An instruction with its account indexes already resolved to addresses. */
export interface RawInstruction {
  programAddress: string;
  accounts: RawAccount[];
  data: ReadonlyUint8Array;
}

/** What a program client's parse function returns, checked at runtime. */
interface ParsedShape {
  instructionType: number;
  accounts: Record<string, unknown>;
  data: Record<string, unknown>;
}

type EnumNames = Record<number, string>;

interface ClientParser {
  parse: (ix: Instruction & InstructionWithData<ReadonlyUint8Array>) => unknown;
  names: EnumNames;
  authorityTypes?: EnumNames;
}

const CLIENT_PARSERS: Partial<Record<ProgramKey, ClientParser>> = {
  system: { parse: parseSystemInstruction, names: SystemInstruction },
  token: {
    parse: parseTokenInstruction,
    names: TokenInstruction,
    authorityTypes: TokenAuthorityType,
  },
  token2022: {
    parse: parseToken2022Instruction,
    names: Token2022Instruction,
    authorityTypes: Token2022AuthorityType,
  },
  associatedToken: {
    parse: parseAssociatedTokenInstruction,
    names: AssociatedTokenInstruction,
  },
  computeBudget: {
    parse: parseComputeBudgetInstruction,
    names: ComputeBudgetInstruction,
  },
};

/** Address Lookup Table program instruction names, by u32 little-endian index. */
const LOOKUP_TABLE_ACTIONS = [
  "createLookupTable",
  "freezeLookupTable",
  "extendLookupTable",
  "deactivateLookupTable",
  "closeLookupTable",
];

function toRole(account: RawAccount): AccountRole {
  if (account.signer) {
    return account.writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  }
  return account.writable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

function toKitInstruction(raw: RawInstruction): Instruction & InstructionWithData<ReadonlyUint8Array> {
  return {
    // The parsers only read these fields; they do not validate addresses, so an
    // unresolved lookup-table placeholder can pass through as an "address".
    programAddress: raw.programAddress as Address,
    accounts: raw.accounts.map((a) => ({ address: a.address as Address, role: toRole(a) })),
    data: raw.data,
  };
}

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function bytesToHex(bytes: ReadonlyUint8Array, maxBytes: number): string {
  const hex = Array.from(bytes.slice(0, maxBytes), (b) => b.toString(16).padStart(2, "0")).join("");
  return bytes.length > maxBytes ? `0x${hex}... (${bytes.length} bytes)` : `0x${hex}`;
}

function isOption(value: unknown): value is { __option: "Some" | "None"; value?: unknown } {
  return typeof value === "object" && value !== null && "__option" in value;
}

/** Converts one decoded data field to a flat, JSON-safe, length-capped value. */
export function toArgValue(value: unknown): ArgValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cap(value, LIMITS.maxArgChars);
  if (value instanceof Uint8Array) return bytesToHex(value, 32);
  if (isOption(value)) return value.__option === "Some" ? (toArgValue(value.value) ?? null) : null;
  return cap(stringifyJson(toJsonSafe(value)), LIMITS.maxArgChars);
}

function asParsedShape(value: unknown): ParsedShape | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.instructionType !== "number") return undefined;
  const accounts = typeof v.accounts === "object" && v.accounts !== null ? v.accounts : {};
  const data = typeof v.data === "object" && v.data !== null ? v.data : {};
  return {
    instructionType: v.instructionType,
    accounts: accounts as Record<string, unknown>,
    data: data as Record<string, unknown>,
  };
}

function namedAccounts(parsed: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, meta] of Object.entries(parsed)) {
    if (typeof meta === "object" && meta !== null && "address" in meta) {
      const address = (meta as { address: unknown }).address;
      if (typeof address === "string") out[name] = address;
    }
  }
  return out;
}

function positionalAccounts(accounts: RawAccount[], prefix = "account"): Record<string, string> {
  const out: Record<string, string> = {};
  accounts.forEach((a, i) => {
    out[`${prefix}${i + 1}`] = a.address;
  });
  return out;
}

function decodedArgs(data: Record<string, unknown>, authorityTypes?: EnumNames): Record<string, ArgValue> {
  const args: Record<string, ArgValue> = {};
  for (const [key, value] of Object.entries(data)) {
    // Discriminators identify the instruction; they are already in `action`.
    if (key === "discriminator" || key.endsWith("Discriminator")) continue;
    if (key === "authorityType" && typeof value === "number" && authorityTypes?.[value]) {
      args[key] = authorityTypes[value];
      continue;
    }
    const converted = toArgValue(value);
    if (converted !== undefined) args[key] = converted;
  }
  return args;
}

/**
 * Memo text is written by whoever built the transaction, so it is untrusted:
 * strip control and bidirectional-override characters (which can disguise
 * text) and cap the length.
 */
export function sanitizeUntrustedText(text: string, max: number): { text: string; truncated: boolean } {
  const cleaned = text
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "");
  const chars = Array.from(cleaned);
  if (chars.length <= max) return { text: cleaned, truncated: false };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

interface ParseResult {
  action: string;
  accounts: Record<string, string>;
  args: Record<string, ArgValue>;
  parseError?: string;
}

function parseKnown(key: ProgramKey, raw: RawInstruction): ParseResult {
  const client = CLIENT_PARSERS[key];
  if (client) {
    const parsed = asParsedShape(client.parse(toKitInstruction(raw)));
    if (!parsed) throw new Error("the program client returned an unexpected shape");
    const name = client.names[parsed.instructionType];
    return {
      action: name ? lowerFirst(name) : "unknown",
      accounts: namedAccounts(parsed.accounts),
      args: decodedArgs(parsed.data, client.authorityTypes),
    };
  }

  if (key === "memo" || key === "memoV2" || key === "memoV1") {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(raw.data as Uint8Array);
    const { text, truncated } = sanitizeUntrustedText(decoded, LIMITS.maxMemoChars);
    return {
      action: "memo",
      accounts: positionalAccounts(raw.accounts, "signer"),
      args: { text, truncated, untrusted: true },
    };
  }

  if (key === "addressLookupTable") {
    if (raw.data.length < 4) throw new Error("instruction data is too short");
    const index = new DataView(raw.data.buffer, raw.data.byteOffset, 4).getUint32(0, true);
    const action = LOOKUP_TABLE_ACTIONS[index];
    if (!action) throw new Error(`unrecognised lookup table instruction ${index}`);
    return { action, accounts: positionalAccounts(raw.accounts), args: {} };
  }

  throw new Error("no parser for this program");
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return cap(message, LIMITS.maxArgChars);
}

export function parseInstruction(raw: RawInstruction, path: string, inner: boolean): DecodedIx {
  const program = lookupProgram(raw.programAddress);
  const base = {
    path,
    programId: raw.programAddress,
    programName: program?.name ?? UNKNOWN_PROGRAM_NAME,
    known: program !== undefined,
    inner,
    accountCount: raw.accounts.length,
    dataLength: raw.data.length,
  };

  let result: ParseResult;
  if (!program) {
    result = {
      action: "unknown",
      accounts: positionalAccounts(raw.accounts),
      args: raw.data.length > 0 ? { dataPrefix: bytesToHex(raw.data, 8) } : {},
    };
  } else {
    try {
      result = parseKnown(program.key, raw);
    } catch (error) {
      result = {
        action: "unknown",
        accounts: positionalAccounts(raw.accounts),
        args: raw.data.length > 0 ? { dataPrefix: bytesToHex(raw.data, 8) } : {},
        parseError: errorMessage(error),
      };
    }
  }

  const ix: Omit<DecodedIx, "summary"> = { ...base, ...result };
  return { ...ix, summary: describeInstruction(ix) };
}
