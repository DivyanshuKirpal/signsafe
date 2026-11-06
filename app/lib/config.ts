/**
 * Limits and thresholds. Rules and tests read these values from here
 * (ARCHITECTURE section 7: thresholds live in code, not in environment variables).
 */

/** The largest value a u64 can hold. An SPL Token approval for this amount is "unlimited". */
export const U64_MAX = 18_446_744_073_709_551_615n;

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export const LIMITS = {
  /** Max pasted input. A 4,096-byte transaction is about 5,500 base64 characters. */
  maxInputChars: 12_000,
  /** Max raw request body accepted by /api/analyze, before JSON parsing. */
  maxRequestBodyChars: 20_000,
  /** v1 transactions can be up to 4,096 bytes; nothing valid is larger. */
  maxTransactionBytes: 4_096,
  /** Legacy and v0 transactions must fit in 1,232 bytes to land on chain. */
  maxLegacyTransactionBytes: 1_232,
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
