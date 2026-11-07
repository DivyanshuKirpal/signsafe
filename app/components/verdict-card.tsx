import type { Verdict, VerdictLevel } from "../lib/types";

/** Colour always comes with the text label (CLAUDE.md section 9). */
const STYLES: Record<VerdictLevel, { box: string; badge: string; word: string }> = {
  DANGER: { box: "border-red-600 dark:border-red-500", badge: "bg-red-600 text-white", word: "Danger" },
  UNKNOWN: { box: "border-amber-500", badge: "bg-amber-500 text-black", word: "Incomplete" },
  CAUTION: { box: "border-amber-500", badge: "bg-amber-500 text-black", word: "Caution" },
  LOW_RISK: { box: "border-emerald-600 dark:border-emerald-500", badge: "bg-emerald-700 text-white", word: "No known risks" },
};

/** `saved`: this verdict is part of a replayed saved result (see the banner above it). */
export function VerdictCard({ verdict, saved = false }: { verdict: Verdict; saved?: boolean }) {
  const style = STYLES[verdict.level];
  const issues = verdict.flags.filter((f) => f.severity !== "info").length;
  return (
    <section aria-labelledby="verdict-heading" className={`rounded-xl border-2 bg-card p-4 sm:p-5 ${style.box}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${style.badge}`}>{style.word}</span>
        <span className="text-xs text-muted">Verdict from fixed rules, not from AI</span>
        {saved && (
          <span className="rounded-md border border-sky-700 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:border-sky-400 dark:text-sky-300">
            Saved result
          </span>
        )}
      </div>
      <h2 id="verdict-heading" className="mt-2 text-xl font-black tracking-tight">
        {verdict.label}
      </h2>
      <p className="mt-1 text-sm">{verdict.reason}</p>
      {verdict.level !== "LOW_RISK" && (
        <p className="mt-2 text-xs text-muted">
          {issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"} found. ` : ""}See the details below.
        </p>
      )}
      {!verdict.complete && verdict.level !== "UNKNOWN" && (
        <p className="mt-2 text-sm font-medium">
          Part of this transaction could not be checked as well; see &quot;What could not be checked&quot;.
        </p>
      )}
      {verdict.level === "LOW_RISK" && (
        <p className="mt-2 text-xs text-muted">
          This means none of SignSafe&apos;s rules matched on devnet, not that the transaction is harmless. State can
          change before it lands, so check again right before signing.
        </p>
      )}
    </section>
  );
}
