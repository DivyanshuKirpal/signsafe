/**
 * Watch list (ARCHITECTURE section 9.3): the accounts whose state is compared
 * before and after simulation. Pure functions, no network.
 *
 *   candidates: fee payer, all signers, all resolved writable accounts, and the
 *   mint of every token account among them.
 *   cap: if there are more than `cap`, keep (1) the fee payer and signers,
 *   (2) writable token accounts owned by a signer, (3) other writable
 *   accounts, (4) mints; anything dropped is reported, never silently cut.
 */
import type { DecodedTx, WatchRole } from "../types";
import type { AccountSnapshot } from "./accounts";

export interface WatchCandidate {
  address: string;
  roles: WatchRole[];
}

function add(map: Map<string, WatchRole[]>, address: string, role: WatchRole): void {
  const roles = map.get(address);
  if (!roles) map.set(address, [role]);
  else if (!roles.includes(role)) roles.push(role);
}

/** Accounts known from decoding alone (before any state is fetched). */
export function baseCandidates(decoded: DecodedTx): WatchCandidate[] {
  const map = new Map<string, WatchRole[]>();
  add(map, decoded.feePayer, "feePayer");
  for (const signer of decoded.signers) add(map, signer, "signer");
  for (const address of decoded.writable) add(map, address, "writable");
  return [...map].map(([address, roles]) => ({ address, roles }));
}

/** Mints of token accounts found in the pre-state that are not candidates yet. */
export function mintCandidates(
  candidates: readonly WatchCandidate[],
  pre: ReadonlyMap<string, AccountSnapshot | null>,
): string[] {
  const known = new Set(candidates.map((c) => c.address));
  const mints = new Set<string>();
  for (const { address } of candidates) {
    const mint = pre.get(address)?.token?.mint;
    if (mint && !known.has(mint)) mints.add(mint);
  }
  return [...mints];
}

function priority(c: WatchCandidate, signers: ReadonlySet<string>, pre: ReadonlyMap<string, AccountSnapshot | null>): number {
  if (c.roles.includes("feePayer") || c.roles.includes("signer")) return 0;
  const tokenOwner = pre.get(c.address)?.token?.owner;
  if (c.roles.includes("writable") && tokenOwner && signers.has(tokenOwner)) return 1;
  if (c.roles.includes("writable")) return 2;
  return 3;
}

export interface WatchSelection {
  watched: WatchCandidate[];
  dropped: WatchCandidate[];
}

/** Applies the cap with a stable priority order. */
export function selectWatched(
  candidates: readonly WatchCandidate[],
  signers: readonly string[],
  pre: ReadonlyMap<string, AccountSnapshot | null>,
  cap: number,
): WatchSelection {
  const signerSet = new Set(signers);
  const ranked = candidates
    .map((c, i) => ({ c, i, p: priority(c, signerSet, pre) }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.c);
  return { watched: ranked.slice(0, cap), dropped: ranked.slice(cap) };
}
