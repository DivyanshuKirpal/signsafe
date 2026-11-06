import { AccountRole, address, getBase58Decoder, type Instruction } from "@solana/kit";
import { describe, expect, test } from "vitest";
import { analyzeTransaction } from "../app/lib/analyze";
import { U64_MAX } from "../app/lib/config";
import { ATTACKER, buildTxBase64, FRIEND, LOOKUP_TABLE, solPaymentIx, VICTIM } from "./helpers/build-tx";
import { DEVNET_GENESIS, fakeRpc, loadFixture, replayFixture } from "./helpers/fake-rpc";

/**
 * Part 1: recorded LIVE devnet traffic (tests/fixtures/live, recorded by
 * `npm run live:check -- --record`), replayed offline through the real pipeline.
 */
describe("replayed live devnet fixtures", () => {
  test("sol-transfer: sender and recipient changes, fee identified", async () => {
    const fixture = loadFixture("sol-transfer");
    expect(fixture.source).toContain("live devnet");
    const { decoded, simulation } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    const { source, destination } = decoded.instructions[0].accounts;
    const fee = BigInt(simulation.feeLamports ?? "0");

    expect(simulation).toMatchObject({ ran: true, ok: true, rpcEndpoint: "primary" });
    expect(fee).toBe(5_000n);
    const sender = simulation.changes.find((c) => c.address === source && c.kind === "sol");
    expect(sender).toMatchObject({ delta: (-(10_000_000n + fee)).toString(), includesFeeLamports: "5000" });
    expect(simulation.changes.find((c) => c.address === destination && c.kind === "created")).toBeTruthy();
    expect(simulation.changes.find((c) => c.address === destination && c.kind === "sol")).toMatchObject({
      before: "0",
      after: "10000000",
      delta: "10000000",
    });
    expect(simulation.watched.map((w) => w.address)).toEqual([source, destination]);
    expect(decoded.warnings).toEqual([]);
  });

  test("token-approval: delegate and allowance change, token balance unchanged, decimals found", async () => {
    const fixture = loadFixture("token-approval");
    const { decoded, simulation } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    const approve = decoded.instructions[0];
    expect(approve.action).toBe("approve");
    expect(simulation.ok).toBe(true);

    const delegate = simulation.changes.find((c) => c.kind === "delegate");
    expect(delegate).toMatchObject({
      address: approve.accounts.source,
      before: null,
      after: approve.accounts.delegate,
      allowanceBefore: "0",
      allowanceAfter: U64_MAX.toString(),
      decimals: 6,
      tokenAccountOwner: approve.accounts.owner,
    });
    expect(simulation.changes.filter((c) => c.kind === "token")).toEqual([]);
    // The only other change is the fee payer's fee.
    expect(simulation.changes.filter((c) => c.kind === "sol").map((c) => c.delta)).toEqual(["-5000"]);
    // Plain Approve has no decimals; they were looked up from the token account's state.
    expect(approve.token).toEqual({ mint: delegate?.mint, decimals: 6 });
    // The mint was fetched and watched too.
    expect(simulation.watched.some((w) => w.roles.includes("mint"))).toBe(true);
  });

  test("lookup-table: v0 addresses resolved from a real devnet table", async () => {
    const fixture = loadFixture("lookup-table");
    const { decoded, simulation } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    expect(decoded.version).toBe("0");
    expect(decoded.lookupTables).toHaveLength(1);
    expect(decoded.lookupTables[0].resolved).toBe(true);
    const destination = decoded.instructions[0].accounts.destination;
    expect(decoded.accountKeys.find((k) => k.address === destination)).toMatchObject({ source: "lookup", writable: true, resolved: true });
    expect(simulation.ok).toBe(true);
    expect(simulation.changes.find((c) => c.address === destination && c.kind === "sol")?.delta).toBe("10000000");
    expect(simulation.notWatched).toEqual([]);
  });

  test("deactivated-lookup-table: the node refuses; shown as could-not-check, no changes claimed", async () => {
    const fixture = loadFixture("deactivated-lookup-table");
    const { simulation } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    expect(simulation).toMatchObject({ ran: true, ok: false, changes: [] });
    expect(simulation.error?.code).toBe("LOOKUP_TABLE_INVALID");
  });

  test("unfunded-fee-payer: simulation failure mapped to a plain message", async () => {
    const fixture = loadFixture("unfunded-fee-payer");
    const { simulation } = await analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
    expect(simulation).toMatchObject({ ran: true, ok: false, changes: [] });
    expect(simulation.error?.code).toBe("FEE_PAYER_UNFUNDED");
    expect(simulation.error?.userMessage).toContain("another network");
  });
});

