/**
 * Verdicts end to end (decode -> simulate -> rules), offline.
 *
 * - "fixture": real devnet RPC traffic recorded by `npm run live:check -- --record`
 *   (the five M2 fixtures, plus approval-unfunded-fee-payer recorded in M3).
 * - "fixture data, synthetic transaction": a hand-built transaction answered
 *   with account data taken from a recorded fixture.
 * - "synthetic": hand-written RPC answers.
 */
import { AccountRole, address, createNoopSigner, getBase58Decoder, type Instruction, lamports } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getApproveInstruction } from "@solana-program/token";
import { describe, expect, test } from "vitest";
import { analyzeTransaction } from "../app/lib/analyze";
import { U64_MAX } from "../app/lib/config";
import { FALLBACK_SENTENCES, VERDICT_LABELS, VERDICT_REASONS } from "../app/lib/risk/templates";
import type { Verdict } from "../app/lib/types";
import { buildTxBase64, FRIEND, LOOKUP_TABLE, solPaymentIx, unlimitedApproveIx } from "./helpers/build-tx";
import { DEVNET_GENESIS, fakeRpc, type LiveFixture, loadFixture, replayFixture } from "./helpers/fake-rpc";

/** Account data recorded in a fixture, by address: pre-state and simulated post-state. */
function fixtureAccounts(fixture: LiveFixture) {
  const pre = new Map<string, unknown>();
  const post = new Map<string, unknown>();
  let simValue: Record<string, unknown> = {};
  for (const e of fixture.exchanges) {
    const result = (e.response as { result: { value: unknown } }).result;
    if (e.method === "getMultipleAccounts") {
      const addresses = (e.params as [string[]])[0];
      addresses.forEach((a, i) => pre.set(a, (result.value as unknown[])[i]));
    }
    if (e.method === "simulateTransaction") {
      const addresses = (e.params as [string, { accounts: { addresses: string[] } }])[1].accounts.addresses;
      simValue = result.value as Record<string, unknown>;
      addresses.forEach((a, i) => post.set(a, (simValue.accounts as unknown[])[i]));
    }
  }
  return { pre, post, simValue };
}

/** A fake devnet RPC that answers with recorded account data (plus extra accounts). */
function rpcFromAccounts(pre: Map<string, unknown>, post: Map<string, unknown>, simValue: Record<string, unknown>) {
  return fakeRpc({
    getGenesisHash: () => DEVNET_GENESIS,
    getMultipleAccounts: (params) => ({ context: { slot: 1n }, value: (params[0] as string[]).map((a) => pre.get(a) ?? null) }),
    simulateTransaction: (params) => {
      const requested = (params[1] as { accounts: { addresses: string[] } }).accounts.addresses;
      return { context: { slot: 2n }, value: { ...simValue, innerInstructions: [], accounts: requested.map((a) => post.get(a) ?? null) } };
    },
  });
}

const funded = (lamportsValue: bigint) => ({ lamports: lamportsValue, owner: "11111111111111111111111111111111", executable: false, space: 0n, rentEpoch: 0n, data: ["", "base64"] });

function approvalParts() {
  const fixture = loadFixture("token-approval");
  return { fixture, ...fixtureAccounts(fixture) };
}

async function approvalAccounts() {
  const { fixture } = approvalParts();
  const { decoded } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
  const { source, delegate, owner } = decoded.instructions[0].accounts;
  return { tokenAccount: address(source), delegate: address(delegate), wallet: address(owner) };
}

const flagSummary = (v: Verdict) => v.flags.map((f) => `${f.severity}:${f.ruleId}${f.relatedRuleIds ? "+" + f.relatedRuleIds.join("+") : ""}`);

