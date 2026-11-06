import { formatSol } from "../lib/solana/format";
import type { DecodedTx } from "../lib/types";
import { Address } from "./address";

function versionLabel(version: DecodedTx["version"]): string {
  return version === "legacy" ? "Legacy" : `Version ${version}`;
}

function budgetText(budget: DecodedTx["budget"]): string | null {
  const parts: string[] = [];
  if (budget.computeUnitLimit !== undefined) parts.push(`limit ${budget.computeUnitLimit.toLocaleString("en-US")} compute units`);
  if (budget.computeUnitPriceMicroLamports !== undefined) {
    parts.push(`price ${budget.computeUnitPriceMicroLamports} micro-lamports per unit`);
  }
  if (budget.priorityFeeLamports !== undefined) parts.push(`priority fee ${formatSol(BigInt(budget.priorityFeeLamports))}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function TxOverview({ decoded }: { decoded: DecodedTx }) {
  const signed = decoded.signatures.filter((s) => s.present).length;
  const budget = budgetText(decoded.budget);
  return (
    <section aria-labelledby="overview-heading" className="space-y-3">
      <h2 id="overview-heading" className="text-lg font-semibold">
        Transaction overview
      </h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Format</dt>
        <dd>
          {versionLabel(decoded.version)}, {decoded.sizeBytes} bytes, {decoded.instructions.length} instruction(s)
        </dd>
        <dt className="text-muted">Fee payer</dt>
        <dd className="min-w-0">
          <Address value={decoded.feePayer} />
        </dd>
        <dt className="text-muted">Signers</dt>
        <dd className="min-w-0">
          <ul className="space-y-0.5">
            {decoded.signatures.map((s) => (
              <li key={s.address}>
                <Address value={s.address} /> <span className="text-muted">({s.present ? "signed" : "not signed yet"})</span>
              </li>
            ))}
          </ul>
        </dd>
        <dt className="text-muted">Signatures</dt>
        <dd>
          {signed} of {decoded.signatures.length} present
        </dd>
        {decoded.usesDurableNonce && (
          <>
            <dt className="text-muted">Expiry</dt>
            <dd>Uses a durable nonce: this transaction does not expire and could be submitted much later.</dd>
          </>
        )}
        {budget && (
          <>
            <dt className="text-muted">Compute budget</dt>
            <dd>{budget}</dd>
          </>
        )}
        {decoded.lookupTables.length > 0 && (
          <>
            <dt className="text-muted">Lookup tables</dt>
            <dd className="min-w-0">
              <ul className="space-y-0.5">
                {decoded.lookupTables.map((t) => (
                  <li key={t.address}>
                    <Address value={t.address} /> <span className="text-muted">({t.resolved ? "loaded" : "not loaded"})</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      {decoded.warnings.length > 0 && (
        <div role="note" className="rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold">Part of this transaction could not be read</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {decoded.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
