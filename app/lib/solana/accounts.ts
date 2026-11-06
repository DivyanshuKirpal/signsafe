/**
 * Normalises accounts returned by the RPC (getMultipleAccounts and
 * simulateTransaction, both with jsonParsed encoding) into small snapshots the
 * state diff can compare. RPC data is validated, not trusted.
 */
import { z } from "zod";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

export interface TokenAccountState {
  program: "token" | "token2022";
  mint: string;
  /** The wallet that controls this token account. */
  owner: string;
  amount: bigint;
  decimals: number;
  delegate: string | null;
  delegatedAmount: bigint;
  closeAuthority: string | null;
  state: string;
}

export interface MintState {
  program: "token" | "token2022";
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface AccountSnapshot {
  lamports: bigint;
  /** The program that owns the account (System Program for normal wallets). */
  owner: string;
  executable: boolean;
  space: bigint;
  token?: TokenAccountState;
  mint?: MintState;
}

/** Kit returns u64 values as bigint; fixtures or other paths may give numbers or strings. */
const bigintLike = z.union([z.bigint(), z.number().int(), z.string().regex(/^\d+$/)]).transform((v) => BigInt(v));
const smallInt = z.union([z.number().int(), z.bigint()]).transform((v) => Number(v));

const BaseAccount = z.object({
  lamports: bigintLike,
  owner: z.string(),
  executable: z.boolean(),
  space: bigintLike.optional(),
  data: z.unknown(),
});

const TokenAmount = z.object({ amount: z.string().regex(/^\d+$/), decimals: smallInt });

const TokenAccountInfo = z.object({
  mint: z.string(),
  owner: z.string(),
  state: z.string(),
  tokenAmount: TokenAmount,
  delegate: z.string().optional(),
  delegatedAmount: TokenAmount.optional(),
  closeAuthority: z.string().optional(),
});

const MintInfo = z.object({
  decimals: smallInt,
  supply: z.string().regex(/^\d+$/),
  mintAuthority: z.string().nullable().optional(),
  freezeAuthority: z.string().nullable().optional(),
});

const ParsedData = z.object({
  program: z.string(),
  parsed: z.object({ type: z.string(), info: z.unknown() }),
});

function tokenProgramOf(owner: string): "token" | "token2022" | undefined {
  if (owner === TOKEN_PROGRAM_ADDRESS) return "token";
  if (owner === TOKEN_2022_PROGRAM_ADDRESS) return "token2022";
  return undefined;
}

/**
 * Returns null when the account does not exist. An account left with 0
 * lamports is removed by the runtime at the end of the transaction, so it is
 * treated as not existing too.
 */
export function toSnapshot(account: unknown): AccountSnapshot | null {
  if (account === null || account === undefined) return null;
  const base = BaseAccount.safeParse(account);
  if (!base.success) return null;
  const { lamports, owner, executable, space, data } = base.data;
  if (lamports === 0n) return null;

  const snapshot: AccountSnapshot = { lamports, owner, executable, space: space ?? 0n };
  const program = tokenProgramOf(owner);
  const parsed = ParsedData.safeParse(data);
  if (!program || !parsed.success) return snapshot;

  if (parsed.data.parsed.type === "account") {
    const info = TokenAccountInfo.safeParse(parsed.data.parsed.info);
    if (info.success) {
      const i = info.data;
      snapshot.token = {
        program,
        mint: i.mint,
        owner: i.owner,
        amount: BigInt(i.tokenAmount.amount),
        decimals: i.tokenAmount.decimals,
        delegate: i.delegate ?? null,
        delegatedAmount: i.delegatedAmount ? BigInt(i.delegatedAmount.amount) : 0n,
        closeAuthority: i.closeAuthority ?? null,
        state: i.state,
      };
    }
  } else if (parsed.data.parsed.type === "mint") {
    const info = MintInfo.safeParse(parsed.data.parsed.info);
    if (info.success) {
      snapshot.mint = {
        program,
        decimals: info.data.decimals,
        supply: BigInt(info.data.supply),
        mintAuthority: info.data.mintAuthority ?? null,
        freezeAuthority: info.data.freezeAuthority ?? null,
      };
    }
  }
  return snapshot;
}
