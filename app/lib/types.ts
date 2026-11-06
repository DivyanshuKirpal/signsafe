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

/**
 * An account's state before the transaction, as fetched for the comparison.
 * Rules use it for permission checks (the token account's real owner and
 * balance), never the user's address. Amounts are raw integers as strings.
 */
export interface AccountState {
  address: string;
  exists: boolean;
  lamports?: string;
  /** Owning program. */
  owner?: string;
  token?: {
    program: "token" | "token2022";
    mint: string;
    /** The wallet that controls the token account. */
    owner: string;
    amount: string;
    decimals: number;
    delegate: string | null;
    delegatedAmount: string;
    closeAuthority: string | null;
  };
  mint?: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null };
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
  /** State before the transaction of every account fetched (empty if the RPC was not reached). */
  preState: AccountState[];
  slots?: { preState?: string; simulation?: string };
  /** Which configured endpoint answered. URLs are never exposed. */
  rpcEndpoint?: "primary" | "fallback";
}

export type VerdictLevel = "LOW_RISK" | "CAUTION" | "DANGER" | "UNKNOWN";
export type Severity = "info" | "caution" | "danger";

export type RuleId =
  | "R-APPROVE"
  | "R-DELEGATE-STATE"
  | "R-SET-AUTHORITY"
  | "R-ASSIGN"
  | "R-OUTFLOW"
  | "R-CLOSE-ACCOUNT"
  | "R-UNKNOWN-PROGRAM"
  | "R-DURABLE-NONCE"
  | "R-HIGH-FEE"
  | "R-SIM-FAILED"
  | "R-UNRESOLVED"
  | "R-MEMO";

/** What a flag is based on: an instruction, an account change, or a gap in the check. */
export type FlagSource =
  | { type: "instruction"; path: string; inner: boolean; summary: string }
  | { type: "stateChange"; address: string; changeKind: StateChangeKind; description: string }
  | { type: "decodeWarning"; code: DecodeWarningCode; message: string }
  | { type: "simulation"; code: SimulationErrorCode | "OK"; message: string }
  /** A transaction-level setting that is not an instruction (for example the v1 fee config). */
  | { type: "transaction"; description: string };

export interface RiskFlag {
  /** The main rule. When evidence from several rules was merged, the others are in relatedRuleIds. */
  ruleId: RuleId;
  relatedRuleIds?: RuleId[];
  severity: Severity;
  /** Written by our code, not by the AI. */
  title: string;
  detail: string;
  /** The account the problem is about, when there is one. */
  account?: string;
  /** Short facts (addresses, amounts) behind the flag. */
  evidence: Record<string, string>;
  /** The instructions and account changes that triggered it. */
  sources: FlagSource[];
}

export interface Verdict {
  level: VerdictLevel;
  /** Fixed UI label for the level. Never says "safe". */
  label: string;
  /** One line written by our code. */
  reason: string;
  /** False when part of the transaction could not be checked (simulation or decoding gaps). */
  complete: boolean;
  flags: RiskFlag[];
}

export interface ApiError {
  error: { code: string; message: string };
}

/** The explanation (M5) is added later. */
export interface AnalyzeResponse {
  requestId: string;
  cluster: "devnet";
  decoded: DecodedTx;
  simulation: SimulationResult;
  verdict: Verdict;
  /** The optional "your address" echoed back; it only personalises wording, never the verdict. */
  userAddress?: string;
  timingsMs: Record<string, number>;
}
