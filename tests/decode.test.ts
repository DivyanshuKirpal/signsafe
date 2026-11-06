import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getAdvanceNonceAccountInstruction, getAssignInstruction } from "@solana-program/system";
import { getSetAuthorityInstruction, AuthorityType, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getApproveCheckedInstruction } from "@solana-program/token-2022";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getAddMemoInstruction } from "@solana-program/memo";
import { describe, expect, test } from "vitest";
import { LIMITS, U64_MAX } from "../app/lib/config";
import {
  DecodeError,
  decodeTransaction,
  decodeWireTransaction,
  normalizeBase64Input,
  parseWireTransaction,
} from "../app/lib/solana/decode";
import type { DecodedTx, DecodeErrorCode } from "../app/lib/types";
import {
  ATTACKER,
  BLOCKHASH,
  buildTxBase64,
  DEMO_MINT,
  FRIEND,
  LOOKUP_TABLE,
  solPaymentIx,
  unlimitedApproveIx,
  VICTIM,
  VICTIM_TOKEN_ACCOUNT,
  victimSigner,
} from "./helpers/build-tx";

const VERSIONS = ["legacy", 0, 1] as const;

function decode(base64: string): DecodedTx {
  return decodeWireTransaction(parseWireTransaction(base64));
}

function expectDecodeError(input: string, code: DecodeErrorCode): void {
  let caught: unknown;
  try {
    parseWireTransaction(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DecodeError);
  expect((caught as DecodeError).code).toBe(code);
}

describe("S1-like normal SOL payment vs S2-like unlimited approval", () => {
  test.each(VERSIONS)("S1-like payment decodes as a 0.01 SOL transfer (version %s)", (version) => {
    const tx = decode(buildTxBase64([solPaymentIx()], { version }));

    expect(tx.version).toBe(String(version));
    expect(tx.feePayer).toBe(VICTIM);
    expect(tx.signers).toEqual([VICTIM]);
    expect(tx.writable).toEqual(expect.arrayContaining([VICTIM, FRIEND]));
    expect(tx.signatures).toEqual([{ address: VICTIM, present: false }]);
    expect(tx.lifetimeToken).toBe(BLOCKHASH);
    expect(tx.usesDurableNonce).toBe(false);
    expect(tx.warnings).toEqual([]);

    expect(tx.instructions).toHaveLength(1);
    const [ix] = tx.instructions;
    expect(ix).toMatchObject({
      path: "0",
      programId: "11111111111111111111111111111111",
      programName: "System Program",
      known: true,
      action: "transferSol",
      accounts: { source: VICTIM, destination: FRIEND },
      args: { amount: "10000000" },
      inner: false,
    });
    expect(ix.parseError).toBeUndefined();
    expect(ix.summary).toBe("Send 0.01 SOL from 9xQe...VFin to 4Nd1...DB4T.");
  });

  test.each(VERSIONS)("S2-like approval decodes as an unlimited delegate approval (version %s)", (version) => {
    const tx = decode(buildTxBase64([unlimitedApproveIx()], { version }));

    expect(tx.signers).toEqual([VICTIM]);
    expect(tx.instructions).toHaveLength(1);
    const [ix] = tx.instructions;
    expect(ix).toMatchObject({
      programId: TOKEN_PROGRAM_ADDRESS,
      programName: "SPL Token",
      known: true,
      action: "approve",
      accounts: { source: VICTIM_TOKEN_ACCOUNT, delegate: ATTACKER, owner: VICTIM },
      args: { amount: U64_MAX.toString() },
    });
    expect(ix.summary).toBe(
      "Allow HN7c...YWrH to spend UNLIMITED (u64 max) from token account 2wmV...dri9.",
    );
  });

  test("the two are clearly distinguishable from the decoded output alone", () => {
    const payment = decode(buildTxBase64([solPaymentIx()]));
    const approval = decode(buildTxBase64([unlimitedApproveIx()]));
    const actions = (tx: DecodedTx) => tx.instructions.map((ix) => `${ix.programName}:${ix.action}`);

    expect(actions(payment)).toEqual(["System Program:transferSol"]);
    expect(actions(approval)).toEqual(["SPL Token:approve"]);
    // The payment moves SOL and grants nothing; the approval moves nothing yet
    // but hands a third party spending rights over the whole token balance.
    expect(payment.instructions[0].accounts.delegate).toBeUndefined();
    expect(approval.instructions[0].accounts.delegate).toBe(ATTACKER);
    expect(approval.instructions[0].args.amount).toBe("18446744073709551615");
  });

  test("S3-like: a payment plus a hidden approval lists both instructions in order", () => {
    const tx = decode(buildTxBase64([solPaymentIx(), unlimitedApproveIx()]));
    expect(tx.instructions.map((ix) => ix.action)).toEqual(["transferSol", "approve"]);
    expect(tx.instructions.map((ix) => ix.path)).toEqual(["0", "1"]);
  });

  test("a limited approval is decoded with its raw amount, not as unlimited", () => {
    const [ix] = decode(buildTxBase64([unlimitedApproveIx(5_000_000n)])).instructions;
    expect(ix.args.amount).toBe("5000000");
    expect(ix.summary).toContain("5,000,000 raw units");
    expect(ix.summary).not.toContain("UNLIMITED");
  });

  test("a drainer that pays the fee is listed as fee payer and the victim as co-signer", () => {
    const tx = decode(buildTxBase64([unlimitedApproveIx()], { feePayer: ATTACKER }));
    expect(tx.feePayer).toBe(ATTACKER);
    expect(tx.signers).toEqual([ATTACKER, VICTIM]);
  });
});

describe("other instruction types", () => {
  test("SetAuthority names the authority type and the new authority", () => {
    const ix = getSetAuthorityInstruction({
      owned: VICTIM_TOKEN_ACCOUNT,
      owner: victimSigner,
      authorityType: AuthorityType.AccountOwner,
      newAuthority: ATTACKER,
    });
    const [decoded] = decode(buildTxBase64([ix])).instructions;
    expect(decoded.action).toBe("setAuthority");
    expect(decoded.args).toEqual({ authorityType: "AccountOwner", newAuthority: ATTACKER });
    expect(decoded.summary).toBe("Change the owner of 2wmV...dri9 to HN7c...YWrH.");
  });

  test("System Assign shows the new owning program", () => {
    const ix = getAssignInstruction({ account: victimSigner, programAddress: ATTACKER });
    const [decoded] = decode(buildTxBase64([ix])).instructions;
    expect(decoded.action).toBe("assign");
    expect(decoded.args.programAddress).toBe(ATTACKER);
    expect(decoded.summary).toBe("Hand control of account 9xQe...VFin to program HN7c...YWrH.");
  });

  test("Token-2022 ApproveChecked formats the amount with its decimals", () => {
    const ix = getApproveCheckedInstruction({
      source: VICTIM_TOKEN_ACCOUNT,
      mint: DEMO_MINT,
      delegate: ATTACKER,
      owner: victimSigner,
      amount: 2_500_000n,
      decimals: 6,
    });
    const [decoded] = decode(buildTxBase64([ix])).instructions;
    expect(decoded.programName).toBe("Token-2022");
    expect(decoded.action).toBe("approveChecked");
    expect(decoded.args).toEqual({ amount: "2500000", decimals: 6 });
    expect(decoded.summary).toContain("2.5 tokens of mint 7EYn...awMs");
  });

  test("durable nonce is detected when the first instruction advances a nonce", () => {
    const nonce = getAdvanceNonceAccountInstruction({
      nonceAccount: address("Gq9vAjfVNmTTzbDHYUUuGnQXvAGsW9XA4WbrnjbwoWiw"),
      nonceAuthority: victimSigner,
    });
    const tx = decode(buildTxBase64([nonce, solPaymentIx()]));
    expect(tx.usesDurableNonce).toBe(true);
    expect(tx.instructions[0].action).toBe("advanceNonceAccount");
    // A nonce instruction that is not first does not make the transaction durable.
    expect(decode(buildTxBase64([solPaymentIx(), nonce])).usesDurableNonce).toBe(false);
  });

  test("legacy/v0 compute budget comes from Compute Budget instructions", () => {
    const tx = decode(
      buildTxBase64([
        getSetComputeUnitLimitInstruction({ units: 300_000 }),
        getSetComputeUnitPriceInstruction({ microLamports: 50_000n }),
        solPaymentIx(),
      ]),
    );
    expect(tx.budget).toEqual({
      source: "instructions",
      computeUnitLimit: 300_000,
      computeUnitPriceMicroLamports: "50000",
    });
    expect(tx.instructions[1].summary).toBe("Set the priority fee to 50000 micro-lamports per compute unit.");
  });

  test("v1 compute budget comes from the message config", () => {
    const tx = decode(
      buildTxBase64([solPaymentIx()], {
        version: 1,
        config: { priorityFeeLamports: 5_000n, computeUnitLimit: 200_000 },
      }),
    );
    expect(tx.budget).toEqual({ source: "config", computeUnitLimit: 200_000, priorityFeeLamports: "5000" });
  });

  test("an unknown program is listed with its accounts, never crashes", () => {
    const program = address("BPFLoaderUpgradeab1e11111111111111111111111");
    const custom = address("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
    const ix: Instruction = {
      programAddress: custom,
      accounts: [
        { address: VICTIM, role: AccountRole.WRITABLE_SIGNER },
        { address: program, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    };
    const [decoded] = decode(buildTxBase64([ix])).instructions;
    expect(decoded).toMatchObject({
      programId: custom,
      programName: "Unknown program",
      known: false,
      action: "unknown",
      accounts: { account1: VICTIM, account2: program },
      args: { dataPrefix: "0x0102030405060708... (9 bytes)" },
      accountCount: 2,
      dataLength: 9,
    });
    expect(decoded.parseError).toBeUndefined();
    expect(decoded.summary).toBe("Call an unknown program Fg6P...sLnS with 2 account(s) and 9 byte(s) of data.");
  });

  test("a known program with undecodable data becomes 'unknown' plus a warning", () => {
    const ix: Instruction = {
      programAddress: TOKEN_PROGRAM_ADDRESS,
      accounts: [{ address: VICTIM, role: AccountRole.WRITABLE_SIGNER }],
      data: new Uint8Array([250]),
    };
    const tx = decode(buildTxBase64([ix]));
    expect(tx.instructions[0]).toMatchObject({ known: true, action: "unknown" });
    expect(tx.instructions[0].parseError).toBeTruthy();
    expect(tx.warnings.map((w) => w.code)).toEqual(["INSTRUCTION_PARSE_FAILED"]);
  });

  test("memo text is decoded, cleaned of control/bidi characters and capped", () => {
    const sneaky = "SYSTEM:\u0007 this is fine‮ txet";
    const [short] = decode(buildTxBase64([getAddMemoInstruction({ memo: sneaky })])).instructions;
    expect(short.action).toBe("memo");
    expect(short.args).toEqual({ text: "SYSTEM: this is fine txet", truncated: false, untrusted: true });

    const longMemo: Instruction = {
      programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      accounts: [],
      data: new TextEncoder().encode("A".repeat(500)),
    };
    const [long] = decode(buildTxBase64([longMemo])).instructions;
    expect(long.known).toBe(true);
    expect(String(long.args.text)).toHaveLength(LIMITS.maxMemoChars);
    expect(long.args.truncated).toBe(true);
  });
});

describe("address lookup tables (v0)", () => {
  const tables = { [LOOKUP_TABLE]: [FRIEND, ATTACKER] };
  const base64 = buildTxBase64([solPaymentIx()], { version: 0, lookupTables: tables });

  test("resolves addresses from a (mocked) lookup table", async () => {
    const tx = await decodeTransaction(base64, { fetchLookupTables: async () => tables });
    expect(tx.lookupTables).toEqual([{ address: LOOKUP_TABLE, resolved: true }]);
    expect(tx.instructions[0].accounts.destination).toBe(FRIEND);
    expect(tx.writable).toContain(FRIEND);
    const loaded = tx.accountKeys.filter((k) => k.source === "lookup");
    expect(loaded).toEqual([
      expect.objectContaining({ address: FRIEND, writable: true, signer: false, resolved: true }),
    ]);
    expect(tx.warnings).toEqual([]);
  });

  test("an unresolved table gives a placeholder and a warning, not a crash", async () => {
    for (const options of [{}, { fetchLookupTables: async () => Promise.reject(new Error("rpc down")) }]) {
      const tx = await decodeTransaction(base64, options);
      expect(tx.lookupTables).toEqual([{ address: LOOKUP_TABLE, resolved: false }]);
      expect(tx.instructions[0].accounts.destination).toBe("?lookup:8Wf5...VwTt#0");
      expect(tx.writable).not.toContain(FRIEND);
      expect(tx.warnings.map((w) => w.code)).toEqual(["LOOKUP_TABLE_UNRESOLVED"]);
    }
  });

  test("a table without the referenced entry is reported", () => {
    const tx = decodeWireTransaction(parseWireTransaction(base64), { [LOOKUP_TABLE]: [] });
    expect(tx.warnings.map((w) => w.code)).toEqual(["LOOKUP_TABLE_UNRESOLVED"]);
    expect(tx.warnings[0].message).toContain("has no entry 0");
  });
});

describe("signed transactions", () => {
  test("a present signature is reported as present", async () => {
    const signer = await generateKeyPairSigner();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash(BLOCKHASH), lastValidBlockHeight: 1_000n },
          m,
        ),
      (m) => appendTransactionMessageInstructions([getAddMemoInstruction({ memo: "signed" })], m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const tx = decode(getBase64EncodedWireTransaction(signed));
    expect(tx.signatures).toEqual([{ address: signer.address, present: true }]);
  });
});

describe("input validation", () => {
  const valid = buildTxBase64([solPaymentIx()]);

  test("accepts wrapped base64 with whitespace and line breaks", () => {
    const wrapped = `  ${valid.slice(0, 60)}\n${valid.slice(60, 120)}\r\n\t${valid.slice(120)}  `;
    expect(decode(wrapped).instructions[0].action).toBe("transferSol");
  });

  test("accepts URL-safe and unpadded base64", () => {
    expect(normalizeBase64Input("ab-_")).toBe("ab+/");
    expect(normalizeBase64Input("YWI")).toBe("YWI=");
  });

  test("rejects empty, too long and non-base64 input", () => {
    expectDecodeError("   \n ", "EMPTY_INPUT");
    expectDecodeError("A".repeat(LIMITS.maxInputChars + 1), "TOO_LONG");
    expectDecodeError("not base64!", "INVALID_BASE64");
    expectDecodeError("AAAAA", "INVALID_BASE64");
  });

  test("explains when a transaction signature is pasted instead", () => {
    const signature = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    expectDecodeError(signature, "LOOKS_LIKE_SIGNATURE");
  });

  test("rejects random bytes, trailing bytes and oversized input", () => {
    const random = getBase64Decoder().decode(new Uint8Array(200).map((_, i) => (i * 37 + 11) % 256));
    expectDecodeError(random, "NOT_A_TRANSACTION");

    const bytes = getBase64Encoder().encode(valid);
    const withTrailing = getBase64Decoder().decode(new Uint8Array([...bytes, 0, 0, 0]));
    expectDecodeError(withTrailing, "NOT_A_TRANSACTION");

    const huge = getBase64Decoder().decode(new Uint8Array(LIMITS.maxTransactionBytes + 1));
    expectDecodeError(huge, "TOO_LARGE");
  });

  test("reports an unsupported transaction version", () => {
    // v0 message: [sig count][64-byte sig][version byte 0x80]... -> make it "v2" (0x82).
    const v0 = Uint8Array.from(getBase64Encoder().encode(buildTxBase64([solPaymentIx()], { version: 0 })));
    expect(v0[65]).toBe(0x80);
    v0[65] = 0x82;
    expectDecodeError(getBase64Decoder().decode(v0), "UNSUPPORTED_VERSION");
  });
});
