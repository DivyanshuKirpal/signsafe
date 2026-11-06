/**
 * Known-program registry (ARCHITECTURE section 9.2). Every program not listed
 * here is reported as "Unknown program".
 *
 * Addresses come from the installed program clients where they export one, so
 * they cannot drift from the libraries; tests cross-check them against
 * ARCHITECTURE section 17.
 */
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import {
  LEGACY_MEMO_PROGRAM_ADDRESS_V1,
  LEGACY_MEMO_PROGRAM_ADDRESS_V3,
  MEMO_PROGRAM_ADDRESS,
} from "@solana-program/memo";

/** Address Lookup Table program. No client package is installed for it. */
export const ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS =
  "AddressLookupTab1e1111111111111111111111111";

export type ProgramKey =
  | "system"
  | "token"
  | "token2022"
  | "associatedToken"
  | "computeBudget"
  | "memo"
  | "memoV2"
  | "memoV1"
  | "addressLookupTable";

export interface KnownProgram {
  key: ProgramKey;
  address: string;
  name: string;
}

const PROGRAM_LIST: KnownProgram[] = [
  { key: "system", address: SYSTEM_PROGRAM_ADDRESS, name: "System Program" },
  { key: "token", address: TOKEN_PROGRAM_ADDRESS, name: "SPL Token" },
  { key: "token2022", address: TOKEN_2022_PROGRAM_ADDRESS, name: "Token-2022" },
  {
    key: "associatedToken",
    address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    name: "Associated Token Account",
  },
  {
    key: "computeBudget",
    address: COMPUTE_BUDGET_PROGRAM_ADDRESS,
    name: "Compute Budget",
  },
  // Three memo program deployments exist. Memo4c2p... is the newest; MemoSq4...
  // (ARCHITECTURE calls it v2, the client calls it V3) is the one most wallets
  // still use; Memo1Uh... is the original.
  { key: "memo", address: MEMO_PROGRAM_ADDRESS, name: "Memo" },
  { key: "memoV2", address: LEGACY_MEMO_PROGRAM_ADDRESS_V3, name: "Memo" },
  { key: "memoV1", address: LEGACY_MEMO_PROGRAM_ADDRESS_V1, name: "Memo (v1)" },
  {
    key: "addressLookupTable",
    address: ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
    name: "Address Lookup Table",
  },
];

const BY_ADDRESS = new Map(PROGRAM_LIST.map((p) => [p.address, p]));

export const KNOWN_PROGRAMS: readonly KnownProgram[] = PROGRAM_LIST;

export const UNKNOWN_PROGRAM_NAME = "Unknown program";

export function lookupProgram(address: string): KnownProgram | undefined {
  return BY_ADDRESS.get(address);
}

/** Token programs share the same token-account layout and base instructions. */
export function isTokenProgram(address: string): boolean {
  return address === TOKEN_PROGRAM_ADDRESS || address === TOKEN_2022_PROGRAM_ADDRESS;
}