describe("M2 fixtures -> verdicts (fixture)", () => {
  test("ordinary 0.01 SOL payment: No known risks found", async () => {
    const fixture = loadFixture("sol-transfer");
    const { verdict } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    expect(verdict).toMatchObject({ level: "LOW_RISK", label: "No known risks found", complete: true, flags: [] });
  });

  test("unlimited approval: Danger although no tokens moved; one merged flag with both kinds of evidence", async () => {
    const fixture = loadFixture("token-approval");
    const { simulation, verdict, decoded } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    const tokenAccount = decoded.instructions[0].accounts.source;
    expect(simulation.changes.some((c) => c.kind === "token")).toBe(false);
    expect(verdict.level).toBe("DANGER");
    expect(verdict.label).toBe("Danger: don't sign unless you're certain");
    expect(verdict.complete).toBe(true);
    const forAccount = verdict.flags.filter((f) => f.account === tokenAccount);
    expect(forAccount).toHaveLength(1);
    const [flag] = forAccount;
    expect(flag).toMatchObject({ ruleId: "R-APPROVE", relatedRuleIds: ["R-DELEGATE-STATE"], severity: "danger" });
    expect(flag.sources).toEqual([
      expect.objectContaining({ type: "instruction", path: "0", inner: false }),
      expect.objectContaining({ type: "stateChange", address: tokenAccount, changeKind: "delegate" }),
    ]);
    // Owner and balance come from the token account's pre-transaction state.
    expect(flag.evidence.owner).toBe(decoded.instructions[0].accounts.owner);
    expect(flag.evidence.balanceBefore).toMatch(/tokens$/);
  });

  test("lookup-table transfer: No known risks found", async () => {
    const fixture = loadFixture("lookup-table");
    const { verdict } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    expect(verdict.level).toBe("LOW_RISK");
  });

  test.each(["unfunded-fee-payer", "deactivated-lookup-table"])("%s: Could not fully check", async (name) => {
    const fixture = loadFixture(name);
    const { verdict } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    expect(verdict).toMatchObject({ level: "UNKNOWN", label: "Could not fully check", complete: false });
    expect(flagSummary(verdict)).toEqual(["info:R-SIM-FAILED"]);
  });

  test("approval with an unfunded fee payer (fixture recorded in M3): stays Danger, check marked incomplete", async () => {
    const fixture = loadFixture("approval-unfunded-fee-payer");
    const { simulation, verdict, decoded } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    expect(simulation).toMatchObject({ ran: true, ok: false, error: { code: "FEE_PAYER_UNFUNDED" } });
    expect(verdict).toMatchObject({ level: "DANGER", complete: false });
    expect(flagSummary(verdict)).toEqual(["danger:R-APPROVE", "info:R-SIM-FAILED"]);
    // The owner still comes from devnet state fetched before the (failed) simulation.
    expect(verdict.flags[0].evidence.owner).toBe(decoded.instructions[0].accounts.owner);
  });
});

describe("state-only and drainer cases (fixture data, synthetic transaction)", () => {
  test("a dangerous delegate change seen only in account state is caught", async () => {
    const { pre, post, simValue } = approvalParts();
    const { tokenAccount, delegate, wallet } = await approvalAccounts();
    // An unknown program touches the token account; no Approve instruction is visible anywhere.
    const opaque: Instruction = {
      programAddress: address("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"),
      accounts: [
        { address: wallet, role: AccountRole.WRITABLE_SIGNER },
        { address: tokenAccount, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([7]),
    };
    const tx = buildTxBase64([opaque], { feePayer: wallet });
    const { decoded, simulation, verdict } = await analyzeTransaction(tx, { rpc: rpcFromAccounts(pre, post, simValue) });
    expect(decoded.instructions.some((ix) => ix.action === "approve")).toBe(false);
    expect(simulation.innerInstructions).toEqual([]);
    expect(verdict.level).toBe("DANGER");
    expect(flagSummary(verdict)).toEqual(["danger:R-DELEGATE-STATE", "caution:R-UNKNOWN-PROGRAM"]);
    expect(verdict.flags[0]).toMatchObject({ account: tokenAccount, evidence: { delegate, owner: wallet } });
    expect(verdict.flags[0].sources).toEqual([expect.objectContaining({ type: "stateChange", changeKind: "delegate" })]);
  });

  test("the would-be drainer as fee payer: still Danger", async () => {
    const { pre, post, simValue } = approvalParts();
    const { tokenAccount, delegate, wallet } = await approvalAccounts();
    pre.set(delegate, funded(1_000_000_000n));
    post.set(delegate, funded(999_995_000n));
    const tx = buildTxBase64(
      [getApproveInstruction({ source: tokenAccount, delegate, owner: createNoopSigner(wallet), amount: U64_MAX })],
      { feePayer: delegate },
    );
    const { decoded, verdict } = await analyzeTransaction(tx, { rpc: rpcFromAccounts(pre, post, simValue) });
    expect(decoded.feePayer).toBe(delegate);
    expect(decoded.signers).toEqual([delegate, wallet]);
    expect(verdict.level).toBe("DANGER");
    expect(flagSummary(verdict)).toEqual(["danger:R-APPROVE+R-DELEGATE-STATE"]);
  });

  test("the would-be drainer as a co-signer (bait payment): still Danger", async () => {
    const { pre, post, simValue } = approvalParts();
    const { tokenAccount, delegate, wallet } = await approvalAccounts();
    pre.set(delegate, funded(1_000_000_000n));
    post.set(delegate, funded(999_999_999n));
    const bait = getTransferSolInstruction({ source: createNoopSigner(delegate), destination: wallet, amount: lamports(1n) });
    const approve = getApproveInstruction({ source: tokenAccount, delegate, owner: createNoopSigner(wallet), amount: U64_MAX });
    const tx = buildTxBase64([bait, approve], { feePayer: wallet });
    const { decoded, verdict } = await analyzeTransaction(tx, { rpc: rpcFromAccounts(pre, post, simValue) });
    expect(decoded.feePayer).toBe(wallet);
    expect(decoded.signers).toContain(delegate);
    expect(verdict.level).toBe("DANGER");
    expect(verdict.flags.filter((f) => f.account === tokenAccount)).toHaveLength(1);
  });

  test("changing the optional user address never changes the verdict", async () => {
    const fixture = loadFixture("token-approval");
    const { tokenAccount, delegate, wallet } = await approvalAccounts();
    const run = (userAddress?: string) => analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) }, { userAddress });
    const baseline = await run();
    for (const userAddress of [wallet, delegate, tokenAccount, FRIEND]) {
      const result = await run(userAddress);
      expect(result.verdict).toEqual(baseline.verdict);
      expect(result.userAddress).toBe(userAddress);
    }
    expect(baseline.userAddress).toBeUndefined();
  });
});