/** Part 2: SYNTHETIC RPC answers for failure paths that are hard to produce live. */
describe("synthetic pipeline cases", () => {
  const payment = buildTxBase64([solPaymentIx()]);
  const okSimulation = (accounts: unknown[]) => ({
    context: { slot: 2n },
    value: { err: null, fee: 5_000n, logs: ["Program log: hi"], accounts, innerInstructions: [], unitsConsumed: 150n },
  });

  test("no RPC configured: decoded, but simulation not run", async () => {
    const result = await analyzeTransaction(payment, { rpc: null });
    expect(result.decoded.instructions[0].action).toBe("transferSol");
    expect(result.simulation).toMatchObject({ ran: false, error: { code: "RPC_NOT_CONFIGURED" } });
  });

  test("an endpoint that is not devnet is never used beyond the genesis check", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc({ getGenesisHash: () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" }, calls);
    const result = await analyzeTransaction(payment, { rpc });
    expect(result.simulation).toMatchObject({ ran: false, error: { code: "RPC_NOT_DEVNET" } });
    expect(calls).toEqual(["getGenesisHash"]);
  });

  test("RPC unreachable: decoded result kept, simulation marked not run", async () => {
    const rpc = fakeRpc({
      getGenesisHash: () => DEVNET_GENESIS,
      getMultipleAccounts: () => {
        throw new TypeError("fetch failed");
      },
    });
    const result = await analyzeTransaction(payment, { rpc });
    expect(result.decoded.instructions).toHaveLength(1);
    expect(result.simulation).toMatchObject({ ran: false, error: { code: "RPC_UNAVAILABLE" } });
  });

  test("more writable accounts than the cap: the extra ones are reported, never silently cut", async () => {
    // v1 allows 64 inline accounts: one unknown-program instruction writing to 45 accounts.
    const writable = Array.from({ length: 45 }, (_, i) => address(keyFor(i)));
    const ix: Instruction = {
      programAddress: address("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"),
      accounts: [{ address: VICTIM, role: AccountRole.WRITABLE_SIGNER }, ...writable.map((a) => ({ address: a, role: AccountRole.WRITABLE }))],
      data: new Uint8Array([1]),
    };
    const tx = buildTxBase64([ix], { version: 1 });
    const rpc = fakeRpc({
      getGenesisHash: () => DEVNET_GENESIS,
      getMultipleAccounts: (params) => ({ context: { slot: 1n }, value: (params[0] as unknown[]).map(() => null) }),
      simulateTransaction: (params) => okSimulation(((params[1] as { accounts: { addresses: unknown[] } }).accounts.addresses).map(() => null)),
    });
    const { decoded, simulation } = await analyzeTransaction(tx, { rpc });
    expect(simulation.watched).toHaveLength(40);
    expect(simulation.watched[0].address).toBe(VICTIM);
    expect(simulation.notWatched).toHaveLength(6);
    expect(decoded.warnings.map((w) => w.code)).toEqual(["WATCH_LIST_TRUNCATED"]);
    expect(decoded.warnings[0].message).toContain("6 account(s)");
  });

  test("unresolved lookup table: placeholder account listed as not watched", async () => {
    const tx = buildTxBase64([solPaymentIx()], { version: 0, lookupTables: { [LOOKUP_TABLE]: [FRIEND, ATTACKER] } });
    const rpc = fakeRpc({
      getGenesisHash: () => DEVNET_GENESIS,
      // The lookup table account does not exist (and the pre-state accounts are empty).
      getMultipleAccounts: (params) => ({ context: { slot: 1n }, value: (params[0] as unknown[]).map(() => null) }),
      simulateTransaction: () => ({ context: { slot: 2n }, value: { err: "AddressLookupTableNotFound", fee: null, logs: [], accounts: [null], innerInstructions: null } }),
    });
    const { decoded, simulation } = await analyzeTransaction(tx, { rpc });
    expect(decoded.lookupTables).toEqual([{ address: LOOKUP_TABLE, resolved: false }]);
    expect(decoded.warnings.map((w) => w.code)).toContain("LOOKUP_TABLE_UNRESOLVED");
    expect(simulation.notWatched).toEqual(["?lookup:8Wf5...VwTt#0"]);
    expect(simulation.error?.code).toBe("LOOKUP_TABLE_INVALID");
  });

  test("logs are capped and treated as plain text", async () => {
    const longLogs = Array.from({ length: 80 }, (_, i) => `Program log: ${"x".repeat(i === 0 ? 500 : 10)}`);
    const rpc = fakeRpc({
      getGenesisHash: () => DEVNET_GENESIS,
      getMultipleAccounts: (params) => ({ context: { slot: 1n }, value: (params[0] as unknown[]).map(() => null) }),
      simulateTransaction: () => ({ context: { slot: 2n }, value: { ...okSimulation([]).value, logs: longLogs, accounts: [null, null] } }),
    });
    const { simulation } = await analyzeTransaction(payment, { rpc });
    expect(simulation.logs).toHaveLength(50);
    expect(simulation.logs[0].length).toBeLessThanOrEqual(203);
    expect(simulation.logsTruncated).toBe(true);
  });

});

/** Deterministic distinct addresses for the cap test. */
function keyFor(i: number): string {
  const bytes = new Uint8Array(32).fill(7);
  bytes[0] = i + 1;
  return getBase58Decoder().decode(bytes);
}
