"use client";

import { useRef, useState } from "react";
import type { AnalyzeResponse, ApiError } from "../lib/types";
import { UserAddressContext } from "./address";
import { CouldNotCheck } from "./could-not-check";
import { ExplanationPanel } from "./explanation-panel";
import { FlagList } from "./flag-list";
import { InstructionList } from "./instruction-list";
import { ScenarioButtons, ScenarioRevealCard, type ScenarioReveal, type ScenarioSummary } from "./scenario-buttons";
import { SimulationPanel } from "./simulation-panel";
import { TxInput } from "./tx-input";
import { TxOverview } from "./tx-overview";
import { VerdictCard } from "./verdict-card";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: AnalyzeResponse; tx: string }
  | { status: "error"; message: string };

const REQUEST_TIMEOUT_MS = 40_000;

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiError).error?.message === "string"
  );
}

export function Checker() {
  const [input, setInput] = useState("");
  const [userAddress, setUserAddress] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [reveal, setReveal] = useState<ScenarioReveal | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  /**
   * The one analysis path: pasted text and demo scenarios both go through here.
   * fresh = "Check again": the server skips its cached result and explanation.
   */
  async function check(tx: string = input, fresh = false): Promise<boolean> {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { kind: "base64", tx, ...(userAddress.trim() ? { userAddress: userAddress.trim() } : {}) },
          ...(fresh ? { fresh: true } : {}),
        }),
        signal: controller.signal,
      });
      const body: unknown = await res.json().catch(() => null);
      if (controllerRef.current !== controller) return false; // superseded by a newer check
      if (!res.ok) {
        setState({
          status: "error",
          message: isApiError(body) ? body.error.message : `The server answered with status ${res.status}.`,
        });
        return false;
      }
      setState({ status: "success", result: body as AnalyzeResponse, tx });
      return true;
    } catch {
      if (controllerRef.current !== controller) return false; // superseded by a newer check
      setState({
        status: "error",
        message: "Could not reach the SignSafe server, or it took too long. Check your connection and try again.",
      });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function checkPasted() {
    setReveal(null);
    void check();
  }

  async function runScenario(scenario: ScenarioSummary) {
    setReveal(null);
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: scenario.id }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || typeof (body as { txBase64?: unknown })?.txBase64 !== "string") {
        setState({ status: "error", message: isApiError(body) ? body.error.message : "The demo transaction could not be built." });
        return;
      }
      const tx = (body as { txBase64: string }).txBase64;
      setInput(tx); // visible in the paste box: it is a real, unsigned devnet transaction
      if (!(await check(tx))) return;
      // Only now, after the pipeline has given its verdict, ask what the scenario really was.
      const revealed = await fetch(`/api/scenarios?reveal=${encodeURIComponent(scenario.id)}`).then((r) => (r.ok ? r.json() : null));
      if (revealed) setReveal(revealed as ScenarioReveal);
    } catch {
      setState({ status: "error", message: "Could not reach the SignSafe server to build the demo transaction." });
    }
  }

  return (
    <div className="space-y-8">
      <TxInput
        value={input}
        onChange={(value) => {
          setInput(value);
          setReveal(null);
        }}
        userAddress={userAddress}
        onUserAddressChange={setUserAddress}
        onSubmit={checkPasted}
        busy={state.status === "loading"}
      />
      <ScenarioButtons busy={state.status === "loading"} onPick={(s) => void runScenario(s)} />

      <div aria-live="polite">
        {state.status === "loading" && <p className="text-sm text-muted">Decoding, simulating on devnet and checking rules...</p>}
        {state.status === "error" && (
          <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">
            <p className="font-semibold">Could not check this transaction</p>
            <p className="mt-1">{state.message}</p>
          </div>
        )}
      </div>

      {state.status === "success" && (
        <UserAddressContext.Provider value={state.result.userAddress}>
          <div className="space-y-6">
            {/* The verdict (rules) and its explanation side by side on wide screens, stacked on phones. */}
            <div className="grid gap-4 md:grid-cols-2">
              <VerdictCard verdict={state.result.verdict} />
              <ExplanationPanel explanation={state.result.explanation} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span>
                {state.result.cache?.hit && state.result.cache.storedAt
                  ? `Saved result from ${new Date(state.result.cache.storedAt).toLocaleTimeString()} (results are kept up to 10 minutes).`
                  : "Fresh result."}
              </span>
              <button
                type="button"
                onClick={() => {
                  const tx = state.tx;
                  void check(tx, true);
                }}
                className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition hover:bg-cream"
              >
                Check again
              </button>
            </div>
            {reveal && (
              <ScenarioRevealCard reveal={reveal} actualLevel={state.result.verdict.level} actualLabel={state.result.verdict.label} />
            )}
            <CouldNotCheck decoded={state.result.decoded} simulation={state.result.simulation} />
            <FlagList flags={state.result.verdict.flags} />
            <SimulationPanel simulation={state.result.simulation} />
            <section aria-labelledby="instructions-heading" className="space-y-3">
              <h2 id="instructions-heading" className="text-lg font-semibold">
                What this transaction asks to do
              </h2>
              <InstructionList instructions={state.result.decoded.instructions} />
            </section>
            <TxOverview decoded={state.result.decoded} />
          </div>
        </UserAddressContext.Provider>
      )}
    </div>
  );
}
