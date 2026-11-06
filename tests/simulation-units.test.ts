import { getBase58Decoder, type RpcTransport } from "@solana/kit";
import { describe, expect, test } from "vitest";
import { U64_MAX } from "../app/lib/config";
import { toSnapshot } from "../app/lib/solana/accounts";
import { decodeWireTransaction, parseWireTransaction } from "../app/lib/solana/decode";
import { decodeInnerInstructions } from "../app/lib/solana/inner";
import { createFailoverTransport, redactSecrets, rpcFromEnv } from "../app/lib/solana/rpc";
import { mapRpcRefusal, mapSimulationError } from "../app/lib/solana/sim-errors";
import { baseCandidates, mintCandidates, selectWatched } from "../app/lib/solana/watch-list";
import { ATTACKER, buildTxBase64, FRIEND, solPaymentIx, unlimitedApproveIx, VICTIM, VICTIM_TOKEN_ACCOUNT } from "./helpers/build-tx";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// Shapes copied from live devnet responses (Kit already turned u64 values into bigint).
const jsonParsedTokenAccount = {
  lamports: 2_039_280n,
  owner: TOKEN,
  executable: false,
  space: 165n,
  data: {
    program: "spl-token",
    space: 165n,
    parsed: {
      type: "account",
      info: {
        mint: MINT,
        owner: VICTIM,
        state: "initialized",
        isNative: false,
        tokenAmount: { amount: "9887077962885340000", decimals: 6, uiAmount: 1, uiAmountString: "1" },
        delegate: ATTACKER,
        delegatedAmount: { amount: U64_MAX.toString(), decimals: 6, uiAmount: 1, uiAmountString: "1" },
      },
    },
  },
};

describe("toSnapshot (RPC account -> snapshot)", () => {
  test("token account with delegate and allowance", () => {
    expect(toSnapshot(jsonParsedTokenAccount)?.token).toEqual({
      program: "token",
      mint: MINT,
      owner: VICTIM,
      amount: 9_887_077_962_885_340_000n,
      decimals: 6,
      delegate: ATTACKER,
      delegatedAmount: U64_MAX,
      closeAuthority: null,
      state: "initialized",
    });
  });

  test("mint, plain wallet, missing, zero-lamport and malformed accounts", () => {
    const mint = toSnapshot({
      lamports: 1n,
      owner: TOKEN,
      executable: false,
      space: 82n,
      data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6, supply: "100", mintAuthority: VICTIM, freezeAuthority: null } } },
    });
    expect(mint?.mint).toEqual({ program: "token", decimals: 6, supply: 100n, mintAuthority: VICTIM, freezeAuthority: null });

    const plain = toSnapshot({ lamports: 5n, owner: "11111111111111111111111111111111", executable: false, space: 0n, data: ["", "base64"] });
    expect(plain).toEqual({ lamports: 5n, owner: "11111111111111111111111111111111", executable: false, space: 0n });

    expect(toSnapshot(null)).toBeNull();
    expect(toSnapshot({ ...plain, lamports: 0n, data: ["", "base64"] })).toBeNull();
    expect(toSnapshot({ nonsense: true })).toBeNull();
    // Parsed data that claims to be a token account but is owned by another program is ignored.
    expect(toSnapshot({ ...jsonParsedTokenAccount, owner: ATTACKER })?.token).toBeUndefined();
  });
});

describe("watch list", () => {
  test("fee payer, signers, writable accounts and token mints, with roles", () => {
    const decoded = decodeWireTransaction(parseWireTransaction(buildTxBase64([solPaymentIx(), unlimitedApproveIx()])));
    const candidates = baseCandidates(decoded);
    // Fee payer first; Kit orders the other accounts within each role group.
    expect(candidates[0]).toEqual({ address: VICTIM, roles: ["feePayer", "signer", "writable"] });
    expect(candidates).toHaveLength(3);
    expect(candidates).toEqual(expect.arrayContaining([
      { address: FRIEND, roles: ["writable"] },
      { address: VICTIM_TOKEN_ACCOUNT, roles: ["writable"] },
    ]));
    const pre = new Map([[VICTIM_TOKEN_ACCOUNT, toSnapshot({ ...jsonParsedTokenAccount })]]);
    expect(mintCandidates(candidates, pre)).toEqual([MINT]);
  });

  test("cap keeps signers, then signer-owned token accounts, then other writable, then mints", () => {
    const pre = new Map([["tok", toSnapshot(jsonParsedTokenAccount)]]);
    const candidates = [
      { address: "w1", roles: ["writable" as const] },
      { address: "mint", roles: ["mint" as const] },
      { address: "tok", roles: ["writable" as const] },
      { address: VICTIM, roles: ["feePayer" as const, "signer" as const] },
    ];
    const { watched, dropped } = selectWatched(candidates, [VICTIM], pre, 2);
    expect(watched.map((w) => w.address)).toEqual([VICTIM, "tok"]);
    expect(dropped.map((w) => w.address)).toEqual(["w1", "mint"]);
  });
});

