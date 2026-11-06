/**
 * R-APPROVE (instructions) and R-DELEGATE-STATE (account state).
 *
 * Fires when a token account gets a delegate that is not the account's owner.
 * The owner and balance come from the token account's state BEFORE the
 * transaction; the instruction's own "owner" field is only a fallback when the
 * state could not be fetched.
 *
 * Severity: see approvalSeverity. Both rules use the same key per token
 * account, so the engine merges them into one flag. A zero allowance never
 * fires. When the token account's state before the transaction is missing,
 * the check is reported as incomplete (missingState -> R-UNRESOLVED).
 */
import { U64_MAX } from "../../config";
import type { FlagSource, Severity } from "../../types";
import {
  atLeastPct,
  big,
  changeSource,
  floorPct,
  isTokenIx,
  ixSource,
  missingState,
  type RawFlag,
  type RiskContext,
  short,
  tokenText,
} from "../context";

interface Approval {
  account: string;
  delegate: string;
  owner: string | undefined;
  allowance: bigint;
  balance: bigint | undefined;
  decimals: number | undefined;
}

/**
 * Unlimited: DANGER, whatever the balance.
 * Known empty account (balance 0): a finite allowance is CAUTION; it covers
 * only tokens that arrive later, up to the exact amount shown.
 * Unknown balance: CAUTION here, and the rule also reports the missing state
 * (R-UNRESOLVED), so the verdict cannot fall to "Caution" on a guess.
 * Otherwise: DANGER at >= approveDangerPct of the balance, else CAUTION.
 */
export function approvalSeverity(allowance: bigint, balance: bigint | undefined, dangerPct: bigint): Severity {
  if (allowance === U64_MAX) return "danger";
  if (balance === undefined || balance === 0n) return "caution";
  return atLeastPct(allowance, balance, dangerPct) ? "danger" : "caution";
}

function flagFor(ruleId: "R-APPROVE" | "R-DELEGATE-STATE", a: Approval, source: FlagSource, ctx: RiskContext): RawFlag {
  const severity = approvalSeverity(a.allowance, a.balance, ctx.thresholds.approveDangerPct);
  const unlimited = a.allowance === U64_MAX;
  const amount = tokenText(a.allowance, a.decimals);
  const owner = a.owner ? short(a.owner) : "its owner";

  let share = "";
  if (a.balance === undefined) share = " Its balance before the transaction could not be checked.";
  else if (a.balance === 0n) {
    share = unlimited
      ? " The account is empty now, so this covers any tokens that arrive later, without limit."
      : ` The account is empty now, so this covers up to exactly ${amount} of tokens that arrive later.`;
  } else if (!unlimited) share = ` That is ${floorPct(a.allowance, a.balance)} of its current balance of ${tokenText(a.balance, a.decimals)}.`;

  const title = unlimited
    ? "Unlimited permission to spend tokens from a token account"
    : severity === "danger"
      ? "Permission to spend most of a token balance"
      : "Permission to spend some of a token balance";

  const evidence: Record<string, string> = {
    tokenAccount: a.account,
    delegate: a.delegate,
    allowance: amount,
    // The exact integer the permission is for, before any decimal formatting.
    allowanceRaw: a.allowance.toString(),
  };
  if (a.owner) evidence.owner = a.owner;
  if (a.balance !== undefined) evidence.balanceBefore = tokenText(a.balance, a.decimals);

  return {
    key: `approve:${a.account}`,
    ruleId,
    severity,
    title,
    detail:
      `${short(a.delegate)} would be allowed to move ${amount} from token account ${short(a.account)} ` +
      `(owned by ${owner}) at any time, without asking again.${share} ` +
      "No tokens move when this is signed, so balance previews show nothing.",
    account: a.account,
    evidence,
    sources: [source],
  };
}

export function approveRule(ctx: RiskContext): RawFlag[] {
  const flags: RawFlag[] = [];

  for (const ix of ctx.instructions) {
    if (!isTokenIx(ix) || (ix.action !== "approve" && ix.action !== "approveChecked")) continue;
    const account = ix.accounts.source;
    const delegate = ix.accounts.delegate;
    const allowance = big(ix.args.amount);
    if (!account || !delegate || allowance === undefined || allowance === 0n) continue;
    const pre = ctx.pre.get(account)?.token;
    // Missing state makes the check incomplete. The instruction's owner is then the fallback:
    // the runtime only accepts an Approve signed by the real owner, so a false claim cannot land.
    const gap = pre ? [] : [missingState(account, "owner and token balance")];
    const owner = pre?.owner ?? ix.accounts.owner;
    if (delegate === owner) {
      flags.push(...gap);
      continue;
    }
    const decimals = pre?.decimals ?? (typeof ix.args.decimals === "number" ? ix.args.decimals : ix.token?.decimals);
    flags.push(
      flagFor("R-APPROVE", { account, delegate, owner, allowance, balance: big(pre?.amount), decimals }, ixSource(ix), ctx),
      ...gap,
    );
  }

  for (const change of ctx.changes) {
    if (change.kind !== "delegate" || !change.after) continue;
    const before = big(change.allowanceBefore) ?? 0n;
    const allowance = big(change.allowanceAfter) ?? 0n;
    const newDelegate = change.after !== change.before;
    if (allowance === 0n || (!newDelegate && allowance <= before)) continue;
    const pre = ctx.pre.get(change.address)?.token;
    const owner = pre?.owner ?? change.tokenAccountOwner;
    if (change.after === owner) continue;
    flags.push(
      flagFor(
        "R-DELEGATE-STATE",
        { account: change.address, delegate: change.after, owner, allowance, balance: big(pre?.amount), decimals: pre?.decimals ?? change.decimals },
        changeSource(change),
        ctx,
      ),
    );
  }
  return flags;
}
