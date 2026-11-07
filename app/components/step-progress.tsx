import type { AnalyzeStep } from "../lib/types";

const STEPS: { step: AnalyzeStep; label: string }[] = [
  { step: "decode", label: "Decode the instructions" },
  { step: "simulate", label: "Simulate on devnet and compare the accounts" },
  { step: "rules", label: "Apply the risk rules (they decide the verdict)" },
  { step: "explain", label: "Write the plain-English explanation" },
];

export type LoadingPhase = "build" | "check" | "replay";

/**
 * What is running right now. Steps come from the server as they start
 * (streamed /api/analyze), so "Running" is the real current step.
 */
export function StepProgress({ phase, step, elapsedMs }: { phase: LoadingPhase; step: AnalyzeStep | null; elapsedMs: number }) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (phase === "replay") {
    return (
      <p role="status" className="text-sm text-muted">
        Loading the saved result...
      </p>
    );
  }
  const current = phase === "check" && step ? STEPS.findIndex((s) => s.step === step) : -1;
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <p className="font-semibold">
        <span role="status">{phase === "build" ? "Building the demo transaction on devnet..." : "Checking the transaction..."}</span>{" "}
        <span aria-hidden="true" className="font-normal text-muted">
          {seconds} s
        </span>
      </p>
      <ol className="mt-2 space-y-1" aria-label="Steps">
        {STEPS.map((s, i) => {
          const status = i < current ? "Done" : i === current ? "Running" : "Waiting";
          return (
            <li key={s.step} className="flex gap-2">
              <span className={`w-16 shrink-0 text-xs leading-5 font-semibold ${status === "Running" ? "" : "text-muted"}`}>{status}</span>
              <span className={status === "Waiting" ? "text-muted" : ""}>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