describe("simulation error mapping", () => {
  const decoded = decodeWireTransaction(parseWireTransaction(buildTxBase64([solPaymentIx(), unlimitedApproveIx()])));

  test.each([
    ["AccountNotFound", "FEE_PAYER_UNFUNDED"],
    ["InsufficientFundsForFee", "FEE_PAYER_UNFUNDED"],
    ["ProgramAccountNotFound", "PROGRAM_NOT_FOUND"],
    ["AddressLookupTableNotFound", "LOOKUP_TABLE_INVALID"],
    [{ InsufficientFundsForRent: { account_index: 1 } }, "INSUFFICIENT_FUNDS_FOR_RENT"],
    ["SomethingNew", "SIMULATION_FAILED"],
  ])("%j -> %s", (err, code) => {
    const mapped = mapSimulationError(err, decoded);
    expect(mapped.code).toBe(code);
    expect(mapped.userMessage.length).toBeGreaterThan(20);
    expect(mapped.raw).toBeTruthy();
  });

  test("instruction errors name the instruction and program (bigint index from Kit)", () => {
    const mapped = mapSimulationError({ InstructionError: [1n, { Custom: 1n }] }, decoded);
    expect(mapped).toMatchObject({ code: "INSTRUCTION_FAILED", instructionIndex: 1, programId: TOKEN });
    expect(mapped.userMessage).toContain("Instruction #1 (SPL Token) failed with program error code 1");
    expect(mapSimulationError({ InstructionError: [0, "ComputationalBudgetExceeded"] }, decoded).code).toBe("COMPUTE_BUDGET_EXCEEDED");
  });

  test("node refusals: lookup table problems are recognised", () => {
    expect(mapRpcRefusal("invalid transaction: Transaction loads an address table account that doesn't exist").code).toBe(
      "LOOKUP_TABLE_INVALID",
    );
    expect(mapRpcRefusal("invalid transaction: something else").code).toBe("SIMULATION_FAILED");
  });
});

