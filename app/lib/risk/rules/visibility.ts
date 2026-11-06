/**
 * Rules about what the transaction is and what could not be seen:
 * R-UNKNOWN-PROGRAM, R-DURABLE-NONCE (Should), R-SIM-FAILED, R-UNRESOLVED,
 * R-MEMO (info).
 */
import { ixSource, type RawFlag, type RiskContext, short } from "../context";

/** Unknown programs are CAUTION; their effects are judged only through the state-diff rules. */
export function unknownProgramRule(ctx: RiskContext): RawFlag[] {
  const byProgram = new Map<string, typeof ctx.decoded.instructions>();
  for (const ix of ctx.decoded.instructions) {
    if (ix.known) continue;
    byProgram.set(ix.programId, [...(byProgram.get(ix.programId) ?? []), ix]);
  }
  return [...byProgram].map(([programId, ixs]) => {
    const accounts = ixs.flatMap((ix) => Object.values(ix.accounts));
    const getsSigner = accounts.some((a) => ctx.signers.has(a));
    const getsToken = accounts.some((a) => ctx.pre.get(a)?.token !== undefined);
    const exposure = [getsSigner && "a signer's account", getsToken && "a token account"].filter(Boolean).join(" and ");
    return {
      key: `unknown:${programId}`,
      ruleId: "R-UNKNOWN-PROGRAM" as const,
      severity: "caution" as const,
      title: "Calls a program SignSafe does not recognise",
      detail:
        `Instruction ${ixs.map((ix) => `#${ix.path}`).join(", ")} calls program ${short(programId)}, which is not in SignSafe's list of known programs.` +
        (exposure ? ` It receives ${exposure}, so it may act on them.` : "") +
        " What it does is judged only from the simulated account changes.",
      evidence: { program: programId, receives: exposure || "no signer or token account" },
      sources: ixs.map(ixSource),
    };
  });
}

export function durableNonceRule(ctx: RiskContext): RawFlag[] {
  if (!ctx.decoded.usesDurableNonce) return [];
  const first = ctx.decoded.instructions[0];
  return [
    {
      key: "durable-nonce",
      ruleId: "R-DURABLE-NONCE",
      severity: "caution",
      title: "Does not expire",
      detail:
        "This transaction uses a durable nonce instead of a recent blockhash, so once signed it stays valid and could be submitted much later, when balances or permissions may have changed.",
      evidence: { nonceAccount: first?.accounts.nonceAccount ?? "unknown" },
      sources: first ? [ixSource(first)] : [],
    },
  ];
}

/** A simulation that did not run or failed makes the verdict UNKNOWN (unless something is already DANGER). */
export function simFailedRule(ctx: RiskContext): RawFlag[] {
  const sim = ctx.simulation;
  if (sim.ran && sim.ok) return [];
  const message = sim.error?.userMessage ?? "The simulation did not complete.";
  return [
    {
      key: "sim-failed",
      ruleId: "R-SIM-FAILED",
      severity: "info",
      title: sim.ran ? "The simulation failed" : "The transaction was not simulated",
      detail: `${message} Without a successful simulation, SignSafe cannot confirm what the transaction would change.`,
      evidence: { simulation: sim.ran ? "ran and failed" : "did not run", code: sim.error?.code ?? "UNKNOWN" },
      sources: [{ type: "simulation", code: sim.error?.code ?? "SIMULATION_FAILED", message }],
    },
  ];
}

/** Decoding gaps: unresolved lookup tables, undecodable instructions, accounts left out of the comparison. */
export function unresolvedRule(ctx: RiskContext): RawFlag[] {
  const warnings = ctx.decoded.warnings;
  if (warnings.length === 0) return [];
  return [
    {
      key: "unresolved",
      ruleId: "R-UNRESOLVED",
      severity: "caution",
      title: "Part of this transaction could not be read",
      detail: `SignSafe could not see all of this transaction (${warnings.length} problem${warnings.length === 1 ? "" : "s"} listed below), so some effects may be hidden.`,
      evidence: { problems: String(warnings.length) },
      sources: warnings.map((w) => ({ type: "decodeWarning" as const, code: w.code, message: w.message })),
    },
  ];
}

/** Memo text is untrusted and never used for decisions; it is only reported. */
export function memoRule(ctx: RiskContext): RawFlag[] {
  const memos = ctx.instructions.filter((ix) => ix.action === "memo");
  if (memos.length === 0) return [];
  return [
    {
      key: "memo",
      ruleId: "R-MEMO",
      severity: "info",
      title: "Contains a memo written by the sender",
      detail:
        "The text in a memo is written by whoever built the transaction. It can say anything, including claims that the transaction is fine. SignSafe never uses it to decide anything.",
      evidence: { memos: String(memos.length) },
      sources: memos.map(ixSource),
    },
  ];
}
