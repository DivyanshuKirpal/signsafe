/**
 * Shared types for the analysis pipeline (ARCHITECTURE section 8, adapted to
 * the code). Everything here is JSON-safe: BigInt values travel as strings.
 */

export type TxVersion = "legacy" | "0" | "1";

/** A value decoded from instruction data. BigInt values are decimal strings. */
export type ArgValue = string | number | boolean | null;

/** One entry of the transaction's full account list, in message order. */
export interface AccountKey {
  index: number;
  /**
   * The account address. When a lookup table could not be resolved this is a
   * placeholder starting with "?" (never a valid address, so it can never be
   * mistaken for a real account).
   */
  address: string;
  signer: boolean;
  writable: boolean;
  source: "static" | "lookup";
  /** For accounts loaded from an address lookup table. */
  lookupTable?: string;
  resolved: boolean;
}

export interface DecodedIx {
  /** "0", "1", ... for top-level instructions; "1.0" for inner ones (M2). */
  path: string;
  programId: string;
  /** From the registry, else "Unknown program". */
  programName: string;
  known: boolean;
  /** e.g. "transferSol", "approve", "setAuthority", or "unknown". */
  action: string;
  /** Named accounts, e.g. { source, delegate, owner }. */
  accounts: Record<string, string>;
  args: Record<string, ArgValue>;
  inner: boolean;
  /** One plain-English sentence written by our code (not by the AI). */
  summary: string;
  accountCount: number;
  dataLength: number;
  parseError?: string;
}

export type DecodeWarningCode =
  | "LOOKUP_TABLE_UNRESOLVED"
  | "INSTRUCTION_PARSE_FAILED"
  | "V1_CONFIG_UNREADABLE"
  | "OVERSIZED_FOR_VERSION";

/**
 * Something that limits what we could see. Warnings with these codes make the
 * R-UNRESOLVED rule fire (M3), so purely informational notes do not go here.
 */
export interface DecodeWarning {
  code: DecodeWarningCode;
  message: string;
}

/** Compute budget requested by the transaction. */
export interface BudgetInfo {
  /** "instructions" for legacy/v0 (Compute Budget program), "config" for v1. */
  source: "none" | "instructions" | "config";
  computeUnitLimit?: number;
  /** legacy/v0: price per compute unit, in micro-lamports. */
  computeUnitPriceMicroLamports?: string;
  /** v1: total priority fee in lamports. */
  priorityFeeLamports?: string;
  loadedAccountsDataSizeLimit?: number;
  heapSize?: number;
}

export interface DecodedTx {
  version: TxVersion;
  sizeBytes: number;
  feePayer: string;
  /** Required signers, fee payer first. Lookup-table addresses are never signers. */
  signers: string[];
  /** Resolved writable accounts. */
  writable: string[];
  /** Whether each required signature is already present (all zeros = unsigned). */
  signatures: { address: string; present: boolean }[];
  accountKeys: AccountKey[];
  /** Recent blockhash, or the nonce value when a durable nonce is used. */
  lifetimeToken: string;
  usesDurableNonce: boolean;
  lookupTables: { address: string; resolved: boolean }[];
  budget: BudgetInfo;
  /** Top-level instructions only; inner ones come from simulation (M2). */
  instructions: DecodedIx[];
  warnings: DecodeWarning[];
}

export type DecodeErrorCode =
  | "EMPTY_INPUT"
  | "TOO_LONG"
  | "INVALID_BASE64"
  | "LOOKS_LIKE_SIGNATURE"
  | "TOO_LARGE"
  | "NOT_A_TRANSACTION"
  | "UNSUPPORTED_VERSION";

export interface ApiError {
  error: { code: string; message: string };
}

/** M1 subset of AnalyzeResponse; simulation, verdict and explanation follow in M2-M5. */
export interface AnalyzeResponse {
  requestId: string;
  cluster: "devnet";
  decoded: DecodedTx;
  timingsMs: Record<string, number>;
}
