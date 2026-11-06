/**
 * Validation of an AI answer (ARCHITECTURE 9.6): the JSON shape AND the
 * meaning. An answer is used only if it:
 *   - has the shape { summary (<= 2 sentences), points (<= 5, <= 25 words each), advice (1 sentence) },
 *     in plain text (no markdown, links or emojis);
 *   - never implies a guarantee ("safe", "guaranteed", "verified", ...);
 *   - gives signing advice consistent with the verdict and does not downplay a Danger
 *     (or claim danger when no rule fired);
 *   - mentions only amounts, percentages and addresses that appear in the trusted facts;
 *   - does not invent transfers: tokens or SOL "moving" when the facts show only a
 *     permission to move them later (an approval) is rejected;
 *   - says the check is incomplete when it is, and never presents unverified effects as confirmed;
 *   - covers every finding (and a SOL transfer, e.g. S3's small payment).
 * Anything else is rejected and the built-in explanation is shown instead.
 */
import { z } from "zod";
import { AI } from "../config";
import { sanitizeUntrustedText } from "../solana/instructions";
import type { RuleId } from "../types";
import { type ExplanationMeta, toNumber } from "./facts";

export type RejectCode =
  | "INVALID_JSON"
  | "SCHEMA"
  | "FORMAT"
  | "GUARANTEE"
  | "SIGNING_ADVICE"
  | "DOWNPLAYS_RISK"
  | "CLAIMS_RISK"
  | "UNGROUNDED_AMOUNT"
  | "UNGROUNDED_ADDRESS"
  | "INVENTED_TRANSFER"
  | "UNVERIFIED_AS_CONFIRMED"
  | "MISSING_COVERAGE";

export interface ExplanationText {
  summary: string;
  points: string[];
  advice: string;
}

export type ValidationResult = { ok: true; value: ExplanationText } | { ok: false; code: RejectCode; detail: string };

const AnswerSchema = z.object({
  summary: z.string(),
  points: z.array(z.string()),
  advice: z.string(),
});

const reject = (code: RejectCode, detail: string): ValidationResult => ({ ok: false, code, detail });

