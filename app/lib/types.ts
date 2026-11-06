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
  /**
   * Who decoded it: our program clients ("client"), or the RPC node's own
   * parser ("rpc"; simulation returns known inner instructions pre-parsed).
   */
  decodedBy?: "client" | "rpc";
  /** Mint and decimals looked up from the token account's state (M2). */
  token?: { mint: string; decimals: number };
}

export type DecodeWarningCode =
  | "LOOKUP_TABLE_UNRESOLVED"
  | "INSTRUCTION_PARSE_FAILED"
  | "V1_CONFIG_UNREADABLE"
  | "OVERSIZED_FOR_VERSION"
  | "WATCH_LIST_TRUNCATED";

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

export type StateChangeKind =
  | "sol"
  | "token"
  | "delegate"
  | "tokenOwner"
  | "closeAuthority"
  | "programOwner"
  | "closed"
  | "created";

/**
 * One difference between an account's state before and after simulation.
 * Amounts are raw integers as decimal strings.
 */
export interface StateChange {
  address: string;
  kind: StateChangeKind;
  /**
   * sol: lamports. token: raw amount. delegate: delegate address (null = none).
   * tokenOwner/closeAuthority: address. programOwner/created/closed: owning program.
   */
  before: string | null;
  after: string | null;
  /** sol and token: after - before (negative = decrease). */
  delta?: string;
  mint?: string;
  decimals?: number;
  /** delegate: the allowance (delegatedAmount), raw. */
  allowanceBefore?: string;
  allowanceAfter?: string;
  /** For token-account changes: the wallet that owns the token account (before). */
  tokenAccountOwner?: string;
  /** sol change of the fee payer: the network fee included in the delta, lamports. */
  includesFeeLamports?: string;
}

export type WatchRole = "feePayer" | "signer" | "writable" | "mint";

export interface WatchedAccount {
  address: string;
  roles: WatchRole[];
  existedBefore: boolean;
  existsAfter: boolean | null;
}

export type SimulationErrorCode =
  | "RPC_NOT_CONFIGURED"
  | "RPC_NOT_DEVNET"
  | "RPC_UNAVAILABLE"
  | "FEE_PAYER_UNFUNDED"
  | "ACCOUNT_NOT_FOUND"
  | "PROGRAM_NOT_FOUND"
  | "LOOKUP_TABLE_INVALID"
  | "INSTRUCTION_FAILED"
  | "COMPUTE_BUDGET_EXCEEDED"
  | "INSUFFICIENT_FUNDS_FOR_RENT"
  | "SIMULATION_FAILED";

export interface SimulationError {
  code: SimulationErrorCode;
  /** Plain English, safe to show. */
  userMessage: string;
  /** The raw error as returned by the RPC (JSON text, capped), for Raw details. */
  raw?: string;
  instructionIndex?: number;
  programId?: string;
}

export interface SimulationResult {
  /** False when the simulation could not be attempted (no RPC, RPC down, not devnet). */
  ran: boolean;
  /** True when it ran and the transaction would succeed. */
  ok: boolean;
  error?: SimulationError;
  /** Network fee reported by the RPC for this transaction, lamports. */
  feeLamports?: string;
  unitsConsumed?: number;
  /** First 50 log lines, each capped. Untrusted program output. */
  logs: string[];
  logsTruncated: boolean;
  innerInstructions: DecodedIx[];
  changes: StateChange[];
  watched: WatchedAccount[];
  /** Accounts the transaction writes to that were left out of the comparison (cap). */
  notWatched: string[];
  slots?: { preState?: string; simulation?: string };
  /** Which configured endpoint answered. URLs are never exposed. */
  rpcEndpoint?: "primary" | "fallback";
}

export interface ApiError {
  error: { code: string; message: string };
}

/** Verdict (M3) and explanation (M5) are added later. */
export interface AnalyzeResponse {
  requestId: string;
  cluster: "devnet";
  decoded: DecodedTx;
  simulation: SimulationResult;
  timingsMs: Record<string, number>;
}
