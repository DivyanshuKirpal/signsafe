import { describe, expect, test } from "vitest";
import { POST } from "../app/api/analyze/route";
import type { AnalyzeResponse, ApiError } from "../app/lib/types";
import { buildTxBase64, solPaymentIx, unlimitedApproveIx, VICTIM } from "./helpers/build-tx";

function post(body: unknown, raw?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

describe("POST /api/analyze (decode only, M1)", () => {
  test("decodes an S1-like payment and an S2-like approval differently", async () => {
    const paymentRes = await post({ input: { kind: "base64", tx: buildTxBase64([solPaymentIx()]) } });
    const approvalRes = await post({ input: { kind: "base64", tx: buildTxBase64([unlimitedApproveIx()]) } });
    expect(paymentRes.status).toBe(200);
    expect(approvalRes.status).toBe(200);

    const payment = (await paymentRes.json()) as AnalyzeResponse;
    const approval = (await approvalRes.json()) as AnalyzeResponse;
    expect(payment.cluster).toBe("devnet");
    expect(payment.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(payment.decoded.instructions.map((ix) => ix.action)).toEqual(["transferSol"]);
    expect(approval.decoded.instructions.map((ix) => ix.action)).toEqual(["approve"]);
    expect(approval.decoded.instructions[0].args.amount).toBe("18446744073709551615");
    expect(typeof payment.timingsMs.total).toBe("number");
    // Tests run with no RPC configured (vitest.config.mts), so nothing touches the network.
    expect(payment.simulation).toMatchObject({ ran: false, error: { code: "RPC_NOT_CONFIGURED" } });
  });

  test("accepts a valid optional userAddress and rejects an invalid one", async () => {
    const tx = buildTxBase64([solPaymentIx()]);
    expect((await post({ input: { kind: "base64", tx, userAddress: VICTIM } })).status).toBe(200);

    const res = await post({ input: { kind: "base64", tx, userAddress: "not-an-address" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error.code).toBe("INVALID_ADDRESS");
  });

  test.each([
    ["bad JSON", undefined, "{not json", 400, "BAD_JSON"],
    ["wrong shape", { tx: "abc" }, undefined, 400, "BAD_REQUEST"],
    ["unknown kind", { input: { kind: "pdf", tx: "abc" } }, undefined, 400, "BAD_REQUEST"],
    ["empty tx", { input: { kind: "base64", tx: "   " } }, undefined, 400, "EMPTY_INPUT"],
    ["not base64", { input: { kind: "base64", tx: "hello world!" } }, undefined, 400, "INVALID_BASE64"],
    ["too large body", { input: { kind: "base64", tx: "A".repeat(25_000) } }, undefined, 413, "TOO_LARGE"],
  ])("%s -> %i %s with a plain message and no stack trace", async (_name, body, raw, status, code) => {
    const res = await post(body, raw);
    expect(res.status).toBe(status);
    const json = (await res.json()) as ApiError;
    expect(json.error.code).toBe(code);
    expect(json.error.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(json)).not.toMatch(/\bat \S+:\d+|node_modules|stack/i);
  });
});
