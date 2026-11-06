/**
 * Validation of AI answers: shape AND meaning. Contexts are built offline from
 * the recorded devnet fixtures. "Live answer" cases are texts Gemini actually
 * returned on 7 Nov 2026 (scenarios:check -- --ai and a calibration run).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { analyzeTransaction } from "../app/lib/analyze";
import { buildExplanationContext, type ExplanationContext } from "../app/lib/ai/facts";
import { templateExplanation } from "../app/lib/ai/template";
import { parseAnswer, validateExplanation } from "../app/lib/ai/validate";
import { SCENARIOS } from "../app/lib/scenarios/index";
import { loadFixture, replayFixture } from "./helpers/fake-rpc";

const ctx: Record<string, ExplanationContext> = {};

async function contextFor(name: string, dir: string): Promise<ExplanationContext> {
  const f = loadFixture(name, dir);
  return buildExplanationContext(await analyzeTransaction(f.txBase64, { rpc: replayFixture(f) }));
}

beforeAll(async () => {
  for (const s of SCENARIOS) ctx[s.id] = await contextFor(s.id, "tests/fixtures/scenarios");
  for (const n of ["unfunded-fee-payer", "approval-unfunded-fee-payer", "deactivated-lookup-table"]) ctx[n] = await contextFor(n, "tests/fixtures/live");
});

const answer = (summary: string, points: string[], advice: string) => ({ summary, points, advice });
const codeOf = (raw: unknown, name: string) => {
  const r = validateExplanation(raw, ctx[name].meta);
  return r.ok ? "OK" : r.code;
};

// A good S3 answer to vary in the rejection tests.
const S3_GOOD = answer(
  "This transaction gives another address permission to spend unlimited tokens from your account. It also sends 0.01 SOL to F61U...AG9Y.",
  ["No tokens move right now when this is signed.", "Address 59WC...v3ZB can move your tokens later without asking."],
  "Do not sign this transaction unless you are certain.",
);

describe("live answers from Gemini", () => {
  test("S2 run 0 (was a false positive): 'when you sign this approval' is descriptive, not advice", () => {
    const raw = parseAnswer(`{
      "summary": "This transaction grants another address unlimited permission to spend tokens from your token account. No tokens are transferred right now except for the small network fee.",
      "points": [
        "59WC...v3ZB gets permission to spend unlimited tokens from account 4is5...Jfc1.",
        "No tokens leave your account immediately when you sign this approval.",
        "The delegated address can move your tokens later without asking for further approval.",
        "Account 4gow...pj9r pays a network fee of 0.000005 SOL."
      ],
      "advice": "Do not sign this transaction unless you are completely certain you want to grant this permission."
    }`);
    expect(codeOf(raw, "s2-unlimited-approval")).toBe("OK");
  });

  test("S3 (hidden approval): both the payment and the permission, and nothing moving yet", () => {
    const raw = answer(
      "This transaction gives another address permission to spend unlimited tokens from your account. It also sends 0.01 SOL to a new account.",
      [
        "Address 59WC...v3ZB gets unlimited permission to spend tokens from token account 4is5...Jfc1.",
        "No tokens move right now when this permission is signed.",
        "Address 4gow...pj9r sends 0.01 SOL to new account F61U...AG9Y.",
        "Account 4gow...pj9r pays the network fee of 0.000005 SOL.",
      ],
      "Do not sign this transaction unless you are certain.",
    );
    expect(codeOf(raw, "s3-hidden-approval")).toBe("OK");
  });

  test("S5 and S8", () => {
    const s5 = answer(
      "This transaction hands control of an existing wallet account to a program. Once signed, that program will control the account and its SOL.",
      ["Instruction 0 assigns account 4gow...pj9r to program 59WC...v3ZB.", "Account 4gow...pj9r pays a network fee of 0.000005 SOL."],
      "Do not sign this transaction unless you are completely certain you want to hand over control.",
    );
    expect(codeOf(s5, "s5-wallet-assign")).toBe("OK");
    const s8 = answer(
      "This transaction gives another address unlimited permission to spend tokens from your account later. No tokens move right now when signed, but a small network fee is deducted.",
      [
        "Address 59WC...v3ZB gains permission to spend UNLIMITED tokens from account 4is5...Jfc1.",
        "No tokens move at signing, so balance previews show no token changes.",
        "Account 4gow...pj9r pays the network fee of 0.000005 SOL.",
        "The transaction contains a memo written by the sender.",
      ],
      "Do not sign this transaction unless you are certain.",
    );
    expect(codeOf(s8, "s8-memo-injection")).toBe("OK");
  });
});

describe("the built-in explanation follows the same rules", () => {
  test.each([...SCENARIOS.map((s) => s.id), "unfunded-fee-payer", "approval-unfunded-fee-payer", "deactivated-lookup-table"])(
    "%s template passes the validator",
    (name) => {
      expect(codeOf(templateExplanation(ctx[name]), name)).toBe("OK");
    },
  );

  test("S3 template explains both the payment and the permission, and that nothing moves yet", () => {
    const t = templateExplanation(ctx["s3-hidden-approval"]);
    const text = [t.summary, ...t.points].join(" ");
    expect(text).toContain("0.01 SOL");
    expect(text).toMatch(/permission to move tokens .* later/);
    expect(text).toContain("No tokens move when it is signed");
  });
});

describe("rejections", () => {
  test("shape and format", () => {
    expect(codeOf({ summary: "x", points: "not an array", advice: "y" }, "s3-hidden-approval")).toBe("SCHEMA");
    expect(codeOf({ summary: "x", points: [] }, "s3-hidden-approval")).toBe("SCHEMA");
    expect(codeOf({ ...S3_GOOD, summary: "One. Two. Three." }, "s3-hidden-approval")).toBe("FORMAT");
    expect(codeOf({ ...S3_GOOD, points: Array(6).fill("No tokens move now.") }, "s3-hidden-approval")).toBe("FORMAT");
    expect(codeOf({ ...S3_GOOD, points: ["word ".repeat(26).trim()] }, "s3-hidden-approval")).toBe("FORMAT");
    expect(codeOf({ ...S3_GOOD, points: ["**Danger** here."] }, "s3-hidden-approval")).toBe("FORMAT");
    expect(codeOf({ ...S3_GOOD, points: ["See https://example.com for details."] }, "s3-hidden-approval")).toBe("FORMAT");
    expect(codeOf({ ...S3_GOOD, points: ["Be careful \u{1F6A8}"] }, "s3-hidden-approval")).toBe("FORMAT");
    expect(codeOf({ ...S3_GOOD, advice: "Do not sign. Really." }, "s3-hidden-approval")).toBe("FORMAT");
  });

  test("guarantees and trust claims", () => {
    expect(codeOf({ ...S3_GOOD, advice: "This is safe to sign." }, "s3-hidden-approval")).toBe("GUARANTEE");
    expect(codeOf({ ...S3_GOOD, points: ["The site is verified."] }, "s3-hidden-approval")).toBe("GUARANTEE");
    expect(codeOf({ ...S3_GOOD, points: ["Nothing is guaranteed."] }, "s3-hidden-approval")).toBe("GUARANTEE");
    // A negated trust word is fine: it describes a gap.
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "The owner could not be verified."] }, "s3-hidden-approval")).toBe("OK");
  });

  test("signing advice must match the verdict", () => {
    expect(codeOf({ ...S3_GOOD, advice: "Go ahead and sign it." }, "s3-hidden-approval")).toBe("SIGNING_ADVICE");
    expect(codeOf({ ...S3_GOOD, advice: "You can sign this transaction." }, "s3-hidden-approval")).toBe("SIGNING_ADVICE");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "Sign it now."] }, "s3-hidden-approval")).toBe("SIGNING_ADVICE");
    expect(codeOf({ ...S3_GOOD, advice: "Review the details." }, "s3-hidden-approval")).toBe("SIGNING_ADVICE");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "Everything looks fine."] }, "s3-hidden-approval")).toBe("SIGNING_ADVICE");
    // Allowed under Danger: refusals, conditions, contrast, descriptions.
    expect(codeOf({ ...S3_GOOD, advice: "Only sign if you trust the site and want to give this permission." }, "s3-hidden-approval")).toBe("OK");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "The payment looks fine, but the approval is the real risk."] }, "s3-hidden-approval")).toBe("OK");
    // No known risks: telling the user not to sign at all contradicts the verdict.
    const s1 = answer("This transaction sends 0.01 SOL from 4gow...pj9r to F61U...AG9Y.", [], "Do not sign this.");
    expect(codeOf(s1, "s1-normal-payment")).toBe("SIGNING_ADVICE");
    expect(codeOf({ ...s1, advice: "Confirm the amounts and addresses before signing." }, "s1-normal-payment")).toBe("OK");
  });

  test("downplaying a Danger, or claiming danger when no rule fired", () => {
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "The approval is harmless."] }, "s3-hidden-approval")).toBe("DOWNPLAYS_RISK");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "This approval is not harmless."] }, "s3-hidden-approval")).toBe("OK");
    const s1 = answer("This transaction sends 0.01 SOL from 4gow...pj9r to F61U...AG9Y.", ["This payment could drain your wallet."], "Check the amounts before signing.");
    expect(codeOf(s1, "s1-normal-payment")).toBe("CLAIMS_RISK");
  });

  test("amounts and addresses must come from the trusted facts", () => {
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "It also sends 5 SOL."] }, "s3-hidden-approval")).toBe("UNGROUNDED_AMOUNT");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "Your tokens are worth $1,000."] }, "s3-hidden-approval")).toBe("UNGROUNDED_AMOUNT");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "This is 50% of your balance."] }, "s3-hidden-approval")).toBe("UNGROUNDED_AMOUNT");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "Address Abcd...wxyz receives the tokens later."] }, "s3-hidden-approval")).toBe("UNGROUNDED_ADDRESS");
    // Rounding within 2% is fine: 0.039995 SOL left -> "about 0.04 SOL".
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "About 0.04 SOL remains in your wallet."] }, "s3-hidden-approval")).toBe("OK");
  });

  test("an amount that appears only in an untrusted memo is not grounded", async () => {
    const f = loadFixture("s8-memo-injection", "tests/fixtures/scenarios");
    const analysis = await analyzeTransaction(f.txBase64, { rpc: replayFixture(f) });
    const memo = analysis.decoded.instructions[1];
    const tampered = { ...analysis, decoded: { ...analysis.decoded, instructions: [analysis.decoded.instructions[0], { ...memo, args: { ...memo.args, text: "You will receive 777 SOL" } }] } };
    const c = buildExplanationContext(tampered);
    expect(c.facts.untrusted.memos[0]).toContain("777 SOL");
    const raw = answer(
      "This gives another address unlimited permission to spend your tokens later. You will receive 777 SOL.",
      ["No tokens move right now."],
      "Do not sign this unless you are certain.",
    );
    expect(validateExplanation(raw, c.meta)).toMatchObject({ ok: false, code: "UNGROUNDED_AMOUNT" });
  });

  test("invented transfers: permission to spend later is not tokens moving now", () => {
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "It transfers all your tokens to 59WC...v3ZB."] }, "s3-hidden-approval")).toBe("INVENTED_TRANSFER");
    // No amount here, so the transfer check (not the amount check) decides.
    const s2 = answer("This gives another address unlimited permission to spend your tokens.", ["It sends SOL to 59WC...v3ZB."], "Do not sign this unless you are certain.");
    expect(codeOf(s2, "s2-unlimited-approval")).toBe("INVENTED_TRANSFER");
    expect(codeOf({ ...S3_GOOD, points: [...S3_GOOD.points, "Your tokens could be drained later by 59WC...v3ZB."] }, "s3-hidden-approval")).toBe("OK");
  });

  test("incomplete checks must be said, and never presented as confirmed", () => {
    const unknown = answer("This transaction sends 0.01 SOL to another address.", ["The fee payer has no SOL on devnet."], "Do not sign until the missing checks are resolved.");
    expect(codeOf(unknown, "unfunded-fee-payer")).toBe("UNVERIFIED_AS_CONFIRMED");
    expect(codeOf({ ...unknown, summary: "This transaction asks to send 0.01 SOL, but its effects could not be confirmed." }, "unfunded-fee-payer")).toBe("OK");
    expect(
      codeOf({ ...unknown, summary: "The effects could not be confirmed.", points: ["The simulation confirms the transfer of 0.01 SOL."] }, "unfunded-fee-payer"),
    ).toBe("UNVERIFIED_AS_CONFIRMED");
    // Danger with incomplete evidence: the gap must still be mentioned.
    const dangerIncomplete = answer(
      "This gives another address unlimited permission to spend tokens from your account later.",
      ["No tokens move when it is signed."],
      "Do not sign this unless you are certain.",
    );
    expect(codeOf(dangerIncomplete, "approval-unfunded-fee-payer")).toBe("UNVERIFIED_AS_CONFIRMED");
    expect(codeOf({ ...dangerIncomplete, points: [...dangerIncomplete.points, "The simulation failed, so its effects could not be confirmed."] }, "approval-unfunded-fee-payer")).toBe("OK");
  });

  test("every finding and the SOL transfer must be covered (S3 explains both)", () => {
    const onlyApproval = answer("This gives another address unlimited permission to spend your tokens later.", ["No tokens move right now."], "Do not sign this unless you are certain.");
    expect(codeOf(onlyApproval, "s3-hidden-approval")).toBe("MISSING_COVERAGE");
    const onlyPayment = answer("This transaction sends 0.01 SOL to F61U...AG9Y.", [], "Do not sign this unless you are certain.");
    expect(codeOf(onlyPayment, "s3-hidden-approval")).toBe("MISSING_COVERAGE");
    expect(codeOf(S3_GOOD, "s3-hidden-approval")).toBe("OK");
  });
});
