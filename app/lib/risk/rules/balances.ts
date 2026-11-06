/**
 * R-OUTFLOW (account state), R-CLOSE-ACCOUNT (instructions), R-HIGH-FEE
 * (compute budget).
 *
 * R-OUTFLOW: a signer losing at least outflowDangerPct of a SOL or token
 * balance is DANGER, at least outflowCautionPct is CAUTION. SOL deltas include
 * the network fee, so a drain through a huge fee is caught too. SOL balances
 * below the dust floor are ignored.
 *
 * R-CLOSE-ACCOUNT: closing a token account and sending its SOL to an address
 * other than the account's owner is CAUTION.
 *
 * R-HIGH-FEE (Should): a priority fee above feeCautionLamports is CAUTION.
 * legacy/v0: limit x price (micro-lamports) / 1,000,000, rounded up; the limit
 * defaults to 200,000 per instruction (capped at 1,400,000) when none is set.
 * v1: the total priority fee from the message config.
 */
import type { DecodedTx } from "../../types";
import { atLeastPct, big, changeSource, floorPct, isTokenIx, ixSource, missingState, programKey, type RawFlag, type RiskContext, short, solText, tokenText } from "../context";

export function outflowRule(ctx: RiskContext): RawFlag[] {
  const { outflowDangerPct, outflowCautionPct, outflowDustLamports } = ctx.thresholds;
  const flags: RawFlag[] = [];
  for (const change of ctx.changes) {
    const isSol = change.kind === "sol" && ctx.signers.has(change.address);
    const tokenOwner = ctx.pre.get(change.address)?.token?.owner ?? change.tokenAccountOwner;
    const isToken = change.kind === "token" && tokenOwner !== undefined && ctx.signers.has(tokenOwner);
    if (!isSol && !isToken) continue;

    const before = big(change.before);
    const after = big(change.after);
    if (before === undefined || after === undefined || before <= 0n) continue;
    if (isSol && before < outflowDustLamports) continue;
    const loss = before - after;
    if (loss <= 0n) continue;

    const severity = atLeastPct(loss, before, outflowDangerPct)
      ? "danger"
      : atLeastPct(loss, before, outflowCautionPct)
        ? "caution"
        : null;
    if (!severity) continue;

    const amounts = isSol
      ? `${solText(before)} -> ${solText(after)}`
      : `${tokenText(before, change.decimals)} -> ${tokenText(after, change.decimals)}`;
    const who = isSol ? `Signer ${short(change.address)}` : `Token account ${short(change.address)} of signer ${short(tokenOwner ?? "")}`;
    const feeNote = change.includesFeeLamports ? `, including the network fee of ${solText(BigInt(change.includesFeeLamports))}` : "";
    flags.push({
      key: `outflow:${change.address}:${change.kind}`,
      ruleId: "R-OUTFLOW",
      severity,
      title: severity === "danger" ? "Empties most of a balance" : "Moves a large part of a balance",
      detail: `${who} would lose ${floorPct(loss, before)} of its ${isSol ? "SOL" : "token"} balance (${amounts}${feeNote}).`,
      account: change.address,
      evidence: { account: change.address, before: isSol ? solText(before) : tokenText(before, change.decimals), after: isSol ? solText(after) : tokenText(after, change.decimals), loss: floorPct(loss, before) },
      sources: [changeSource(change)],
    });
  }
  return flags;
}

export function closeAccountRule(ctx: RiskContext): RawFlag[] {
  const flags: RawFlag[] = [];
  for (const ix of ctx.instructions) {
    if (!isTokenIx(ix) || ix.action !== "closeAccount") continue;
    const account = ix.accounts.account;
    const destination = ix.accounts.destination;
    if (!account || !destination) continue;
    const preOwner = ctx.pre.get(account)?.token?.owner;
    if (!preOwner) flags.push(missingState(account, "owner"));
    // Fallback to the instruction's owner (the runtime requires that owner's signature).
    const owner = preOwner ?? ix.accounts.owner;
    if (!owner || destination === owner) continue;
    flags.push({
      key: `close:${account}`,
      ruleId: "R-CLOSE-ACCOUNT",
      severity: "caution",
      title: "Closes a token account and sends its SOL elsewhere",
      detail: `Token account ${short(account)} (owned by ${short(owner)}) would be closed and the SOL held in it sent to ${short(destination)}, not to its owner. This is a common step in wallet-draining transactions.`,
      account,
      evidence: { tokenAccount: account, owner, destination },
      sources: [ixSource(ix)],
    });
  }
  return flags;
}

/** Priority fee in lamports requested by the transaction, if any. */
export function priorityFeeLamports(decoded: DecodedTx, ctx: RiskContext): bigint | undefined {
  const { budget } = decoded;
  if (budget.priorityFeeLamports !== undefined) return big(budget.priorityFeeLamports);
  const price = big(budget.computeUnitPriceMicroLamports);
  if (price === undefined) return undefined;
  const others = BigInt(decoded.instructions.filter((ix) => programKey(ix) !== "computeBudget").length);
  const fallback = others * ctx.thresholds.defaultComputeUnitsPerInstruction;
  const limit = budget.computeUnitLimit !== undefined
    ? BigInt(budget.computeUnitLimit)
    : fallback < ctx.thresholds.maxComputeUnits ? fallback : ctx.thresholds.maxComputeUnits;
  return (price * limit + 999_999n) / 1_000_000n;
}

export function highFeeRule(ctx: RiskContext): RawFlag[] {
  const fee = priorityFeeLamports(ctx.decoded, ctx);
  if (fee === undefined || fee <= ctx.thresholds.feeCautionLamports) return [];
  const budgetIxs = ctx.decoded.instructions.filter((ix) => programKey(ix) === "computeBudget");
  return [
    {
      key: "high-fee",
      ruleId: "R-HIGH-FEE",
      severity: "caution",
      title: "Unusually high priority fee",
      detail: `This transaction offers a priority fee of about ${solText(fee)}, above SignSafe's limit of ${solText(ctx.thresholds.feeCautionLamports)}. The fee payer pays it whether or not the transaction succeeds.`,
      evidence: { priorityFee: solText(fee) },
      sources: budgetIxs.length > 0
        ? budgetIxs.map(ixSource)
        : [{ type: "transaction", description: `Priority fee set in the v1 message config: ${solText(fee)}` }],
    },
  ];
}
