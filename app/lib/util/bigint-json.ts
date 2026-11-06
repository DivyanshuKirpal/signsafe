/**
 * JSON.stringify throws on BigInt. Lamports and token amounts are BigInt in
 * the code and travel as decimal strings in API responses (CLAUDE.md section 9).
 */

/** Deep-copies a value, converting every bigint to its decimal string. */
export function toJsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value instanceof Uint8Array) return Array.from(value);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = toJsonSafe(item);
    return out;
  }
  return value;
}

/** JSON.stringify that writes bigints as decimal strings. */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}
