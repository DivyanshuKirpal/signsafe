import { describe, expect, test } from "vitest";
import { scanText } from "../scripts/scan-secrets";
import { safetyProblems, statusOf } from "../scripts/check-env";

// Fake secrets are assembled at runtime so this file never contains one
// literally (otherwise scan:secrets would flag the test itself).
const fakeGoogleKey = "AI" + "za" + "x".repeat(35);
const fakeUuid = "12345678-abcd-4def-8123-456789abcdef";
const fakeKeypair = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));
const fakePem = "-----" + "BEGIN PRIVATE KEY-----";

describe("scanText", () => {
  test("finds a Google API key", () => {
    const findings = scanText("a.ts", `const k = "${fakeGoogleKey}";`);
    expect(findings).toEqual([{ file: "a.ts", line: 1, pattern: "google-api-key" }]);
  });

  test("finds a Helius-style api-key UUID", () => {
    const findings = scanText("a.env", `X=https://devnet.helius-rpc.com/?api-key=${fakeUuid}`);
    expect(findings.map((f) => f.pattern)).toEqual(["rpc-api-key-uuid"]);
  });

  test("finds a 64-number keypair array on one line and pretty-printed", () => {
    expect(scanText("k.json", fakeKeypair).map((f) => f.pattern)).toEqual(["keypair-byte-array"]);
    const pretty = JSON.stringify(JSON.parse(fakeKeypair), null, 2);
    expect(scanText("k.json", pretty).map((f) => f.pattern)).toEqual(["keypair-byte-array"]);
  });

  test("finds a PEM block header", () => {
    expect(scanText("key.pem", `line one\n${fakePem}\n`)).toEqual([
      { file: "key.pem", line: 2, pattern: "pem-block" },
    ]);
  });

  test("ignores placeholders, rule text and short arrays", () => {
    const text = [
      "SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=REPLACE_ME",
      "GEMINI_API_KEY=REPLACE_ME",
      "- `-----" + "BEGIN`",
      "- Google keys: `AIza` followed by 35 key characters",
      JSON.stringify(Array.from({ length: 32 }, () => 7)),
    ].join("\n");
    expect(scanText("CLAUDE.md", text)).toEqual([]);
  });
});

describe("check-env", () => {
  test("statusOf reports present, missing, placeholder and default", () => {
    expect(statusOf("value", true)).toBe("present");
    expect(statusOf(undefined, true)).toBe("missing");
    expect(statusOf("  ", true)).toBe("missing");
    expect(statusOf(undefined, false)).toBe("default");
    expect(statusOf("https://x/?api-key=REPLACE_ME", true)).toBe("placeholder");
  });

  test("flags non-devnet RPC URLs and keys in NEXT_PUBLIC_ variables", () => {
    expect(safetyProblems({ SOLANA_RPC_URL: "https://devnet.helius-rpc.com/?api-key=abc" })).toEqual([]);
    expect(safetyProblems({ SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=abc" })).toHaveLength(1);
    expect(safetyProblems({ NEXT_PUBLIC_RPC_URL: "https://devnet.helius-rpc.com/?api-key=abc" })).toHaveLength(1);
    expect(safetyProblems({ NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet" })).toHaveLength(1);
  });

  test("safety messages never include the value", () => {
    const secretish = "https://mainnet.example/?api-key=" + fakeUuid;
    const messages = safetyProblems({ SOLANA_RPC_URL: secretish, NEXT_PUBLIC_X: secretish }).join(" ");
    expect(messages).not.toContain(fakeUuid);
  });
});
