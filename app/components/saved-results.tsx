"use client";

import { formatWhen } from "../lib/client/time";
import type { SavedResultSummary } from "../lib/replay/saved-results";

/**
 * "Replay a saved result" (ARCHITECTURE 12.6): for recording when the network
 * fails. Collapsed by default; every replay is labelled as saved on the result page.
 */
export function SavedResultsPicker({
  examples,
  busy,
  onReplay,
}: {
  examples: SavedResultSummary[];
  busy: boolean;
  onReplay: (id: string) => void;
}) {
  if (examples.length === 0) return null;
  return (
    <details className="rounded-lg border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Replay a saved result <span className="font-normal text-muted">(works without the network)</span>
      </summary>
      <p className="mt-2 text-xs text-muted">
        Results saved earlier from real checks on devnet. A replay shows the saved result exactly as it was, labelled
        with the time it was saved; it does not check anything now.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            disabled={busy}
            onClick={() => onReplay(example.id)}
            className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 text-left text-xs transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="font-semibold">{example.code}</span> saved {formatWhen(example.capturedAt, "short")},{" "}
            {example.explanationSource === "ai" ? "AI explanation" : "built-in explanation"}
          </button>
        ))}
      </div>
    </details>
  );
}
