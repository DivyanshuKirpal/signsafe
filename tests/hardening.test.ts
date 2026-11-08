/**
 * Fixes from docs/SECURITY_REVIEW.md (step between M6 and M7), all offline:
 *   M2 decode limits and capped AI facts, M3 lookup tables (cap, one RPC call),
 *   M4 demo-build rate limit, M5 every RPC endpoint checked against devnet's
 *   genesis hash before use, L1 no signatures sent to the RPC, L5 JSON only,
 *   L6 no-framing and nosniff headers.
 */
import {
  AccountRole,
  appendTransactionMessageInstructions,
  blockhash,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../next.config";
import { POST as analyzePost } from "../app/api/analyze/route";
import { POST as scenariosPost } from "../app/api/scenarios/route";
import { buildExplanationContext } from "../app/lib/ai/facts";
import { buildUserPrompt } from "../app/lib/ai/prompt";
import { analyzeTransaction } from "../app/lib/analyze";
import { AI, LIMITS, SCENARIO_RATE_LIMIT } from "../app/lib/config";
import { resetServerState } from "../app/lib/server-state";
import { DecodeError, decodeTransaction, parseWireTransaction, withoutSignatures } from "../app/lib/solana/decode";
import {
  createFailoverTransport,
  createSignSafeRpc,
  devnetOnly,
  EndpointCheckError,
  ensureDevnet,
  lookupTableFetcher,
} from "../app/lib/solana/rpc";
import { BLOCKHASH, buildTxBase64, solPaymentIx } from "./helpers/build-tx";
import { DEVNET_GENESIS, fakeRpc } from "./helpers/fake-rpc";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

function compactU16(n: number): number[] {
  const out: number[] = [];
  let v = n;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if (v) out.push(b | 0x80);
    else {
      out.push(b);
      return out;
    }
  }
}

/** A hand-built legacy transaction with `n` empty System instructions (Kit refuses more than 64). */
function legacyWithInstructions(n: number): string {
  const ix = [1, 0, 0]; // program index 1 (System), no accounts, no data
  const message = [1, 0, 1, ...compactU16(2), ...new Array(32).fill(9), ...new Array(32).fill(0), ...new Array(32).fill(5)];
  const body = [...message, ...compactU16(n), ...Array.from({ length: n }, () => ix).flat()];
  return Buffer.from([...compactU16(1), ...new Array(64).fill(0), ...body]).toString("base64");
}

/** A hand-built v0 transaction that reads one account from each of `n` lookup tables. */
function v0WithLookups(n: number): string {
  const ix = [1, ...compactU16(n), ...Array.from({ length: n }, (_, i) => 2 + i), ...compactU16(0)];
  const lookups = Array.from({ length: n }, (_, i) => {
    const table = new Array(32).fill(8);
    table[0] = 1 + i;
    return [...table, ...compactU16(0), ...compactU16(1), 0];
  }).flat();
  const message = [0x80, 1, 0, 1, ...compactU16(2), ...new Array(32).fill(9), ...new Array(32).fill(3), ...new Array(32).fill(5)];
  const body = [...message, ...compactU16(1), ...ix, ...compactU16(n), ...lookups];
  return Buffer.from([...compactU16(1), ...new Array(64).fill(0), ...body]).toString("base64");
}

const fakeAddress = (tag: number, i: number) => {
  const bytes = new Uint8Array(32).fill(7);
  bytes[0] = tag;
  bytes[1] = i;
  return getAddressDecoder().decode(bytes);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M2: oversized transactions are refused before any RPC or AI work", () => {
  test("more than 64 instructions is refused; 64 is decoded", async () => {
    await expect(decodeTransaction(legacyWithInstructions(64))).resolves.toBeDefined();
    expect(() => parseWireTransaction(legacyWithInstructions(65))).toThrow(DecodeError);
    try {
      parseWireTransaction(legacyWithInstructions(65));
    } catch (error) {
      expect((error as DecodeError).code).toBe("TOO_MANY_INSTRUCTIONS");
    }
  });

  test("legacy and v0 over 1,232 bytes are refused; v1 of the same size is decoded", () => {
    const memo = getAddMemoInstruction({ memo: "x".repeat(1_300) });
    for (const version of ["legacy", 0] as const) {
      expect(() => parseWireTransaction(buildTxBase64([memo], { version }))).toThrow(/at most 1,232 bytes/);
    }
    expect(parseWireTransaction(buildTxBase64([memo], { version: 1 })).sizeBytes).toBeGreaterThan(LIMITS.maxLegacyTransactionBytes);
  });

  test("the 100-lookup-table transaction from the review is refused without fetching any table", async () => {
    const fetchLookupTables = vi.fn<(addresses: string[]) => Promise<Record<string, never>>>(async () => ({}));
    await expect(decodeTransaction(v0WithLookups(100), { fetchLookupTables })).rejects.toThrow(DecodeError);
    expect(fetchLookupTables).not.toHaveBeenCalled();
  });

  test("the route answers 400 with a plain message", async () => {
    const res = await analyzePost(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { kind: "base64", tx: legacyWithInstructions(65) } }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY_INSTRUCTIONS");
  });
});

