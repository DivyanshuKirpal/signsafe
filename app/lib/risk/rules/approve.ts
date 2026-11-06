/**
 * R-APPROVE (instructions) and R-DELEGATE-STATE (account state).
 *
 * Fires when a token account gets a delegate that is not the account's owner.
 * The owner and balance come from the token account's state BEFORE the
 * transaction; the instruction's own "owner" field is only a fallback when the
 * state could not be fetched.
 *
 * Severity: DANGER if the allowance is unlimited (u64 max) or at least
 * approveDangerPct of the balance; otherwise CAUTION. Both rules use the same
 * key per token account, so the engine merges them into one flag.
 */
import { U64_MAX } from "../../config";
import type { FlagSource, Severity } from "../../types";
import { atLeastPct, big, changeSource, floorPct, isTokenIx, ixSource, type RawFlag, type RiskContext, short, tokenText } from "../context";

interface Approval {
  account: string;
  delegate: string;
  owner: string | undefined;
  allowance: bigint;
  balance: bigint | undefined;
  decimals: number | undefined;
}

function severityOf(a: Approval, dangerPct: bigint): Severity {
  if (a.allowance === U64_MAX) return "danger";
  if (a.balance === undefined) return "caution";
  return atLeastPct(a.allowance, a.balance, dangerPct) ? "danger" : "caution";
}

function flagFor(ruleId: "R-APPROVE" | "R-DELEGATE-STATE", a: Approval, source: FlagSource, ctx: RiskContext): RawFlag {
  const severity = severityOf(a, ctx.thresholds.approveDangerPct);
  const unlimited = a.allowance === U64_MAX;
  const amount = tokenText(a.allowance, a.decimals);
  const owner = a.owner ? short(a.owner) : "its owner";

  let share = "";
  if (a.balance === undefined) share = " The current balance could not be checked.";
  else if (a.balance === 0n) share = " The account is empty now, so this covers tokens that arrive later.";
  else if (!unlimited) share = ` That is ${floorPct(a.allowance, a.balance)} of its current balance of ${tokenText(a.balance, a.decimals)}.`;

  const title = unlimited
    ? "Unlimited permission to spend tokens from a token account"
    : severity === "danger"
      ? "Permission to spend most of a token balance"
      : "Permission to spend some of a token balance";

  const evidence: Record<string, string> = {
    tokenAccount: a.account,
    delegate: a.delegate,
    allowance: amount,
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
    const owner = pre?.owner ?? ix.accounts.owner;
    if (delegate === owner) continue;
    const decimals = pre?.decimals ?? (typeof ix.args.decimals === "number" ? ix.args.decimals : ix.token?.decimals);
    flags.push(
      flagFor("R-APPROVE", { account, delegate, owner, allowance, balance: big(pre?.amount), decimals }, ixSource(ix), ctx),
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