/** Same cleaning as untrusted on-chain text: control and direction-override characters out, whitespace collapsed. */
function clean(text: string, max: number): string {
  return sanitizeUntrustedText(text, max).text.replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const NEGATION = /\b(not|no|never|without|nor|cannot|can't|don't|doesn't|isn't|aren't|won't|couldn't|wouldn't|shouldn't|avoid|unless)\b|n't\b/i;

/** True if the pattern occurs in the sentence without a negation shortly before it. */
function claims(sentence: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  for (const m of sentence.matchAll(new RegExp(pattern.source, flags))) {
    const before = sentence.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

// Never allowed, at any verdict (the UI never calls a transaction safe or guaranteed).
const ALWAYS_BANNED = /\b(safe|safely|safety|safer|guarantee[sd]?|risk[- ]free|zero risk|nothing can go wrong|cannot lose|can't lose|perfectly fine|completely fine|totally fine)\b/i;
// Trust claims, allowed only when negated ("could not be verified").
const TRUST_CLAIM = /\b(verified|certified|audited|trusted|trustworthy|official|legitimate|legit)\b/i;
// Direct encouragement: rejected for any verdict other than LOW_RISK unless negated.
const ENCOURAGE_DIRECT = /\b(go ahead|feel free|nothing to worry|no need to worry|no worries|fine to sign|ok to sign|okay to sign)\b/i;
// Reassurance: rejected unless negated or contrasted ("the payment looks fine, but ...").
const REASSURE = /\b(looks fine|looks good|looks legit\w*|looks normal|all good)\b/i;
const CONTRAST = /\b(but|however|although|though|yet|while)\b/i;
// Telling the user to sign: rejected unless negated or conditional ("only sign if ...", "before you sign ...").
// Descriptive mentions ("no tokens move when you sign this approval") are not instructions and pass.
const ENCOURAGE_WEAK = [
  /\byou (can|may|should|could) (go on and |safely |now |just )?(sign|approve|proceed)\b/i,
  /^\s*(please\s+|just\s+|so\s+)?(sign|approve|proceed)\b/i,
  /\bproceed with (signing|it|the transaction|this transaction)\b/i,
  /\bit(?:'s| is) (ok|okay|fine|reasonable|alright) to (sign|approve|proceed)\b/i,
];
const CONDITIONAL = /\b(if|unless|until|only|before|after|when|once)\b/i;
const DOWNPLAY = /\b(harmless|low[- ]risk|no (known )?risks?|nothing (suspicious|dangerous|unusual|wrong)|not dangerous|benign|minor issue)\b/i;
const RISK_CLAIM = /\b(danger(ous)?|scam\w*|drain(s|ed|er|ing)?|steal(s|ing)?|stolen|malicious|attacker|fraud\w*|phishing|takeover)\b/i;
const ADVICE_CUE: Record<ExplanationMeta["level"], RegExp | null> = {
  DANGER: /\b(do not|don't|never|avoid|unless|only if|only sign|reject|decline|cancel|not sign)\b/i,
  UNKNOWN: /\b(do not|don't|never|avoid|unless|until|only|wait|reject|decline|cancel|not sign|check|verify)\b/i,
  CAUTION: /\b(check|review|verify|confirm|make sure|only|unless|careful|before|do not|don't)\b/i,
  LOW_RISK: null,
};
const HEDGE = /\b(could not|couldn't|cannot|can't|unable to|not be (checked|confirmed|verified|read|seen)|not (fully )?(checked|confirmed|verified|simulated)|unconfirmed|unverified|incomplete|did not run|failed)\b/i;
const SIM_CONFIRMS = /\bsimulat\w*\b[^.]{0,60}\b(shows?|showed|confirms?|confirmed|proves?|proved)\b/gi;

/** "The simulation confirms X" is a claim; "the simulation failed, so X could not be confirmed" is not. */
function simulationClaimsConfirmation(sentence: string): boolean {
  for (const m of sentence.matchAll(SIM_CONFIRMS)) {
    const before = sentence.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    if (!NEGATION.test(before) && !NEGATION.test(m[0]) && !/\bfail/i.test(m[0])) return true;
  }
  return false;
}

const MOVE_VERB = /\b(transfer(s|red|ring)?|send(s|ing)?|sent|mov(e|es|ed|ing)|tak(e|es|en|ing)|took|drain(s|ed|ing)?|withdr(aw|aws|awn|ew)|steal(s|ing)?|stole|stolen|empt(y|ies|ied))\b/i;
const MODAL = /\b(can|could|may|might|able to|allow(s|ed|ing)?|let(s)?|permission|permit(s|ted)?|approv\w*|delegat\w*|later|future|any ?time|at will|without asking)\b/i;
const TOKEN_WORD = /\b(tokens?|USDC|DEMO)\b/i;
const SOL_WORD = /\bSOL\b/;

const COVERAGE: Partial<Record<RuleId, RegExp>> = {
  "R-APPROVE": /\b(permission|approv\w*|allow\w*|spend|delegate\w*)\b/i,
  "R-DELEGATE-STATE": /\b(permission|approv\w*|allow\w*|spend|delegate\w*)\b/i,
  "R-SET-AUTHORITY": /\b(owner\w*|control\w*|authorit\w*)\b/i,
  "R-ASSIGN": /\b(control\w*|program|assign\w*)\b/i,
  "R-OUTFLOW": /\b(lose|loses|losing|loss|drain\w*|empt\w*|most of|balance)\b|%/i,
  "R-CLOSE-ACCOUNT": /\bclos\w*\b/i,
  "R-UNKNOWN-PROGRAM": /\b(unknown|not recogni[sz]ed|unrecogni[sz]ed|does not recogni[sz]e|doesn't recogni[sz]e|unfamiliar)\b/i,
  "R-DURABLE-NONCE": /\b(expire\w*|nonce|much later)\b/i,
  "R-HIGH-FEE": /\bfee\b/i,
};

const AMOUNT = /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(SOL|lamports?|tokens?|DEMO|USDC|raw units?)\b/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;
const SHORT_ADDRESS = /[1-9A-HJ-NP-Za-km-z]{4}\.\.\.[1-9A-HJ-NP-Za-km-z]{4}/g;
const FULL_ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

function near(value: number, candidates: number[]): boolean {
  // Allow small rounding ("about 0.04 SOL" for 0.039995 SOL), nothing more.
  return candidates.some((c) => (c === 0 ? value === 0 : Math.abs(value - c) <= Math.abs(c) * 0.02));
}

function checkGrounding(text: string, meta: ExplanationMeta): ValidationResult | null {
  const g = meta.grounding;
  if (/\$\s?\d/.test(text)) return reject("UNGROUNDED_AMOUNT", "mentions a price in dollars");
  for (const m of text.matchAll(AMOUNT)) {
    const value = toNumber(m[1]);
    const unit = m[2].toLowerCase();
    const ok =
      unit === "sol" ? near(value, g.solAmounts) : unit.startsWith("lamport") ? near(value / 1e9, g.solAmounts) : near(value, g.numbers);
    if (!ok) return reject("UNGROUNDED_AMOUNT", `amount "${m[0]}" is not in the facts`);
  }
  for (const m of text.matchAll(PERCENT)) {
    if (!g.percents.some((p) => Math.abs(p - Number(m[1])) <= 1)) return reject("UNGROUNDED_AMOUNT", `percentage "${m[0]}" is not in the facts`);
  }
  for (const m of text.matchAll(SHORT_ADDRESS)) {
    if (!g.addresses.has(m[0])) return reject("UNGROUNDED_ADDRESS", `address "${m[0]}" is not in the facts`);
  }
  for (const m of text.matchAll(FULL_ADDRESS)) {
    if (!g.addresses.has(m[0])) return reject("UNGROUNDED_ADDRESS", "a full address that is not in the facts");
  }
  return null;
}

/** Parses the model's text as JSON (the API is asked for JSON; a code fence is tolerated). */
export function parseAnswer(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

export function validateExplanation(raw: unknown, meta: ExplanationMeta): ValidationResult {
  const parsed = AnswerSchema.safeParse(raw);
  if (!parsed.success) return reject("SCHEMA", "not { summary, points[], advice }");
  const summary = clean(parsed.data.summary, 500);
  const advice = clean(parsed.data.advice, 300);
  const points = parsed.data.points.map((p) => clean(p, 300)).filter(Boolean);
  if (!summary || !advice) return reject("SCHEMA", "empty summary or advice");

  // Format.
  const all = [summary, ...points, advice];
  if (sentences(summary).length > AI.maxSummarySentences) return reject("FORMAT", "summary has more than 2 sentences");
  if (sentences(advice).length > AI.maxAdviceSentences) return reject("FORMAT", "advice is more than 1 sentence");
  if (points.length > AI.maxPoints) return reject("FORMAT", "more than 5 points");
  const long = points.find((p) => words(p) > AI.maxPointWords);
  if (long) return reject("FORMAT", `a point has ${words(long)} words`);
  if (all.some((t) => /\*\*|__|`|^\s*#|\[[^\]]*\]\(|https?:\/\/|www\.|^\s*[-*•]\s/.test(t))) {
    return reject("FORMAT", "markdown or a link");
  }
  if (all.some((t) => /\p{Extended_Pictographic}/u.test(t))) return reject("FORMAT", "an emoji");

  const text = all.join(" ");
  const sentenceList = all.flatMap(sentences);

  // Guarantees and trust claims.
  const banned = text.match(ALWAYS_BANNED);
  if (banned) return reject("GUARANTEE", `uses "${banned[0]}"`);
  if (sentenceList.some((s) => claims(s, TRUST_CLAIM))) return reject("GUARANTEE", "claims the transaction or a party is verified or trusted");

  // Consistency with the verdict.
  if (meta.level !== "LOW_RISK") {
    if (sentenceList.some((s) => claims(s, ENCOURAGE_DIRECT))) return reject("SIGNING_ADVICE", "encourages signing despite the verdict");
    if (sentenceList.some((s) => claims(s, REASSURE) && !CONTRAST.test(s))) {
      return reject("SIGNING_ADVICE", "reassures the user despite the verdict");
    }
    if (sentenceList.some((s) => ENCOURAGE_WEAK.some((p) => claims(s, p)) && !CONDITIONAL.test(s))) {
      return reject("SIGNING_ADVICE", "tells the user to sign despite the verdict");
    }
    const cue = ADVICE_CUE[meta.level];
    if (cue && !cue.test(advice)) return reject("SIGNING_ADVICE", `advice does not match the ${meta.level} verdict`);
  } else {
    if (sentenceList.some((s) => claims(s, RISK_CLAIM))) return reject("CLAIMS_RISK", "claims a risk that no rule found");
    if (sentences(advice).some((s) => claims(s, /\b(do not|don't|never) sign\b/i) && !CONDITIONAL.test(s))) {
      return reject("SIGNING_ADVICE", "says not to sign although no known risks were found");
    }
  }
  if (meta.level === "DANGER" && sentenceList.some((s) => claims(s, DOWNPLAY))) return reject("DOWNPLAYS_RISK", "downplays a Danger verdict");

  // Grounding in the facts.
  const grounding = checkGrounding(text, meta);
  if (grounding) return grounding;

  // Invented transfers: permission to move tokens later is not tokens moving now.
  for (const s of sentenceList) {
    const moves = claims(s, MOVE_VERB) && !MODAL.test(s);
    if (!meta.tokenMovement && moves && TOKEN_WORD.test(s)) {
      return reject("INVENTED_TRANSFER", "says tokens move although the facts only show a permission or no token transfer");
    }
    if (!meta.solMovement && moves && SOL_WORD.test(s) && !/\bfee\b/i.test(s)) {
      return reject("INVENTED_TRANSFER", "says SOL moves although the facts show no SOL transfer");
    }
  }

  // Unverified effects must not be presented as confirmed.
  if ((!meta.checkComplete || meta.simulationStatus !== "succeeded") && !HEDGE.test(text)) {
    return reject("UNVERIFIED_AS_CONFIRMED", "does not say that part of the check is missing");
  }
  if (meta.simulationStatus !== "succeeded" && sentenceList.some(simulationClaimsConfirmation)) {
    return reject("UNVERIFIED_AS_CONFIRMED", "claims the simulation confirmed effects although it did not succeed");
  }

  // Coverage of every finding, and of a SOL transfer.
  for (const rule of meta.findingRules) {
    const pattern = COVERAGE[rule];
    if (pattern && !pattern.test(text)) return reject("MISSING_COVERAGE", `does not mention the ${rule} finding`);
  }
  if (meta.solTransfers.length > 0 && !(SOL_WORD.test(text) && /\b(send\w*|sent|pay\w*|transfer\w*)\b/i.test(text))) {
    return reject("MISSING_COVERAGE", "does not mention the SOL transfer");
  }

  return { ok: true, value: { summary, points, advice } };
}