describe("M2: the facts sent to the AI are capped", () => {
  test("64 instructions: 20 listed, the rest counted; based-on lines and gaps capped; the prompt stays small", async () => {
    const analysis = await analyzeTransaction(legacyWithInstructions(64), { rpc: null });
    const { facts } = buildExplanationContext(analysis);
    expect(facts.instructions).toHaveLength(AI.maxFactInstructions);
    expect(facts.instructionsNotListed).toBe(64 - AI.maxFactInstructions);
    for (const finding of facts.findings) expect(finding.basedOn.length).toBeLessThanOrEqual(AI.maxBasedOnLines + 1);
    expect(facts.findings.some((f) => f.basedOn.at(-1)?.startsWith("and ") && f.basedOn.at(-1)?.endsWith("more of the same kind"))).toBe(true);
    expect(facts.couldNotCheck).toHaveLength(AI.maxCouldNotCheck + 1);
    // Measured in the review: 30,132 characters before the caps.
    expect(buildUserPrompt(facts).length).toBeLessThan(AI.maxPromptChars / 2);
  });
});

describe("M3: lookup tables", () => {
  test("at most 8 distinct tables are asked for, in one call; the rest are reported as not loaded", async () => {
    const accounts = Array.from({ length: 10 }, (_, i) => ({ address: fakeAddress(1, i), role: AccountRole.READONLY }));
    const lookupTables = Object.fromEntries(accounts.map((a, i) => [fakeAddress(2, i), [a.address]]));
    const base64 = buildTxBase64([{ programAddress: fakeAddress(3, 0), accounts, data: new Uint8Array() }], { version: 0, lookupTables });
    const fetchLookupTables = vi.fn<(addresses: string[]) => Promise<Record<string, never>>>(async () => ({}));
    const decoded = await decodeTransaction(base64, { fetchLookupTables });
    expect(fetchLookupTables).toHaveBeenCalledTimes(1);
    expect(fetchLookupTables.mock.calls[0][0]).toHaveLength(LIMITS.maxLookupTables);
    const notLoaded = decoded.warnings.filter((w) => w.message.includes(`loads at most ${LIMITS.maxLookupTables} lookup tables`));
    expect(notLoaded).toHaveLength(2);
  });

  test("the fetcher makes one getMultipleAccounts call, drops duplicates and keeps only real lookup tables", async () => {
    const [t1, t2, other] = [fakeAddress(2, 1), fakeAddress(2, 2), fakeAddress(2, 3)];
    const table = (addresses: string[]) => ({
      owner: "AddressLookupTab1e1111111111111111111111111",
      lamports: 1n,
      executable: false,
      rentEpoch: 0n,
      space: 100n,
      data: { program: "address-lookup-table", parsed: { type: "lookupTable", info: { addresses } }, space: 100n },
    });
    const calls: string[] = [];
    let asked: unknown;
    const { rpc } = fakeRpc(
      {
        getMultipleAccounts: (params) => {
          asked = params[0];
          return { context: { slot: 1n }, value: [table([t2]), null, { ...table([t1]), owner: "11111111111111111111111111111111" }] };
        },
      },
      calls,
    );
    const tables = await lookupTableFetcher(rpc)([t1, t1, t2, other]);
    expect(calls).toEqual(["getMultipleAccounts"]);
    expect(asked).toEqual([t1, t2, other]);
    expect(tables).toEqual({ [t1]: [t2] }); // the second is missing, the third is not owned by the lookup-table program
  });
});

