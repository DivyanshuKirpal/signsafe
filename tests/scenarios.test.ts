/**
 * Demo scenarios, offline (synthetic addresses, no RPC).
 * Live verdicts are checked by `npm run scenarios:check` and replayed from
 * tests/fixtures/scenarios in scenarios-replay.test.ts.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { address, blockhash } from "@solana/kit";
import { describe, expect, test } from "vitest";
import { GET, POST } from "../app/api/scenarios/route";
import { analyzeTransaction } from "../app/lib/analyze";
import { compileScenario, type ScenarioContext, scenarioInstructions } from "../app/lib/scenarios/build";
import { loadDemoConfig } from "../app/lib/scenarios/demo-config";
import { S8_MEMO, SCENARIO_IDS, SCENARIOS, type ScenarioId } from "../app/lib/scenarios/index";
import { decodeWireTransaction, parseWireTransaction } from "../app/lib/solana/decode";

const ctx: ScenarioContext = {
  owner: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
  ownerTokenAccount: address("2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9"),
  attacker: address("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH"),
  friend: address("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"),
  unknownProgram: address("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
  ownerLamports: 50_000_000n,
};
const LIFETIME = { blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"), lastValidBlockHeight: 100n };

function build(id: ScenarioId): string {
  return compileScenario(scenarioInstructions(id, ctx), ctx.owner, LIFETIME);
}

function decoded(id: ScenarioId) {
  return decodeWireTransaction(parseWireTransaction(build(id)));
}

describe("scenario builders (unsigned, fee payer = owner)", () => {
  test.each(SCENARIO_IDS)("%s is an unsigned v0 transaction paid by the owner", (id) => {
    const tx = decoded(id);
    expect(tx.version).toBe("0");
    expect(tx.feePayer).toBe(ctx.owner);
    expect(tx.signatures).toEqual([{ address: ctx.owner, present: false }]);
  });

  test("each scenario contains the intended instructions", () => {
    const actions = (id: ScenarioId) => decoded(id).instructions.map((ix) => `${ix.programName}:${ix.action}`);
    expect(actions("s1-normal-payment")).toEqual(["System Program:transferSol"]);
    expect(actions("s2-unlimited-approval")).toEqual(["SPL Token:approve"]);
    expect(actions("s3-hidden-approval")).toEqual(["System Program:transferSol", "SPL Token:approve"]);
    expect(actions("s4-token-account-takeover")).toEqual(["SPL Token:setAuthority"]);
    expect(actions("s5-wallet-assign")).toEqual(["System Program:assign"]);
    expect(actions("s6-drain-sol")).toEqual(["System Program:transferSol"]);
    expect(actions("s7-unknown-program")).toEqual(["Unknown program:unknown"]);
    expect(actions("s8-memo-injection")).toEqual(["SPL Token:approve", "Memo:memo"]);
  });

  test("amounts and targets", () => {
    expect(decoded("s1-normal-payment").instructions[0]).toMatchObject({ accounts: { destination: ctx.friend }, args: { amount: "10000000" } });
    expect(decoded("s3-hidden-approval").instructions[1]).toMatchObject({ accounts: { delegate: ctx.attacker }, args: { amount: "18446744073709551615" } });
    expect(decoded("s4-token-account-takeover").instructions[0].args).toEqual({ authorityType: "AccountOwner", newAuthority: ctx.attacker });
    expect(decoded("s5-wallet-assign").instructions[0].args).toEqual({ programAddress: ctx.attacker });
    expect(decoded("s6-drain-sol").instructions[0]).toMatchObject({ accounts: { destination: ctx.attacker }, args: { amount: "47500000" } });
    expect(decoded("s8-memo-injection").instructions[1].args.text).toBe(S8_MEMO);
  });

  test("instruction evidence alone (no RPC) already gives Danger for S2-S5 and S8; the S8 memo changes nothing", async () => {
    const level = async (id: ScenarioId) => (await analyzeTransaction(build(id), { rpc: null })).verdict;
    for (const id of ["s2-unlimited-approval", "s3-hidden-approval", "s4-token-account-takeover", "s5-wallet-assign", "s8-memo-injection"] as const) {
      expect((await level(id)).level).toBe("DANGER");
    }
    const s8 = await level("s8-memo-injection");
    expect(s8.flags.find((f) => f.ruleId === "R-MEMO")?.severity).toBe("info");
    expect(s8.reason).not.toMatch(/\bsafe\b/i);
    // Without a simulation, a plain payment cannot be confirmed.
    expect((await level("s1-normal-payment")).level).toBe("UNKNOWN");
  });
});

describe("/api/scenarios", () => {
  test("the list hides descriptions and expected verdicts", async () => {
    const res = await GET(new Request("http://localhost/api/scenarios"));
    const body = (await res.json()) as { scenarios: Record<string, unknown>[] };
    expect(body.scenarios).toHaveLength(SCENARIOS.length);
    for (const s of body.scenarios) expect(Object.keys(s).sort()).toEqual(["code", "id", "pitch"]);
    expect(JSON.stringify(body)).not.toMatch(/DANGER|LOW_RISK|expected|description/);
  });

  test("reveal returns the description and expected verdict", async () => {
    const res = await GET(new Request("http://localhost/api/scenarios?reveal=s8-memo-injection"));
    expect(await res.json()).toMatchObject({ code: "S8", expected: ["DANGER"], expectedLabels: ["Danger: don't sign unless you're certain"] });
    expect((await GET(new Request("http://localhost/api/scenarios?reveal=nope"))).status).toBe(404);
  });

  test("build: bad requests are rejected; without RPC (tests) nothing touches the network", async () => {
    const post = (body: unknown) => POST(new Request("http://localhost/api/scenarios", { method: "POST", body: JSON.stringify(body) }));
    expect((await post({ id: "nope" })).status).toBe(400);
    expect((await post({ id: "s1-normal-payment", owner: "not-an-address" })).status).toBe(400);
    const res = await post({ id: "s1-normal-payment" });
    expect(res.status).toBe(503);
    expect(["DEMO_NOT_SET_UP", "RPC_NOT_CONFIGURED"]).toContain(((await res.json()) as { error: { code: string } }).error.code);
  });
});

describe("demo config", () => {
  test("validates addresses and keeps public fields only", () => {
    const dir = mkdtempSync(join(tmpdir(), "signsafe-"));
    const good = {
      cluster: "devnet",
      authority: ctx.owner,
      victim: ctx.owner,
      attacker: ctx.attacker,
      friend: ctx.friend,
      mint: ctx.ownerTokenAccount,
      decimals: 6,
      victimTokenAccount: ctx.ownerTokenAccount,
      unknownProgram: ctx.unknownProgram,
      updatedAt: "2026-11-07T00:00:00Z",
      secretKey: [1, 2, 3],
    };
    writeFileSync(join(dir, "ok.json"), JSON.stringify(good));
    const loaded = loadDemoConfig(join(dir, "ok.json"));
    expect(loaded?.victim).toBe(ctx.owner);
    expect(loaded && "secretKey" in loaded).toBe(false);
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...good, cluster: "mainnet" }));
    expect(loadDemoConfig(join(dir, "bad.json"))).toBeNull();
    expect(loadDemoConfig(join(dir, "missing.json"))).toBeNull();
  });
});
