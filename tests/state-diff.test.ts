import { describe, expect, test } from "vitest";
import { U64_MAX } from "../app/lib/config";
import type { AccountSnapshot, TokenAccountState } from "../app/lib/solana/accounts";
import { describeChange } from "../app/lib/solana/describe-change";
import { diffAccount, diffStates } from "../app/lib/solana/state-diff";

// Synthetic snapshots (not from the network).
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SENDER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const RECIPIENT = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const ATTACKER = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const TOKEN_ACCOUNT = "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9";
const MINT = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

const wallet = (lamports: bigint, owner = SYSTEM): AccountSnapshot => ({ lamports, owner, executable: false, space: 0n });
const tokenAccount = (token: Partial<TokenAccountState>): AccountSnapshot => ({
  lamports: 2_039_280n,
  owner: TOKEN,
  executable: false,
  space: 165n,
  token: {
    program: "token",
    mint: MINT,
    owner: SENDER,
    amount: 1_000_000_000n,
    decimals: 6,
    delegate: null,
    delegatedAmount: 0n,
    closeAuthority: null,
    state: "initialized",
    ...token,
  },
});

describe("diffStates", () => {
  test("SOL transfer: sender and recipient deltas, fee identified on the fee payer", () => {
    const pre = new Map([
      [SENDER, wallet(1_000_000_000n)],
      [RECIPIENT, null],
    ]);
    const post = new Map([
      [SENDER, wallet(989_995_000n)],
      [RECIPIENT, wallet(10_000_000n)],
    ]);
    const changes = diffStates([SENDER, RECIPIENT], pre, post, { feePayer: SENDER, feeLamports: 5_000n });
    expect(changes).toEqual([
      {
        address: SENDER,
        kind: "sol",
        before: "1000000000",
        after: "989995000",
        delta: "-10005000",
        includesFeeLamports: "5000",
      },
      { address: RECIPIENT, kind: "created", before: null, after: SYSTEM },
      { address: RECIPIENT, kind: "sol", before: "0", after: "10000000", delta: "10000000" },
    ]);
    const text = describeChange(changes[0]);
    expect(text).toMatchObject({ label: "SOL balance", before: "1 SOL", after: "0.989995 SOL", delta: "-0.010005 SOL" });
    expect(text.note).toContain("network fee of 0.000005 SOL");
    expect(describeChange(changes[2]).delta).toBe("+0.01 SOL");
  });

  test("approval: delegate and allowance change while the token balance stays the same", () => {
    const before = tokenAccount({});
    const after = tokenAccount({ delegate: ATTACKER, delegatedAmount: U64_MAX });
    const changes = diffAccount(TOKEN_ACCOUNT, before, after, { feePayer: SENDER });
    expect(changes).toEqual([
      {
        address: TOKEN_ACCOUNT,
        kind: "delegate",
        before: null,
        after: ATTACKER,
        allowanceBefore: "0",
        allowanceAfter: U64_MAX.toString(),
        mint: MINT,
        decimals: 6,
        tokenAccountOwner: SENDER,
      },
    ]);
    expect(changes.some((c) => c.kind === "token")).toBe(false);
    const text = describeChange(changes[0]);
    expect(text.before).toBe("no one");
    expect(text.after).toBe("HN7c...YWrH may spend UNLIMITED (u64 max)");
  });

  test("allowance raised for the same delegate, and a revoke, are both reported", () => {
    const raised = diffAccount(
      TOKEN_ACCOUNT,
      tokenAccount({ delegate: ATTACKER, delegatedAmount: 5n }),
      tokenAccount({ delegate: ATTACKER, delegatedAmount: 500n }),
      { feePayer: SENDER },
    );
    expect(raised).toMatchObject([{ kind: "delegate", before: ATTACKER, after: ATTACKER, allowanceBefore: "5", allowanceAfter: "500" }]);

    const revoked = diffAccount(
      TOKEN_ACCOUNT,
      tokenAccount({ delegate: ATTACKER, delegatedAmount: 500n }),
      tokenAccount({}),
      { feePayer: SENDER },
    );
    expect(revoked).toMatchObject([{ kind: "delegate", before: ATTACKER, after: null }]);
  });

  test("token transfer, owner change and close-authority change", () => {
    const moved = diffAccount(TOKEN_ACCOUNT, tokenAccount({}), tokenAccount({ amount: 250_000_000n }), { feePayer: SENDER });
    expect(moved).toMatchObject([{ kind: "token", before: "1000000000", after: "250000000", delta: "-750000000" }]);
    expect(describeChange(moved[0])).toMatchObject({ before: "1,000 tokens", after: "250 tokens", delta: "-750 tokens" });

    const takeover = diffAccount(
      TOKEN_ACCOUNT,
      tokenAccount({}),
      tokenAccount({ owner: ATTACKER, closeAuthority: ATTACKER }),
      { feePayer: SENDER },
    );
    expect(takeover.map((c) => [c.kind, c.before, c.after])).toEqual([
      ["tokenOwner", SENDER, ATTACKER],
      ["closeAuthority", null, ATTACKER],
    ]);
  });

  test("System Assign shows as a change of owning program", () => {
    const changes = diffAccount(SENDER, wallet(1_000n), wallet(1_000n, ATTACKER), { feePayer: RECIPIENT });
    expect(changes).toEqual([{ address: SENDER, kind: "programOwner", before: SYSTEM, after: ATTACKER }]);
    expect(describeChange(changes[0])).toMatchObject({ before: "System Program", after: "program HN7c...YWrH" });
  });

  test("a closed account reports closed plus the SOL it lost", () => {
    const changes = diffAccount(TOKEN_ACCOUNT, tokenAccount({ amount: 0n }), null, { feePayer: SENDER });
    expect(changes.map((c) => c.kind)).toEqual(["closed", "sol"]);
    expect(changes[1]).toMatchObject({ before: "2039280", after: "0", delta: "-2039280" });
  });

  test("unchanged and never-existing accounts produce no changes; fee label only on the fee payer", () => {
    expect(diffAccount(SENDER, wallet(5n), wallet(5n), { feePayer: SENDER })).toEqual([]);
    expect(diffAccount(SENDER, null, null, { feePayer: SENDER })).toEqual([]);
    const other = diffAccount(RECIPIENT, wallet(5n), wallet(6n), { feePayer: SENDER, feeLamports: 5_000n });
    expect(other[0].includesFeeLamports).toBeUndefined();
  });
});
