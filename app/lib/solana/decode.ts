/**
 * Decoding (ARCHITECTURE section 9.2): pasted base64 -> wire transaction ->
 * compiled message -> DecodedTx.
 *
 *   1. normalizeBase64Input   validate and clean the pasted text
 *   2. parseWireTransaction   bytes -> signatures + compiled message (Kit codecs;
 *                             legacy, v0 and v1 are all supported by Kit 8.6)
 *   3. resolveAccountKeys     full account list with signer/writable flags,
 *                             including addresses loaded from lookup tables
 *   4. decodeWireTransaction  parse every top-level instruction, read the
 *                             compute budget, detect durable nonces
 *
 * Nothing here touches the network. Lookup tables are passed in by the caller
 * (decodeTransaction accepts a fetcher; tests pass a mock).
 */
import {
  type AddressesByLookupTableAddress,
  type CompiledTransactionMessage,
  type CompiledTransactionMessageWithLifetime,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { LIMITS } from "../config";
import type {
  AccountKey,
  BudgetInfo,
  DecodedIx,
  DecodedTx,
  DecodeErrorCode,
  DecodeWarning,
  TxVersion,
} from "../types";
import { shortAddress } from "./format";
import { parseInstruction, type RawInstruction } from "./instructions";
import { lookupProgram } from "./programs";

/** A decoding failure with a plain message that is safe to show the user. */
export class DecodeError extends Error {
  readonly code: DecodeErrorCode;
  constructor(code: DecodeErrorCode, message: string) {
    super(message);
    this.name = "DecodeError";
    this.code = code;
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Validates pasted text and returns canonical, padded base64. Whitespace and
 * line breaks are removed (wrapped copies are common); URL-safe base64 is
 * accepted too.
 */
export function normalizeBase64Input(input: string): string {
  if (input.length > LIMITS.maxInputChars) {
    throw new DecodeError(
      "TOO_LONG",
      `The input is longer than ${LIMITS.maxInputChars.toLocaleString("en-US")} characters, which is too long for a Solana transaction.`,
    );
  }
  const compact = input.replace(/\s+/g, "");
  if (compact.length === 0) {
    throw new DecodeError("EMPTY_INPUT", "Paste a base64-encoded transaction first.");
  }
  // A signature is 64 bytes, which is 87 or 88 characters in base58.
  if (BASE58_RE.test(compact) && (compact.length === 87 || compact.length === 88)) {
    throw new DecodeError(
      "LOOKS_LIKE_SIGNATURE",
      "This looks like a transaction signature, not a transaction. Paste the full serialized transaction in base64.",
    );
  }
  const standard = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (!BASE64_RE.test(standard) || standard.replace(/=+$/, "").length % 4 === 1) {
    throw new DecodeError(
      "INVALID_BASE64",
      "This is not valid base64. Paste the transaction exactly as it was exported, in base64.",
    );
  }
  const unpadded = standard.replace(/=+$/, "");
  return unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4);
}

export type CompiledMessage = CompiledTransactionMessage & CompiledTransactionMessageWithLifetime;

export interface WireTransaction {
  sizeBytes: number;
  signatures: { address: string; present: boolean }[];
  message: CompiledMessage;
}

const NOT_A_TRANSACTION =
  "This does not decode as a Solana transaction. Check that you copied the whole serialized transaction.";

function isVersionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /version/i.test(message);
}

/** Header and index checks the network would also apply (sanitization). */
function assertWellFormed(message: CompiledMessage, totalAccounts: number): void {
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  const staticCount = message.staticAccounts.length;
  if (
    numSignerAccounts < 1 ||
    numReadonlySignerAccounts >= numSignerAccounts ||
    numSignerAccounts + numReadonlyNonSignerAccounts > staticCount
  ) {
    throw new DecodeError("NOT_A_TRANSACTION", NOT_A_TRANSACTION);
  }
  for (const ix of compiledInstructions(message)) {
    // Programs must be static accounts; account indexes must exist.
    if (ix.programIndex >= staticCount || ix.accountIndices.some((i) => i >= totalAccounts)) {
      throw new DecodeError(
        "NOT_A_TRANSACTION",
        "This transaction refers to an account that is not in its account list, so it is malformed.",
      );
    }
  }
}

interface CompiledIx {
  programIndex: number;
  accountIndices: number[];
  data: ReadonlyUint8Array;
}

/** Legacy/v0 and v1 store instructions differently; normalise both. */
function compiledInstructions(message: CompiledMessage): CompiledIx[] {
  if (message.version === 1) {
    return message.instructionHeaders.map((header, i) => ({
      programIndex: header.programAccountIndex,
      accountIndices: message.instructionPayloads[i]?.instructionAccountIndices ?? [],
      data: message.instructionPayloads[i]?.instructionData ?? new Uint8Array(),
    }));
  }
  return message.instructions.map((ix) => ({
    programIndex: ix.programAddressIndex,
    accountIndices: ix.accountIndices ?? [],
    data: ix.data ?? new Uint8Array(),
  }));
}

function lookupsOf(message: CompiledMessage) {
  return message.version === 0 ? (message.addressTableLookups ?? []) : [];
}

function countLookupAccounts(message: CompiledMessage): number {
  return lookupsOf(message).reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
}

/** Decodes base64 into signatures and the compiled message. No network. */
export function parseWireTransaction(input: string): WireTransaction {
  const base64 = normalizeBase64Input(input);
  let bytes: ReadonlyUint8Array;
  try {
    bytes = getBase64Encoder().encode(base64);
  } catch {
    throw new DecodeError("INVALID_BASE64", "This is not valid base64.");
  }
  if (bytes.length > LIMITS.maxTransactionBytes) {
    throw new DecodeError(
      "TOO_LARGE",
      `This is ${bytes.length} bytes. Solana transactions are at most ${LIMITS.maxTransactionBytes} bytes.`,
    );
  }

  let message: CompiledMessage;
  let signatures: WireTransaction["signatures"];
  try {
    const tx = getTransactionDecoder().decode(bytes);
    const [decoded, end] = getCompiledTransactionMessageDecoder().read(tx.messageBytes, 0);
    if (end !== tx.messageBytes.length) throw new DecodeError("NOT_A_TRANSACTION", NOT_A_TRANSACTION);
    message = decoded;
    signatures = Object.entries(tx.signatures).map(([address, sig]) => ({
      address,
      present: sig !== null,
    }));
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    if (isVersionError(error)) {
      throw new DecodeError(
        "UNSUPPORTED_VERSION",
        "This transaction uses a format version SignSafe cannot read yet. Supported: legacy, v0 and v1.",
      );
    }
    throw new DecodeError("NOT_A_TRANSACTION", NOT_A_TRANSACTION);
  }

  assertWellFormed(message, message.staticAccounts.length + countLookupAccounts(message));
  return { sizeBytes: bytes.length, signatures, message };
}

export function getLookupTableAddresses(wire: WireTransaction): string[] {
  return lookupsOf(wire.message).map((l) => l.lookupTableAddress);
}

/**
 * Builds the full account list in message order:
 * static accounts, then every lookup table's writable addresses, then every
 * table's readonly addresses. Lookup-table addresses are never signers.
 */
export function resolveAccountKeys(
  message: CompiledMessage,
  tables: AddressesByLookupTableAddress = {},
): { keys: AccountKey[]; warnings: DecodeWarning[] } {
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  const staticCount = message.staticAccounts.length;
  const keys: AccountKey[] = message.staticAccounts.map((address, index) => {
    const signer = index < numSignerAccounts;
    const writable = signer
      ? index < numSignerAccounts - numReadonlySignerAccounts
      : index < staticCount - numReadonlyNonSignerAccounts;
    return { index, address, signer, writable, source: "static", resolved: true };
  });

  const warnings: DecodeWarning[] = [];
  const lookups = lookupsOf(message);
  for (const writable of [true, false]) {
    for (const lookup of lookups) {
      const table = tables[lookup.lookupTableAddress];
      const indexes = writable ? lookup.writableIndexes : lookup.readonlyIndexes;
      for (const tableIndex of indexes) {
        const address = table?.[tableIndex];
        if (table && address === undefined) {
          warnings.push({
            code: "LOOKUP_TABLE_UNRESOLVED",
            message: `Lookup table ${shortAddress(lookup.lookupTableAddress)} has no entry ${tableIndex}.`,
          });
        }
        keys.push({
          index: keys.length,
          address: address ?? `?lookup:${shortAddress(lookup.lookupTableAddress)}#${tableIndex}`,
          signer: false,
          writable,
          source: "lookup",
          lookupTable: lookup.lookupTableAddress,
          resolved: address !== undefined,
        });
      }
    }
  }
  for (const lookup of lookups) {
    if (!tables[lookup.lookupTableAddress]) {
      warnings.push({
        code: "LOOKUP_TABLE_UNRESOLVED",
        message: `Lookup table ${shortAddress(lookup.lookupTableAddress)} could not be loaded, so some accounts are unknown.`,
      });
    }
  }
  return { keys, warnings };
}

function readBudget(message: CompiledMessage, instructions: DecodedIx[], warnings: DecodeWarning[]): BudgetInfo {
  if (message.version === 1) {
    // v1 keeps the budget in message.config; Compute Budget instructions are no-ops.
    try {
      const config = decompileTransactionMessage(message).config ?? {};
      const budget: BudgetInfo = { source: Object.keys(config).length > 0 ? "config" : "none" };
      if (config.computeUnitLimit !== undefined) budget.computeUnitLimit = config.computeUnitLimit;
      if (config.priorityFeeLamports !== undefined) budget.priorityFeeLamports = config.priorityFeeLamports.toString();
      if (config.loadedAccountsDataSizeLimit !== undefined) {
        budget.loadedAccountsDataSizeLimit = config.loadedAccountsDataSizeLimit;
      }
      if (config.heapSize !== undefined) budget.heapSize = config.heapSize;
      return budget;
    } catch {
      warnings.push({
        code: "V1_CONFIG_UNREADABLE",
        message: "The fee and compute settings of this v1 transaction could not be read.",
      });
      return { source: "none" };
    }
  }

  const budget: BudgetInfo = { source: "none" };
  for (const ix of instructions) {
    if (lookupProgram(ix.programId)?.key !== "computeBudget") continue;
    const { units, microLamports, accountDataSizeLimit, bytes } = ix.args;
    if (ix.action === "setComputeUnitLimit" && typeof units === "number") budget.computeUnitLimit = units;
    if (ix.action === "setComputeUnitPrice" && typeof microLamports === "string") {
      budget.computeUnitPriceMicroLamports = microLamports;
    }
    if (ix.action === "setLoadedAccountsDataSizeLimit" && typeof accountDataSizeLimit === "number") {
      budget.loadedAccountsDataSizeLimit = accountDataSizeLimit;
    }
    if (ix.action === "requestHeapFrame" && typeof bytes === "number") budget.heapSize = bytes;
  }
  if (Object.keys(budget).length > 1) budget.source = "instructions";
  return budget;
}

/** Turns a parsed wire transaction (plus any loaded lookup tables) into a DecodedTx. */
export function decodeWireTransaction(
  wire: WireTransaction,
  tables: AddressesByLookupTableAddress = {},
): DecodedTx {
  const { message } = wire;
  const { keys, warnings } = resolveAccountKeys(message, tables);

  const instructions = compiledInstructions(message).map((ix, i) => {
    const raw: RawInstruction = {
      programAddress: keys[ix.programIndex].address,
      accounts: ix.accountIndices.map((k) => ({
        address: keys[k].address,
        signer: keys[k].signer,
        writable: keys[k].writable,
      })),
      data: ix.data,
    };
    return parseInstruction(raw, String(i), false);
  });

  for (const ix of instructions) {
    if (ix.known && ix.parseError) {
      warnings.push({
        code: "INSTRUCTION_PARSE_FAILED",
        message: `Instruction ${ix.path} (${ix.programName}) could not be decoded: ${ix.parseError}`,
      });
    }
  }

  if (message.version !== 1 && wire.sizeBytes > LIMITS.maxLegacyTransactionBytes) {
    warnings.push({
      code: "OVERSIZED_FOR_VERSION",
      message: `This ${message.version === "legacy" ? "legacy" : "v0"} transaction is ${wire.sizeBytes} bytes; the limit is ${LIMITS.maxLegacyTransactionBytes}, so the network would reject it.`,
    });
  }

  const first = instructions[0];
  const usesDurableNonce =
    first !== undefined &&
    lookupProgram(first.programId)?.key === "system" &&
    first.action === "advanceNonceAccount";

  const budget = readBudget(message, instructions, warnings);
  const version: TxVersion = message.version === "legacy" ? "legacy" : message.version === 0 ? "0" : "1";

  return {
    version,
    sizeBytes: wire.sizeBytes,
    feePayer: keys[0].address,
    signers: keys.filter((k) => k.signer).map((k) => k.address),
    writable: keys.filter((k) => k.writable && k.resolved).map((k) => k.address),
    signatures: wire.signatures,
    accountKeys: keys,
    lifetimeToken: message.lifetimeToken,
    usesDurableNonce,
    lookupTables: lookupsOf(message).map((l) => ({
      address: l.lookupTableAddress,
      resolved: tables[l.lookupTableAddress] !== undefined,
    })),
    budget,
    instructions,
    warnings,
  };
}

export interface DecodeOptions {
  /** Loads lookup-table contents (M2 wires this to the RPC). Errors are tolerated. */
  fetchLookupTables?: (addresses: string[]) => Promise<AddressesByLookupTableAddress>;
}

/** Full decode of pasted base64. Throws DecodeError for unusable input. */
export async function decodeTransaction(input: string, options: DecodeOptions = {}): Promise<DecodedTx> {
  const wire = parseWireTransaction(input);
  const tableAddresses = getLookupTableAddresses(wire);
  let tables: AddressesByLookupTableAddress = {};
  if (tableAddresses.length > 0 && options.fetchLookupTables) {
    try {
      tables = await options.fetchLookupTables(tableAddresses);
    } catch {
      tables = {}; // Each unresolved table becomes a LOOKUP_TABLE_UNRESOLVED warning.
    }
  }
  return decodeWireTransaction(wire, tables);
}
