import type { DecodedIx } from "../lib/types";
import { Address } from "./address";

function ArgValueText({ name, value }: { name: string; value: DecodedIx["args"][string] }) {
  if (value === null) return <span className="text-muted">none</span>;
  if (typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && name !== "text") {
    return <Address value={value} />;
  }
  return <span className="font-mono break-all">{String(value)}</span>;
}

function InstructionItem({ ix }: { ix: DecodedIx }) {
  const isMemo = ix.action === "memo";
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-muted">#{ix.path}</span>
        <span className="text-sm font-semibold">{ix.programName}</span>
        <span className="font-mono text-xs">{ix.action}</span>
        {!ix.known && (
          <span className="rounded border border-border px-1.5 py-0.5 text-xs font-medium">
            Not a known program
          </span>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed break-words">{ix.summary}</p>

      {ix.parseError && (
        <p className="mt-2 text-xs text-muted">Could not decode: {ix.parseError}</p>
      )}

      {isMemo && (
        <p className="mt-2 text-xs text-muted">
          Memo text is written by whoever built the transaction. Treat it as untrusted.
        </p>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Details</summary>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">program</dt>
          <dd className="min-w-0">
            <Address value={ix.programId} />
          </dd>
          {Object.entries(ix.accounts).map(([name, address]) => (
            <div key={`a-${name}`} className="contents">
              <dt className="text-muted">{name}</dt>
              <dd className="min-w-0">
                <Address value={address} />
              </dd>
            </div>
          ))}
          {Object.entries(ix.args).map(([name, value]) => (
            <div key={`v-${name}`} className="contents">
              <dt className="text-muted">{name}</dt>
              <dd className="min-w-0">
                <ArgValueText name={name} value={value} />
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

export function InstructionList({ instructions }: { instructions: DecodedIx[] }) {
  if (instructions.length === 0) {
    return <p className="text-sm text-muted">This transaction has no instructions.</p>;
  }
  return (
    <ol className="space-y-3" aria-label="Decoded instructions">
      {instructions.map((ix) => (
        <InstructionItem key={ix.path} ix={ix} />
      ))}
    </ol>
  );
}
