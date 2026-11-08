/**
 * Limits and thresholds. Rules and tests read these values from here
 * (ARCHITECTURE section 7: thresholds live in code, not in environment variables).
 */

/** The largest value a u64 can hold. An SPL Token approval for this amount is "unlimited". */
export const U64_MAX = 18_446_744_073_709_551_615n;

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Risk thresholds (ARCHITECTURE section 9.4). Rules and tests read them from
 * here; tune them here, never inside the rules. Percentages are compared with
 * integer math: part * 100 >= pct * whole.
 */
export const RISK = {
  /** An approval of at least this % of the token balance is DANGER (below: CAUTION). */
  approveDangerPct: 50n,
  /** A signer losing at least this % of a balance is DANGER. */
  outflowDangerPct: 90n,
  /** A signer losing at least this % of a balance is CAUTION. */
  outflowCautionPct: 50n,
  /** SOL balances below this are ignored by R-OUTFLOW (0.001 SOL). */
  outflowDustLamports: 1_000_000n,
  /** A priority fee above this is CAUTION (0.01 SOL). */
  feeCautionLamports: 10_000_000n,
  /** Compute-unit limit assumed per instruction when none is set (legacy/v0). */
  defaultComputeUnitsPerInstruction: 200_000n,
  maxComputeUnits: 1_400_000n,
} as const;

export const LIMITS = {
  /** Max pasted input. A 4,096-byte transaction is about 5,500 base64 characters. */
  maxInputChars: 12_000,
  /** Max raw request body accepted by /api/analyze, before JSON parsing. */
  maxRequestBodyChars: 20_000,
  /** v1 transactions can be up to 4,096 bytes; nothing valid is larger. */
  maxTransactionBytes: 4_096,
  /** Legacy and v0 transactions must fit in 1,232 bytes to land on chain; larger ones are refused before any RPC call. */
  maxLegacyTransactionBytes: 1_232,
  /** Solana (and Kit) allow at most 64 instructions per transaction; more are refused before any RPC call. */
  maxInstructions: 64,
  /**
   * Distinct lookup tables loaded per transaction (one RPC call for all of them).
   * Real transactions use 1-4; the others are reported as not loaded, so the
   * check is "Could not fully check" rather than an RPC call per table.
   */
  maxLookupTables: 8,
  /** Memo text is untrusted; keep only this many characters. */
  maxMemoChars: 300,
  /** Any other untrusted or decoded text value shown in the UI. */
  maxArgChars: 200,
  /** Accounts compared before/after simulation (ARCHITECTURE 9.3 starts at 40). */
  maxWatchedAccounts: 40,
  /** getMultipleAccounts accepts at most 100 addresses per call. */
  accountsPerRequest: 100,
  /** Simulation logs are untrusted program output: keep the first lines only, capped. */
  maxLogLines: 50,
  maxLogLineChars: 200,
} as const;

/** AI explanation, caching and rate limits (ARCHITECTURE 9.6-9.7). */
export const AI = {
  /** The whole /api/analyze request must finish within this, AI attempts included. */
  routeDeadlineMs: 35_000,
  /** One Gemini HTTP attempt, further capped by the time left before the route deadline. */
  attemptTimeoutMs: 20_000,
  /** Do not start an attempt with less time than this left. */
  minAttemptMs: 2_000,
  /** Wait before retrying a 429/503/timeout: between these (ARCHITECTURE: 1-2 s). */
  retryDelayMinMs: 1_000,
  retryDelayMaxMs: 2_000,
  temperature: 0.2,
  /**
   * ARCHITECTURE suggests about 400; thinking tokens count toward this limit,
   * so a little headroom avoids cut-off JSON. Thinking is set to the lowest level.
   */
  maxOutputTokens: 1_024,
  /** Lowest thinking levels to try, in order; a 400 naming the level steps down, then the field is dropped. */
  thinkingLevels: ["MINIMAL", "LOW"] as const,
  /** Untrusted text sent to the model (memos, program logs) is capped. */
  maxUntrustedMemos: 3,
  maxUntrustedMemoChars: 200,
  maxUntrustedLogLines: 6,
  maxUntrustedLogChars: 120,
  /** Size limits for the facts sent to the model; what is left out is counted ("and N more"). */
  maxFactInstructions: 20,
  maxBasedOnLines: 5,
  maxCouldNotCheck: 10,
  /** A larger prompt is not sent at all: the built-in explanation is used instead. */
  maxPromptChars: 16_000,
  /**
   * Gemini requests (every HTTP attempt) one server instance may make per
   * window. Matches the free tier's daily allowance; beyond it the built-in
   * explanation is shown until the oldest request leaves the window.
   */
  budgetMaxRequests: 20,
  budgetWindowMs: 24 * 60 * 60_000,
  /** Validation limits for an AI answer. */
  maxSummarySentences: 2,
  maxPoints: 5,
  maxPointWords: 25,
  maxAdviceSentences: 1,
} as const;

export const CACHE = {
  /** Analysis results, in memory (ARCHITECTURE 9.7: 10 minutes). */
  ttlMs: 10 * 60_000,
  maxEntries: 200,
  /**
   * Accepted AI explanations, keyed by a hash of the exact facts, so reuse is
   * always for identical findings. Kept longer than analyses because the free
   * Gemini tier allows only 20 requests per day per model (seen live 7 Nov 2026).
   */
  explanationTtlMs: 6 * 60 * 60_000,
} as const;

export const RATE_LIMIT = {
  /** Fresh analyses per client IP per window (cached results are not counted). */
  maxRequests: 10,
  windowMs: 60_000,
  /** Bound on the number of IPs tracked at once. */
  maxTrackedClients: 5_000,
} as const;

/** Demo transaction builds (POST /api/scenarios): each one spends devnet RPC requests. */
export const SCENARIO_RATE_LIMIT = {
  maxRequests: 20,
  windowMs: 60_000,
  maxTrackedClients: 5_000,
} as const;
