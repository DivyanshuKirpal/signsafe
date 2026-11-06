/**
 * Display formatting with integer math only. Floats would round large token
 * amounts (a u64 has 20 digits; a double keeps about 16).
 */
import { U64_MAX } from "../config";

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a raw integer amount with `decimals` decimal places, e.g.
 * formatUnits(10_000_000n, 9) === "0.01". Trailing zeros are trimmed and the
 * integer part is grouped with commas. Negative values keep their sign.
 */
export function formatUnits(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`invalid decimals: ${decimals}`);
  }
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  let text = groupThousands(whole.toString());
  if (decimals > 0 && fraction > 0n) {
    text += "." + fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  }
  return negative ? `-${text}` : text;
}

export function formatSol(lamports: bigint): string {
  return `${formatUnits(lamports, 9)} SOL`;
}

/** True for an "unlimited" SPL Token approval or transfer amount. */
export function isU64Max(raw: bigint): boolean {
  return raw === U64_MAX;
}

/**
 * Formats a token amount. Plain Transfer/Approve instructions carry no
 * decimals; until the mint is fetched, the raw integer is shown and labelled.
 */
export function formatTokenAmount(raw: bigint, decimals?: number): string {
  if (isU64Max(raw)) return "UNLIMITED (u64 max)";
  if (decimals === undefined) return `${groupThousands(raw.toString())} raw units`;
  return `${formatUnits(raw, decimals)} tokens`;
}

/** "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" -> "9xQe...VFin". */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
