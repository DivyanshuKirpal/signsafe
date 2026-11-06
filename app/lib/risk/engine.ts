/**
 * Rules engine and verdict (ARCHITECTURE sections 9.4 and 9.5).
 *
 *   flags   = every rule's output, merged per key (one flag per account per kind
 *             of problem; evidence and sources combined, highest severity kept)
 *   verdict = DANGER  if any flag is danger
 *             UNKNOWN if R-SIM-FAILED or R-UNRESOLVED fired (the check is incomplete)
 *             CAUTION if any flag is caution
 *             LOW_RISK otherwise
 *
 * Pure: no network, no AI. The user's own address is not an input.
 */
import type { DecodedTx, RiskFlag, RuleId, Severity, SimulationResult, Verdict, VerdictLevel } from "../types";
import { buildContext, type RawFlag, type RiskContext, type Rule } from "./context";
import { approveRule } from "./rules/approve";
import { assignRule, setAuthorityRule } from "./rules/authority";
import { closeAccountRule, highFeeRule, outflowRule } from "./rules/balances";
import { durableNonceRule, memoRule, simFailedRule, unknownProgramRule, unresolvedRule } from "./rules/visibility";
import { VERDICT_LABELS, VERDICT_REASONS } from "./templates";

export const RULES: readonly Rule[] = [
  approveRule,
  setAuthorityRule,
  assignRule,
  outflowRule,
  closeAccountRule,
  unknownProgramRule,
  durableNonceRule,
  highFeeRule,
  simFailedRule,
  unresolvedRule,
  memoRule,
];

const RANK: Record<Severity, number> = { info: 0, caution: 1, danger: 2 };
/** Rules whose firing means part of the transaction could not be checked. */
const INCOMPLETE_RULES: ReadonlySet<RuleId> = new Set(["R-SIM-FAILED", "R-UNRESOLVED"]);

/** Combines flags that describe the same problem (same key). */
export function mergeFlags(raw: readonly RawFlag[]): RiskFlag[] {
  const merged = new Map<string, RawFlag>();
  for (const flag of raw) {
    const existing = merged.get(flag.key);
    if (!existing) {
      merged.set(flag.key, { ...flag, sources: [...flag.sources] });
      continue;
    }
    // The higher-severity flag provides the wording; on a tie the first one wins.
    const [primary, secondary] = RANK[flag.severity] > RANK[existing.severity] ? [flag, existing] : [existing, flag];
    const seen = new Set<string>();
    const sources = [...existing.sources, ...flag.sources].filter((s) => {
      const id = JSON.stringify(s);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const related = new Set<RuleId>([...(existing.relatedRuleIds ?? []), ...(flag.relatedRuleIds ?? []), existing.ruleId, flag.ruleId]);
    related.delete(primary.ruleId);
    merged.set(flag.key, {
      ...primary,
      relatedRuleIds: related.size > 0 ? [...related] : undefined,
      evidence: { ...secondary.evidence, ...primary.evidence },
      sources,
    });
  }
  // Most severe first; otherwise keep rule order.
  return [...merged.values()]
    .map((flag, index) => ({ flag, index }))
    .sort((a, b) => RANK[b.flag.severity] - RANK[a.flag.severity] || a.index - b.index)
    .map(({ flag }) => {
      const { key: _key, ...rest } = flag;
      void _key;
      if (!rest.relatedRuleIds) delete rest.relatedRuleIds;
      return rest;
    });
}

export function runRules(ctx: RiskContext): RiskFlag[] {
  return mergeFlags(RULES.flatMap((rule) => rule(ctx)));
}

function isIncomplete(flag: RiskFlag): boolean {
  return INCOMPLETE_RULES.has(flag.ruleId) || (flag.relatedRuleIds ?? []).some((r) => INCOMPLETE_RULES.has(r));
}

/** DANGER > UNKNOWN > CAUTION > LOW_RISK. */
export function decideVerdict(flags: RiskFlag[]): Verdict {
  const danger = flags.find((f) => f.severity === "danger");
  const incomplete = flags.some(isIncomplete);
  const caution = flags.find((f) => f.severity === "caution");

  let level: VerdictLevel;
  let reason: string;
  if (danger) {
    level = "DANGER";
    reason = danger.title;
  } else if (incomplete) {
    level = "UNKNOWN";
    reason = VERDICT_REASONS.UNKNOWN;
  } else if (caution) {
    level = "CAUTION";
    reason = caution.title;
  } else {
    level = "LOW_RISK";
    reason = VERDICT_REASONS.LOW_RISK;
  }
  return { level, label: VERDICT_LABELS[level], reason, complete: !incomplete, flags };
}

/** Rules + verdict for one analysed transaction. */
export function assessRisk(decoded: DecodedTx, simulation: SimulationResult): Verdict {
  return decideVerdict(runRules(buildContext(decoded, simulation)));
}