describe("incomplete checks (synthetic)", () => {
  const nullAccounts = (params: unknown[]) => ({ context: { slot: 1n }, value: (params[0] as unknown[]).map(() => null) });

  test("simulation not run: payment -> Could not fully check; unlimited approval -> Danger, incomplete", async () => {
    const payment = await analyzeTransaction(buildTxBase64([solPaymentIx()]), { rpc: null });
    expect(payment.verdict).toMatchObject({ level: "UNKNOWN", complete: false });
    const approval = await analyzeTransaction(loadFixture("token-approval").txBase64, { rpc: null });
    expect(approval.verdict).toMatchObject({ level: "DANGER", complete: false });
    expect(flagSummary(approval.verdict)).toEqual(["danger:R-APPROVE", "info:R-SIM-FAILED"]);
  });

  test("unresolved lookup table: payment -> Could not fully check; approval -> Danger, incomplete", async () => {
    const rpc = () =>
      fakeRpc({
        getGenesisHash: () => DEVNET_GENESIS,
        getMultipleAccounts: nullAccounts,
        simulateTransaction: () => ({ context: { slot: 2n }, value: { err: "AddressLookupTableNotFound", fee: null, logs: [], accounts: [null], innerInstructions: null } }),
      });
    const tables = { [LOOKUP_TABLE]: [FRIEND] };
    const payment = await analyzeTransaction(buildTxBase64([solPaymentIx()], { version: 0, lookupTables: tables }), { rpc: rpc() });
    expect(payment.verdict.level).toBe("UNKNOWN");
    expect(flagSummary(payment.verdict)).toEqual(["caution:R-UNRESOLVED", "info:R-SIM-FAILED"]);

    const approval = await analyzeTransaction(
      buildTxBase64([unlimitedApproveIx()], { version: 0, lookupTables: { [LOOKUP_TABLE]: [address("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH")] } }),
      { rpc: rpc() },
    );
    expect(approval.decoded.lookupTables[0].resolved).toBe(false);
    expect(approval.verdict).toMatchObject({ level: "DANGER", complete: false });
    expect(flagSummary(approval.verdict)).toEqual(["danger:R-APPROVE", "caution:R-UNRESOLVED", "info:R-SIM-FAILED"]);
  });

  test("truncated watch list -> Could not fully check (even with a successful simulation)", async () => {
    const keyFor = (i: number) => {
      const bytes = new Uint8Array(32).fill(9);
      bytes[0] = i + 1;
      return address(getBase58Decoder().decode(bytes));
    };
    const victim = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    const ix: Instruction = {
      programAddress: address("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"),
      accounts: [{ address: victim, role: AccountRole.WRITABLE_SIGNER }, ...Array.from({ length: 45 }, (_, i) => ({ address: keyFor(i), role: AccountRole.WRITABLE }))],
      data: new Uint8Array([1]),
    };
    const rpc = fakeRpc({
      getGenesisHash: () => DEVNET_GENESIS,
      getMultipleAccounts: nullAccounts,
      simulateTransaction: (params) => ({
        context: { slot: 2n },
        value: { err: null, fee: 5_000n, logs: [], innerInstructions: [], accounts: (params[1] as { accounts: { addresses: unknown[] } }).accounts.addresses.map(() => null) },
      }),
    });
    const { simulation, verdict } = await analyzeTransaction(buildTxBase64([ix], { version: 1 }), { rpc });
    expect(simulation.ok).toBe(true);
    expect(verdict).toMatchObject({ level: "UNKNOWN", complete: false });
    expect(flagSummary(verdict)).toEqual(["caution:R-UNKNOWN-PROGRAM", "caution:R-UNRESOLVED"]);
  });
});

describe("wording", () => {
  test("no label, reason, flag or template text calls a transaction safe or guaranteed", async () => {
    const texts: string[] = [...Object.values(VERDICT_LABELS), ...Object.values(VERDICT_REASONS), ...Object.values(FALLBACK_SENTENCES)];
    for (const name of ["sol-transfer", "token-approval", "lookup-table", "deactivated-lookup-table", "unfunded-fee-payer", "approval-unfunded-fee-payer"]) {
      const fixture = loadFixture(name);
      const { verdict } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
      texts.push(verdict.label, verdict.reason, ...verdict.flags.flatMap((f) => [f.title, f.detail]));
    }
    for (const text of texts) expect(text).not.toMatch(/\bsafe\b|guarantee/i);
  });
});
