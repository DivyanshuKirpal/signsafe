/**
 * State diff (ARCHITECTURE section 9.3): compares each watched account before
 * and after simulation. Pure function, no network.
 *
 * It reports what changed, not whether it is risky; the rules (M3) decide that.
 * An approval moves no tokens, so its only trace is the delegate change.
 */
import type { StateChange } from "../types";
import type { AccountSnapshot } from "./accounts";

export interface DiffContext {
  feePayer: string;
  /** Network fee reported by the simulation, if known. */
  feeLamports?: bigint;
}

function str(value: bigint): string {
  return value.toString();
}

export function diffAccount(
  address: string,
  before: AccountSnapshot | null,
  after: AccountSnapshot | null,
  ctx: DiffContext,
): StateChange[] {
  const changes: StateChange[] = [];
  if (!before && !after) return changes;

  // Existence.
  if (!before && after) changes.push({ address, kind: "created", before: null, after: after.owner });
  if (before && !after) changes.push({ address, kind: "closed", before: before.owner, after: null });

  // SOL balance (a missing account counts as 0 lamports).
  const lamportsBefore = before?.lamports ?? 0n;
  const lamportsAfter = after?.lamports ?? 0n;
  if (lamportsBefore !== lamportsAfter) {
    const change: StateChange = {
      address,
      kind: "sol",
      before: str(lamportsBefore),
      after: str(lamportsAfter),
      delta: str(lamportsAfter - lamportsBefore),
    };
    if (address === ctx.feePayer && ctx.feeLamports !== undefined) {
      change.includesFeeLamports = str(ctx.feeLamports);
    }
    changes.push(change);
  }

  // The program that owns the account (System Assign shows up here).
  if (before && after && before.owner !== after.owner) {
    changes.push({ address, kind: "programOwner", before: before.owner, after: after.owner });
  }

  // Token account fields.
  const tb = before?.token;
  const ta = after?.token;
  if (tb || ta) {
    const mint = ta?.mint ?? tb?.mint;
    const decimals = ta?.decimals ?? tb?.decimals;
    const common = { address, mint, decimals, tokenAccountOwner: tb?.owner ?? ta?.owner };

    const amountBefore = tb?.amount ?? 0n;
    const amountAfter = ta?.amount ?? 0n;
    if (amountBefore !== amountAfter) {
      changes.push({
        ...common,
        kind: "token",
        before: str(amountBefore),
        after: str(amountAfter),
        delta: str(amountAfter - amountBefore),
      });
    }

    const delegateBefore = tb?.delegate ?? null;
    const delegateAfter = ta?.delegate ?? null;
    const allowanceBefore = tb?.delegatedAmount ?? 0n;
    const allowanceAfter = ta?.delegatedAmount ?? 0n;
    if (tb && ta && (delegateBefore !== delegateAfter || allowanceBefore !== allowanceAfter)) {
      changes.push({
        ...common,
        kind: "delegate",
        before: delegateBefore,
        after: delegateAfter,
        allowanceBefore: str(allowanceBefore),
        allowanceAfter: str(allowanceAfter),
      });
    }

    if (tb && ta && tb.owner !== ta.owner) {
      changes.push({ ...common, kind: "tokenOwner", before: tb.owner, after: ta.owner });
    }
    if (tb && ta && tb.closeAuthority !== ta.closeAuthority) {
      changes.push({ ...common, kind: "closeAuthority", before: tb.closeAuthority, after: ta.closeAuthority });
    }
  }
  return changes;
}

/** Diffs every watched address, in watch-list order. */
export function diffStates(
  watched: readonly string[],
  pre: ReadonlyMap<string, AccountSnapshot | null>,
  post: ReadonlyMap<string, AccountSnapshot | null>,
  ctx: DiffContext,
): StateChange[] {
  return watched.flatMap((address) => diffAccount(address, pre.get(address) ?? null, post.get(address) ?? null, ctx));
}
