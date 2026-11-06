"use client";

import { useEffect, useState } from "react";

export interface ScenarioSummary {
  id: string;
  code: string;
  pitch: string;
}

export interface ScenarioReveal extends ScenarioSummary {
  description: string;
  expected: string[];
  expectedLabels: string[];
}

interface Props {
  busy: boolean;
  /** Builds the scenario transaction, puts it in the paste box and runs the normal check. */
  onPick: (scenario: ScenarioSummary) => void;
}

/** One button per demo scenario. The buttons show only what a website would claim. */
export function ScenarioButtons({ busy, onPick }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scenarios")
      .then((res) => res.json())
      .then((body: { ready?: boolean; scenarios?: ScenarioSummary[] }) => {
        if (cancelled) return;
        setScenarios(body.scenarios ?? []);
        setReady(Boolean(body.ready));
      })
      .catch(() => !cancelled && setReady(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (ready === false && scenarios.length === 0) return null;
  return (
    <section aria-labelledby="scenarios-heading" className="space-y-2">
      <h2 id="scenarios-heading" className="text-sm font-medium">
        Or try a demo transaction <span className="font-normal text-muted">(devnet, unsigned; the label is what a website might claim)</span>
      </h2>
      {ready === false && <p className="text-xs text-muted">The demo accounts are not set up on this server yet.</p>}
      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy || ready !== true}
            onClick={() => onPick(s)}
            className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 text-left text-xs transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="font-semibold">{s.code}</span> {s.pitch}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Shown only after the check: what the scenario really is and whether the verdict matched. */
export function ScenarioRevealCard({ reveal, actualLevel, actualLabel }: { reveal: ScenarioReveal; actualLevel: string; actualLabel: string }) {
  const matches = reveal.expected.includes(actualLevel);
  return (
    <section aria-labelledby="reveal-heading" className="rounded-lg border border-border p-4 text-sm">
      <h2 id="reveal-heading" className="font-semibold">
        Demo scenario {reveal.code}: what it really was
      </h2>
      <p className="mt-1">
        <span className="text-muted">The site said:</span> &quot;{reveal.pitch}&quot;
      </p>
      <p className="mt-1">
        <span className="text-muted">What it actually does:</span> {reveal.description}
      </p>
      <p className="mt-1">
        <span className="text-muted">Expected verdict:</span> {reveal.expectedLabels.join(" or ")}.{" "}
        <span className="text-muted">SignSafe&apos;s verdict:</span> {actualLabel}{" "}
        <span className="font-semibold">({matches ? "matches" : "does not match"})</span>
      </p>
    </section>
  );
}
