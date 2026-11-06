import { describeChange } from "../lib/solana/describe-change";
import type { StateChange, WatchedAccount, WatchRole } from "../lib/types";
import { Address } from "./address";

const ROLE_LABELS: Record<WatchRole, string> = {
  feePayer: "fee payer",
  signer: "signer",
  writable: "written to",
  mint: "token mint",
};

function rolesOf(address: string, watched: WatchedAccount[]): string {
  const roles = watched.find((w) => w.address === address)?.roles ?? [];
  // "written to" adds nothing when the account is already the fee payer or a signer.
  const shown = roles.length > 1 ? roles.filter((r) => r !== "writable") : roles;
  return shown.map((r) => ROLE_LABELS[r]).join(", ");
}

export function StateChanges({ changes, watched }: { changes: StateChange[]; watched: WatchedAccount[] }) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted">No account in the watch list would change.</p>;
  }
  return (
    <ul className="space-y-2" aria-label="Account changes">
      {changes.map((change, i) => {
        const text = describeChange(change);
        const roles = rolesOf(change.address, watched);
        return (
          <li key={`${change.address}-${change.kind}-${i}`} className="rounded-lg border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <Address value={change.address} />
              {roles && <span>({roles})</span>}
              {change.tokenAccountOwner && (
                <span>
                  token account of <Address value={change.tokenAccountOwner} />
                </span>
              )}
            </div>
            <p className="mt-1 font-semibold">{text.label}</p>
            <p className="mt-0.5 break-words">
              {text.before} <span aria-hidden="true">-&gt;</span>
              <span className="sr-only">changes to</span> {text.after}
              {text.delta && <span className="font-mono"> ({text.delta})</span>}
            </p>
            {text.note && <p className="mt-1 text-xs text-muted">{text.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
