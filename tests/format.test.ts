import { describe, expect, test } from "vitest";
import { U64_MAX } from "../app/lib/config";
import {
  formatSol,
  formatTokenAmount,
  formatUnits,
  isU64Max,
  shortAddress,
} from "../app/lib/solana/format";
import { stringifyJson, toJsonSafe } from "../app/lib/util/bigint-json";
import {
  KNOWN_PROGRAMS,
  UNKNOWN_PROGRAM_NAME,
  isTokenProgram,
  lookupProgram,
} from "../app/lib/solana/programs";

describe("formatUnits (integer math)", () => {
  test("u64 max with 0, 6 and 9 decimals keeps every digit", () => {
    expect(U64_MAX.toString()).toBe("18446744073709551615");
    expect(formatUnits(U64_MAX, 0)).toBe("18,446,744,073,709,551,615");
    expect(formatUnits(U64_MAX, 6)).toBe("18,446,744,073,709.551615");
    expect(formatUnits(U64_MAX, 9)).toBe("18,446,744,073.709551615");
  });

  test("SOL amounts with 9 decimals", () => {
    expect(formatUnits(10_000_000n, 9)).toBe("0.01");
    expect(formatUnits(1_000_000_000n, 9)).toBe("1");
    expect(formatUnits(1n, 9)).toBe("0.000000001");
    expect(formatUnits(0n, 9)).toBe("0");
    expect(formatUnits(1_234_500_000_000n, 9)).toBe("1,234.5");
  });

  test("negative deltas keep their sign", () => {
    expect(formatUnits(-10_005_000n, 9)).toBe("-0.010005");
  });

  test("rejects invalid decimals", () => {
    expect(() => formatUnits(1n, -1)).toThrow(RangeError);
    expect(() => formatUnits(1n, 1.5)).toThrow(RangeError);
  });

  test("formatSol and formatTokenAmount", () => {
    expect(formatSol(10_000_000n)).toBe("0.01 SOL");
    expect(formatTokenAmount(U64_MAX)).toBe("UNLIMITED (u64 max)");
    expect(formatTokenAmount(U64_MAX, 6)).toBe("UNLIMITED (u64 max)");
    expect(formatTokenAmount(1_500_000n)).toBe("1,500,000 raw units");
    expect(formatTokenAmount(1_500_000n, 6)).toBe("1.5 tokens");
    expect(isU64Max(U64_MAX)).toBe(true);
    expect(isU64Max(U64_MAX - 1n)).toBe(false);
  });

  test("shortAddress", () => {
    expect(shortAddress("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin")).toBe("9xQe...VFin");
    expect(shortAddress("short")).toBe("short");
  });
});

describe("BigInt JSON helpers", () => {
  test("toJsonSafe converts nested bigints to strings", () => {
    const value = { a: U64_MAX, list: [1n, { b: -5n }], s: "x", n: 1, nil: null };
    expect(toJsonSafe(value)).toEqual({
      a: "18446744073709551615",
      list: ["1", { b: "-5" }],
      s: "x",
      n: 1,
      nil: null,
    });
  });

  test("stringifyJson does not throw on bigint", () => {
    expect(() => JSON.stringify({ a: 1n })).toThrow();
    expect(stringifyJson({ a: U64_MAX })).toBe('{"a":"18446744073709551615"}');
  });
});

describe("known-program registry", () => {
  test("addresses match ARCHITECTURE section 17", () => {
    const expected: Record<string, string> = {
      system: "11111111111111111111111111111111",
      token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      computeBudget: "ComputeBudget111111111111111111111111111111",
      memo: "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH",
      memoV2: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      memoV1: "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
      addressLookupTable: "AddressLookupTab1e1111111111111111111111111",
    };
    expect(Object.fromEntries(KNOWN_PROGRAMS.map((p) => [p.key, p.address]))).toEqual(expected);
  });

  test("lookup and token-program helpers", () => {
    expect(lookupProgram("11111111111111111111111111111111")?.name).toBe("System Program");
    expect(lookupProgram("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH")).toBeUndefined();
    expect(UNKNOWN_PROGRAM_NAME).toBe("Unknown program");
    expect(isTokenProgram("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).toBe(true);
    expect(isTokenProgram("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")).toBe(true);
    expect(isTokenProgram("11111111111111111111111111111111")).toBe(false);
  });
});
