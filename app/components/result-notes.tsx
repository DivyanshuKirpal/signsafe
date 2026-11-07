"use client";

import { useState } from "react";
import { formatDuration, formatWhen } from "../lib/client/time";
import type { AnalyzeResponse, ReplayInfo } from "../lib/types";

/**
 * Shown above the verdict whenever a saved result is replayed, so nobody reads
 * a replay as a new check (ARCHITECTURE 12.6: "saved result from (time)").
 */
export function ReplayBanner({ replay }: { replay: ReplayInfo }) {
  return (
    <section aria-labelledby="replay-heading" className="rounded-xl border-2 border-dashed border-sky-700 bg-card p-4 dark:border-sky-400">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-sky-700 px-2 py-0.5 text-xs font-bold tracking-wide text-white uppercase">Saved result</span>
        <span className="text-xs text-muted">A replay, not a new check</span>
      </div>
      <h2 id="replay-heading" className="mt-2 text-base font-semibold">
        Saved result from {formatWhen(replay.capturedAt)}
      </h2>
      <p className="mt-1 text-sm">
        SignSafe checked demo scenario {replay.code} on devnet at that time and saved the answer. Nothing was simulated or
        sent to the AI just now, and devnet may have changed since. Use Check again for a new check.
      </p>
      {replay.devnetData === "recorded" && (
        <p className="mt-1 text-sm">It was produced from devnet data recorded {formatWhen(replay.devnetDataAt)}.</p>
      )}
    </section>
  );
}

function newCheckNote(timings: Record<string, number>): string {
  const parts: string[] = [];
  if (timings.simulate !== undefined) parts.push(`simulation ${formatDuration(timings.simulate)}`);
  if (timings.explain !== undefined) parts.push(`explanation ${formatDuration(timings.explain)}`);
  const total = timings.total !== undefined ? `, finished in ${formatDuration(timings.total)}` : "";
  return `New check${total}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}.`;
}

/** Where this result came from (new, cached or saved), with "Check again" for a new check. */
export function ResultMeta({ result, busy, onCheckAgain }: { result: AnalyzeResponse; busy: boolean; onCheckAgain: () => void }) {
  const note = result.replay
    ? `Saved result from ${formatWhen(result.replay.capturedAt)}, not a new check.`
    : result.cache?.hit && result.cache.storedAt
      ? `Cached result from ${formatWhen(result.cache.storedAt)}: this exact check ran in the last 10 minutes.`
      : newCheckNote(result.timingsMs);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span>{note}</span>
      <button
        type="button"
        onClick={onCheckAgain}
        disabled={busy}
        className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        Check again
      </button>
    </div>
  );
}

/** Placeholder while the explanation is written; the verdict beside it is already final. */
export function ExplanationPending() {
  return (
    <section aria-labelledby="explanation-heading" aria-busy="true" className="rounded-xl border border-dashed border-border bg-card p-4 sm:p-5">
      <h2 id="explanation-heading" className="text-sm font-semibold">
        Explanation
      </h2>
      <p className="mt-2 text-sm">Writing the plain-English explanation...</p>
      <p className="mt-3 text-xs text-muted">
        The verdict is already final. The explanation is written afterwards from the same findings and cannot change it.
      </p>
    </section>
  );
}

/**
 * Collapsed raw JSON of the whole response (ARCHITECTURE 11: RawDetails).
 * Rendered only while open, so the page does not carry a second copy of every text.
 */
export function RawJson({ result }: { result: AnalyzeResponse }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the text can still be selected by hand.
    }
  }

  return (
    <details className="text-xs" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-muted">Raw details: the full JSON response</summary>
      {open && <RawJsonBody text={JSON.stringify(result, null, 2)} copied={copied} onCopy={copy} />}
    </details>
  );
}

function RawJsonBody({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-muted">Memos and program logs inside it come from the transaction and are untrusted text.</p>
        <button
          type="button"
          onClick={onCopy}
          className="cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-cream"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
        <span role="status" className="sr-only">
          {copied ? "JSON copied" : ""}
        </span>
      </div>
      <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-border p-2 font-mono whitespace-pre">{text}</pre>
    </>
  );
}
