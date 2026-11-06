/**
 * Demo scenarios replayed offline from LIVE devnet recordings
 * (tests/fixtures/scenarios, recorded by `npm run scenarios:check -- --record`
 * on Sat 7 Nov 2026 against the funded demo accounts). Same pipeline, no network.
 */
import { describe, expect, test } from "vitest";
import { analyzeTransaction } from "../app/lib/analyze";
import { S8_MEMO, SCENARIOS } from "../app/lib/scenarios/index";
import { loadFixture, replayFixture } from "./helpers/fake-rpc";

const DIR = "tests/fixtures/scenarios";

async function run(id: string) {
  const fixture = loadFixture(id, DIR);
  expect(fixture.source).toContain("live devnet");
  return analyzeTransaction(fixture.txBase64, { rpc: replayFixture(fixture) });
}

describe("scenario fixtures (recorded live on devnet)", () => {
  test.each(SCENARIOS.map((s) => [s.code, s.id, s.expected] as const))("%s verdict matches the expected one", async (_code, id, expected) => {
    const { verdict, simulation } = await run(id);
    expect(simulation.ok).toBe(true);
    expect(expected).toContain(verdict.level);
    for (const f of verdict.flags) expect(`${f.title} ${f.detail}`).not.toMatch(/\bsafe\b|guarantee/i);
  });

  test("S1: No known risks found", async () => {
    expect((await run("s1-normal-payment")).verdict).toMatchObject({ level: "LOW_RISK", complete: true, flags: [] });
  });

  test("S3: the payment looks normal; the approval is caught with instruction and state evidence", async () => {
    const { decoded, verdict } = await run("s3-hidden-approval");
    expect(decoded.instructions.map((ix) => ix.action)).toEqual(["transferSol", "approve"]);
    const [flag] = verdict.flags;
    expect(flag).toMatchObject({ ruleId: "R-APPROVE", relatedRuleIds: ["R-DELEGATE-STATE"], severity: "danger" });
    expect(flag.sources.map((s) => (s.type === "instruction" ? `ix#${s.path}` : s.type))).toEqual(["ix#1", "stateChange"]);
  });

  test("S4 and S5: takeovers caught from the instruction and the account state", async () => {
    const s4 = (await run("s4-token-account-takeover")).verdict.flags[0];
    expect(s4).toMatchObject({ ruleId: "R-SET-AUTHORITY", severity: "danger" });
    expect(s4.sources.map((s) => (s.type === "stateChange" ? s.changeKind : s.type))).toEqual(["instruction", "tokenOwner"]);
    const s5 = (await run("s5-wallet-assign")).verdict.flags[0];
    expect(s5).toMatchObject({ ruleId: "R-ASSIGN", severity: "danger" });
    expect(s5.sources.map((s) => (s.type === "stateChange" ? s.changeKind : s.type))).toEqual(["instruction", "programOwner"]);
  });

  test("S8: the memo tries to talk the checker out of it; the verdict stays Danger", async () => {
    const { decoded, verdict } = await run("s8-memo-injection");
    expect(decoded.instructions[1].args.text).toBe(S8_MEMO);
    expect(verdict.level).toBe("DANGER");
    expect(verdict.flags.map((f) => `${f.severity}:${f.ruleId}`)).toEqual(["danger:R-APPROVE", "info:R-MEMO"]);
  });
});
