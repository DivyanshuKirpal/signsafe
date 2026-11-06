import type { FlagSource, RiskFlag, Severity } from "../lib/types";
import { Address } from "./address";

const SEVERITY: Record<Severity, { word: string; style: string }> = {
  danger: { word: "Danger", style: "bg-red-600 text-white" },
  caution: { word: "Caution", style: "bg-amber-500 text-black" },
  info: { word: "Note", style: "border border-border" },
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function SourceItem({ source }: { source: FlagSource }) {
  switch (source.type) {
    case "instruction":
      return (
        <>
          <span className="font-semibold">{source.inner ? `Inner call #${source.path}` : `Instruction #${source.path}`}:</span> {source.summary}
        </>
      );
    case "stateChange":
      return (
        <>
          <span className="font-semibold">Account change at</span> <Address value={source.address} copy />: {source.description}
        </>
      );
    case "decodeWarning":
      return (
        <>
          <span className="font-semibold">Could not read:</span> {source.message}
        </>
      );
    case "simulation":
      return (
        <>
          <span className="font-semibold">Simulation:</span> {source.message}
        </>
      );
    case "transaction":
      return (
        <>
          <span className="font-semibold">Transaction setting:</span> {source.description}
        </>
      );
    case "missingState":
      return (
        <>
          <span className="font-semibold">Not checked:</span> {source.message}
        </>
      );
  }
}

function FlagItem({ flag }: { flag: RiskFlag }) {
  const severity = SEVERITY[flag.severity];
  const rules = [flag.ruleId, ...(flag.relatedRuleIds ?? [])].join(" + ");
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${severity.style}`}>{severity.word}</span>
        <h3 className="text-sm font-semibold">{flag.title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed break-words">{flag.detail}</p>

      {flag.sources.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Based on</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 break-words">
            {flag.sources.map((source, i) => (
              <li key={i}>
                <SourceItem source={source} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Evidence ({rules})</summary>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {Object.entries(flag.evidence).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-muted">{name}</dt>
              <dd className="min-w-0">{BASE58.test(value) ? <Address value={value} copy /> : <span className="break-words">{value}</span>}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

export function FlagList({ flags }: { flags: RiskFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <section aria-labelledby="flags-heading" className="space-y-3">
      <h2 id="flags-heading" className="text-lg font-semibold">
        Why
      </h2>
      <ul className="space-y-3" aria-label="Risk flags">
        {flags.map((flag, i) => (
          <FlagItem key={`${i}-${flag.ruleId}`} flag={flag} />
        ))}
      </ul>
    </section>
  );
}