describe("inner instructions", () => {
  const keys = decodeWireTransaction(parseWireTransaction(buildTxBase64([unlimitedApproveIx()]))).accountKeys;

  test("node-parsed system and token instructions are mapped onto our names", () => {
    const list = [
      {
        index: 0n,
        instructions: [
          { program: "system", programId: "11111111111111111111111111111111", stackHeight: 2, parsed: { type: "transfer", info: { source: VICTIM, destination: ATTACKER, lamports: 5n } } },
          { program: "system", programId: "11111111111111111111111111111111", stackHeight: 2, parsed: { type: "createAccount", info: { source: VICTIM, newAccount: FRIEND, lamports: 1_488_440n, space: 165n, owner: TOKEN } } },
          { program: "spl-token", programId: TOKEN, stackHeight: 2, parsed: { type: "approve", info: { source: VICTIM_TOKEN_ACCOUNT, delegate: ATTACKER, owner: VICTIM, amount: U64_MAX.toString() } } },
          { program: "spl-token", programId: TOKEN, stackHeight: 2, parsed: { type: "setAuthority", info: { account: VICTIM_TOKEN_ACCOUNT, authority: VICTIM, authorityType: "accountOwner", newAuthority: ATTACKER } } },
          { program: "spl-memo", programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", parsed: "hi‮there" },
        ],
      },
    ];
    const [transfer, create, approve, setAuth, memo] = decodeInnerInstructions(list, keys);
    expect(transfer).toMatchObject({ path: "0.0", action: "transferSol", accounts: { source: VICTIM, destination: ATTACKER }, args: { amount: "5" }, inner: true, decodedBy: "rpc" });
    expect(create).toMatchObject({ action: "createAccount", accounts: { payer: VICTIM, newAccount: FRIEND }, args: { programAddress: TOKEN, lamports: "1488440" } });
    expect(approve).toMatchObject({ path: "0.2", action: "approve", accounts: { source: VICTIM_TOKEN_ACCOUNT, delegate: ATTACKER, owner: VICTIM }, args: { amount: U64_MAX.toString() } });
    expect(approve.summary).toContain("UNLIMITED (u64 max)");
    expect(setAuth).toMatchObject({ accounts: { owned: VICTIM_TOKEN_ACCOUNT, owner: VICTIM }, args: { authorityType: "AccountOwner", newAuthority: ATTACKER } });
    expect(setAuth.summary).toBe("Change the owner of 2wmV...dri9 to HN7c...YWrH.");
    expect(memo).toMatchObject({ action: "memo", args: { text: "hithere", untrusted: true } });
  });

  test("raw shapes (unknown programs) go through our own parser", () => {
    const data = getBase58Decoder().decode(new Uint8Array([9, 9, 9]));
    const [partial, compiled, broken] = decodeInnerInstructions(
      [
        {
          index: 1,
          instructions: [
            { programId: "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS", accounts: [VICTIM], data },
            { programIdIndex: keys.length - 1, accounts: [0], data },
            { programIdIndex: 99, accounts: [0], data },
          ],
        },
      ],
      keys,
    );
    expect(partial).toMatchObject({ path: "1.0", known: false, action: "unknown", accounts: { account1: VICTIM }, dataLength: 3, inner: true });
    expect(compiled).toMatchObject({ path: "1.1", programId: keys[keys.length - 1].address, inner: true });
    expect(broken).toMatchObject({ path: "1.2", action: "unknown", parseError: "account index out of range" });
  });
});

describe("RPC transport", () => {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });
  const config = { payload: { jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] } };

  function endpoint(label: "primary" | "fallback", impl: () => Promise<unknown>) {
    return { label, transport: (async () => impl()) as unknown as RpcTransport };
  }

  test("network failure on the primary falls back once", async () => {
    let answered: string | undefined;
    const transport = createFailoverTransport(
      [endpoint("primary", () => Promise.reject(new TypeError("fetch failed"))), endpoint("fallback", () => Promise.resolve(ok("x")))],
      (label) => (answered = label),
    );
    await expect(transport(config)).resolves.toEqual(ok("x"));
    expect(answered).toBe("fallback");
  });

  test("a rate-limit reply is retried on the next endpoint", async () => {
    const transport = createFailoverTransport(
      [
        endpoint("primary", () => Promise.resolve({ jsonrpc: "2.0", id: 1, error: { code: 429, message: "slow down" } })),
        endpoint("fallback", () => Promise.resolve(ok("y"))),
      ],
      () => {},
    );
    await expect(transport(config)).resolves.toEqual(ok("y"));
  });

  test("non-transient errors are not retried", async () => {
    let calls = 0;
    const transport = createFailoverTransport(
      [
        endpoint("primary", () => {
          calls++;
          return Promise.reject(new Error("bad request"));
        }),
        endpoint("fallback", () => Promise.resolve(ok("z"))),
      ],
      () => {},
    );
    await expect(transport(config)).rejects.toThrow("bad request");
    expect(calls).toBe(1);
  });

  test("a hanging endpoint times out and the next one answers", async () => {
    // Like the real HTTP transport, the hanging endpoint stops when its signal aborts.
    const wrapped = createFailoverTransport(
      [
        {
          label: "primary",
          transport: ((cfg: { signal?: AbortSignal }) =>
            new Promise((_, reject) => cfg.signal?.addEventListener("abort", () => reject(cfg.signal?.reason)))) as unknown as RpcTransport,
        },
        endpoint("fallback", () => Promise.resolve(ok("late"))),
      ],
      () => {},
      50,
    );
    await expect(wrapped(config)).resolves.toEqual(ok("late"));
  });

  test("redactSecrets and rpcFromEnv", () => {
    expect(redactSecrets("GET https://devnet.helius-rpc.com/?api-key=abc-123 failed")).toBe("GET [url] failed");
    expect(redactSecrets("api-key=abc failed")).toBe("api-key=[redacted] failed");
    expect(rpcFromEnv({})).toBeNull();
    expect(rpcFromEnv({ SOLANA_RPC_URL: "https://devnet.helius-rpc.com/?api-key=REPLACE_ME" })).toBeNull();
    expect(rpcFromEnv({ SOLANA_RPC_FALLBACK_URL: "https://api.devnet.solana.com" })).not.toBeNull();
  });
});