describe("M5: every RPC endpoint is checked against devnet's genesis hash before use", () => {
  /** Two fake RPC hosts behind the real HTTP transport; `behaviour` decides each host's answer per method. */
  function hosts(behaviour: Record<string, (method: string, n: number) => unknown>) {
    const seen: { host: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const { id, method } = JSON.parse(String(init.body)) as { id: unknown; method: string };
        const host = new URL(url).host;
        seen.push({ host, method });
        const result = behaviour[host](method, seen.filter((s) => s.host === host && s.method === method).length);
        if (result instanceof Error) throw result;
        return Response.json({ jsonrpc: "2.0", id, result });
      }),
    );
    return seen;
  }
  const genesisOr = (hash: string, other: (method: string, n: number) => unknown) => (method: string, n: number) =>
    method === "getGenesisHash" ? hash : other(method, n);

  test("a fallback that is not devnet never receives a request, even when the primary fails", async () => {
    const seen = hosts({
      "primary.test": genesisOr(DEVNET_GENESIS, () => new TypeError("fetch failed")),
      "fallback.test": genesisOr(MAINNET_GENESIS, () => 1),
    });
    const client = createSignSafeRpc("https://primary.test", "https://fallback.test");
    await expect(client.rpc.getSlot().send()).rejects.toBeInstanceOf(EndpointCheckError);
    expect(seen.filter((s) => s.host === "fallback.test").map((s) => s.method)).toEqual(["getGenesisHash"]);
  });

  test("a primary that is not devnet is skipped: only the devnet fallback answers", async () => {
    const seen = hosts({
      "primary.test": genesisOr(MAINNET_GENESIS, () => 7),
      "fallback.test": genesisOr(DEVNET_GENESIS, () => 42),
    });
    const client = createSignSafeRpc("https://primary.test", "https://fallback.test");
    expect(await client.rpc.getSlot().send()).toBe(42n);
    expect(client.lastEndpoint()).toBe("fallback");
    expect(seen.filter((s) => s.host === "primary.test").map((s) => s.method)).toEqual(["getGenesisHash"]);
  });

  test("no devnet endpoint: ensureDevnet is false and nothing else is ever sent", async () => {
    const seen = hosts({
      "primary.test": genesisOr(MAINNET_GENESIS, () => 1),
      "fallback.test": genesisOr(MAINNET_GENESIS, () => 1),
    });
    const client = createSignSafeRpc("https://primary.test", "https://fallback.test");
    expect(await ensureDevnet(client.rpc)).toBe(false);
    await expect(client.rpc.getSlot().send()).rejects.toBeInstanceOf(EndpointCheckError);
    expect(seen.every((s) => s.method === "getGenesisHash")).toBe(true);
  });

  test("each endpoint is checked once; a check that failed on the network is retried", async () => {
    const seen = hosts({
      "primary.test": genesisOr(DEVNET_GENESIS, () => 5),
    });
    const client = createSignSafeRpc("https://primary.test");
    await client.rpc.getSlot().send();
    await client.rpc.getSlot().send();
    expect(seen.filter((s) => s.method === "getGenesisHash")).toHaveLength(1);

    let first = true;
    const flaky = devnetOnly({
      label: "primary",
      transport: (async (config: { payload: { id: unknown; method: string } }) => {
        if (config.payload.method === "getGenesisHash" && first) {
          first = false;
          throw new TypeError("fetch failed");
        }
        return { jsonrpc: "2.0", id: config.payload.id, result: config.payload.method === "getGenesisHash" ? DEVNET_GENESIS : 9 };
      }) as unknown as Parameters<typeof devnetOnly>[0]["transport"],
    });
    const rpc = createSolanaRpcFromTransport(createFailoverTransport([flaky, flaky], () => {}, 1_000));
    expect(await rpc.getSlot().send()).toBe(9n); // first check failed on the network, the retry checked again and passed
  });
});

