"use client";

import { useRef, useState } from "react";
import type { AnalyzeResponse, ApiError } from "../lib/types";
import { UserAddressContext } from "./address";
import { CouldNotCheck } from "./could-not-check";
import { FlagList } from "./flag-list";
import { InstructionList } from "./instruction-list";
import { SimulationPanel } from "./simulation-panel";
import { TxInput } from "./tx-input";
import { TxOverview } from "./tx-overview";
import { VerdictCard } from "./verdict-card";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: AnalyzeResponse }
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
  const controllerRef = useRef<AbortController | null>(null);

  async function check() {
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
          input: { kind: "base64", tx: input, ...(userAddress.trim() ? { userAddress: userAddress.trim() } : {}) },
        }),
        signal: controller.signal,
      });
      const body: unknown = await res.json().catch(() => null);
      if (controllerRef.current !== controller) return; // superseded by a newer check
      if (!res.ok) {
        setState({
          status: "error",
          message: isApiError(body) ? body.error.message : `The server answered with status ${res.status}.`,
        });
        return;
      }
      setState({ status: "success", result: body as AnalyzeResponse });
    } catch {
      if (controllerRef.current !== controller) return; // superseded by a newer check
      setState({
        status: "error",
        message: "Could not reach the SignSafe server, or it took too long. Check your connection and try again.",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return (
    <div className="space-y-8">
      <TxInput
        value={input}
        onChange={setInput}
        userAddress={userAddress}
        onUserAddressChange={setUserAddress}
        onSubmit={check}
        busy={state.status === "loading"}
      />

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
            <VerdictCard verdict={state.result.verdict} />
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
