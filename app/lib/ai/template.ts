/**
 * The built-in explanation (ARCHITECTURE 1.4 and 9.6): written only from the
 * rules' result with fixed sentences, so the app explains every verdict even
 * with the AI switched off, unavailable, or rejected. It follows the same
 * rules as an AI answer (tests run it through the same validator).
 */
import { FALLBACK_SENTENCES } from "../risk/templates";
import type { ExplanationContext } from "./facts";
import type { ExplanationText } from "./validate";

const ADVICE = {
  DANGER: "Do not sign this unless you are certain you want to allow exactly what is described here.",
  UNKNOWN: "Do not sign until the missing checks can be completed, unless you fully trust where this transaction came from.",
  CAUTION: "Check the details below and sign only if they match what you expect.",
  LOW_RISK: "Check that the amounts and addresses match what you expect before you sign.",
} as const;

const GAP_POINT = "Part of the transaction could not be checked; see What could not be checked.";
const MEMO_POINT = "It carries a memo written by the sender; SignSafe ignores that text when deciding.";
const NO_MOVE_POINT = "No tokens move when it is signed; the permission can be used later.";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const withoutPeriod = (s: string) => s.replace(/\.$/, "");

export function templateExplanation(context: ExplanationContext): ExplanationText {
  const { facts, meta } = context;
  const reason = withoutPeriod(lowerFirst(facts.verdict.reason));

  let summary: string;
  switch (meta.level) {
    case "DANGER":
      summary = `Danger: ${reason}.${meta.checkComplete ? "" : " Part of this transaction could not be checked."}`;
      break;
    case "UNKNOWN":
      summary = "SignSafe could not fully check this transaction, so its effects could not be confirmed.";
      break;
    case "CAUTION":
      summary = `Caution: ${reason}.`;
      break;
    case "LOW_RISK":
      summary = "SignSafe's rules found no known risks in this transaction.";
      break;
  }

  const points: string[] = [];
  for (const rule of new Set(meta.findingRules)) points.push(FALLBACK_SENTENCES[rule]);
  // An approval is permission for later, not tokens moving now.
  const approval = meta.findingRules.some((r) => r === "R-APPROVE" || r === "R-DELEGATE-STATE");
  if (approval && !meta.tokenMovement) points.push(NO_MOVE_POINT);
  for (const transfer of meta.solTransfers) points.push(`It asks to ${lowerFirst(transfer)}`);
  if (!meta.checkComplete) points.push(GAP_POINT);
  if (facts.untrusted.memos.length > 0) points.push(MEMO_POINT);

  return { summary, points: points.slice(0, 5), advice: ADVICE[meta.level] };
}