describe("L1: signatures never leave the server", () => {
  async function signed(version: 0 | 1): Promise<string> {
    const signer = await generateKeyPairSigner();
    const message = pipe(
      createTransactionMessage({ version }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(BLOCKHASH), lastValidBlockHeight: 1_000n }, m),
      (m) => appendTransactionMessageInstructions([getAddMemoInstruction({ memo: "signed" })], m),
    );
    const { signTransactionMessageWithSigners } = await import("@solana/kit");
    return getBase64EncodedWireTransaction(await signTransactionMessageWithSigners(message));
  }
  const messageBytesOf = (base64: string) => Array.from(getTransactionDecoder().decode(getBase64Encoder().encode(base64)).messageBytes);

  test.each([0, 1] as const)("v%s: the signature is replaced by zeros and the message is unchanged", async (version) => {
    const tx = await signed(version);
    expect(parseWireTransaction(tx).signatures.every((s) => s.present)).toBe(true);
    const stripped = withoutSignatures(tx);
    expect(parseWireTransaction(stripped).signatures.every((s) => !s.present)).toBe(true);
    expect(messageBytesOf(stripped)).toEqual(messageBytesOf(tx));
  });

  test("an unsigned transaction is sent exactly as it was pasted", () => {
    const tx = buildTxBase64([solPaymentIx()]);
    expect(withoutSignatures(tx)).toBe(tx);
  });

  test("the simulation request carries no signature", async () => {
    const tx = await signed(0);
    let simulated = "";
    const { rpc, lastEndpoint } = fakeRpc({
      getGenesisHash: () => DEVNET_GENESIS,
      getMultipleAccounts: (params) => ({ context: { slot: 1n }, value: (params[0] as unknown[]).map(() => null) }),
      simulateTransaction: (params) => {
        simulated = params[0] as string;
        const count = ((params[1] as { accounts?: { addresses: unknown[] } }).accounts?.addresses ?? []).length;
        return { context: { slot: 2n }, value: { err: null, logs: [], accounts: new Array(count).fill(null), unitsConsumed: 1n, fee: 5_000n } };
      },
    });
    await analyzeTransaction(tx, { rpc: { rpc, lastEndpoint } });
    expect(simulated).not.toBe("");
    expect(parseWireTransaction(simulated).signatures.every((s) => !s.present)).toBe(true);
    expect(messageBytesOf(simulated)).toEqual(messageBytesOf(tx));
  });
});

describe("L5: the POST routes accept JSON only", () => {
  const body = JSON.stringify({ input: { kind: "base64", tx: buildTxBase64([solPaymentIx()]) } });
  test.each([
    ["no content type", undefined],
    ["text/plain (a cross-site simple request)", "text/plain"],
    ["a form", "application/x-www-form-urlencoded"],
  ])("%s gets 415", async (_name, type) => {
    const headers: Record<string, string> = type ? { "content-type": type } : {};
    for (const [post, url] of [
      [analyzePost, "http://localhost/api/analyze"],
      [scenariosPost, "http://localhost/api/scenarios"],
    ] as const) {
      const res = await post(new Request(url, { method: "POST", headers, body }));
      expect(res.status).toBe(415);
    }
  });

  test("application/json with a charset is accepted", async () => {
    const res = await analyzePost(
      new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body }),
    );
    expect(res.status).toBe(200);
  });
});

describe("M4: demo builds are rate limited per IP", () => {
  beforeEach(() => resetServerState());

  test(`${SCENARIO_RATE_LIMIT.maxRequests} builds per minute, then 429 with Retry-After; another IP is unaffected`, async () => {
    const build = (ip: string) =>
      scenariosPost(
        new Request("http://localhost/api/scenarios", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ id: "s1-normal-payment" }),
        }),
      );
    // In tests there is no RPC, so allowed builds stop at 503 without touching the network.
    for (let i = 0; i < SCENARIO_RATE_LIMIT.maxRequests; i++) expect((await build("203.0.113.5")).status).toBe(503);
    const limited = await build("203.0.113.5");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await limited.json()) as { error: { message: string } }).error.message).toMatch(/Too many demo transactions/);
    expect((await build("198.51.100.7")).status).toBe(503);
  });
});

describe("L6 and M7: security headers", () => {
  test("every path gets no-framing, nosniff and referrer-policy headers", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });

  test("no X-Powered-By header; the data files the functions read are shipped explicitly", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/api/scenarios": ["./data/demo.devnet.json"],
      "/api/examples": ["./data/fixtures/*.json"],
    });
  });
});
