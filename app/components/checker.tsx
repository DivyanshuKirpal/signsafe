"use client";

import { useEffect, useRef, useState } from "react";
import { readNdjson } from "../lib/client/ndjson";
import type { SavedResultSummary } from "../lib/replay/saved-results";
import type { AnalyzeResponse, AnalyzeStep, AnalyzeStreamEvent, ApiError, VerdictStage } from "../lib/types";
import { ResultView } from "./result-view";
import { SavedResultsPicker } from "./saved-results";
import { ScenarioButtons, type ScenarioReveal, type ScenarioSummary } from "./scenario-buttons";
import { type LoadingPhase, StepProgress } from "./step-progress";
import { TxInput } from "./tx-input";

/** What the user asked for. "Try again" repeats it exactly. */
type Action =
  | { kind: "check"; tx: string; fresh: boolean; scenarioId?: string }
  | { kind: "scenario"; scenario: ScenarioSummary }
  | { kind: "replay"; id: string };

type ErrorState = { status: "error"; title: string; message: string; retry: Action; retryAt?: number; replayId?: string };

type State =
  | { status: "idle" }
  | { status: "loading"; phase: LoadingPhase; step: AnalyzeStep | null; stage: VerdictStage | null; startedAt: number }
  | { status: "success"; result: AnalyzeResponse; tx: string; scenarioId?: string }
  | ErrorState;

/** `stageShown`: the verdict was already on screen before the full result arrived. */
type Outcome = { ok: true; result: AnalyzeResponse; stageShown: boolean } | { ok: false; message: string; retryAt?: number };

/** The server's own deadline is 35 s (AI attempts included). */
const REQUEST_TIMEOUT_MS = 40_000;
const BUILD_TIMEOUT_MS = 15_000;
const NETWORK_MESSAGE = "Could not reach the SignSafe server, or it took too long. Check your connection and try again.";

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiError).error?.message === "string"
  );
}

/** The server's plain message; for a rate limit also when "Try again" becomes useful (Retry-After). */
async function readError(res: Response): Promise<{ message: string; retryAt?: number }> {
  const body: unknown = await res.json().catch(() => null);
  const message = isApiError(body) ? body.error.message : `The server answered with status ${res.status}.`;
  const seconds = Number(res.headers.get("retry-after"));
  return res.status === 429 && Number.isFinite(seconds) && seconds > 0 ? { message, retryAt: Date.now() + seconds * 1_000 } : { message };
}

export function Checker() {
  const [input, setInput] = useState("");
  const [userAddress, setUserAddress] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [reveal, setReveal] = useState<ScenarioReveal | null>(null);
  const [examples, setExamples] = useState<SavedResultSummary[]>([]);
  const [now, setNow] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [scrollTo, setScrollTo] = useState<{ target: "status" | "result" } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Bring what just changed into view: the progress or error box, then the verdict.
  // On a phone the result is far below the buttons; on a laptop it starts near the fold.
  useEffect(() => {
    if (!scrollTo) return;
    const element = scrollTo.target === "result" ? resultRef.current : statusRef.current;
    if (!element || typeof element.scrollIntoView !== "function") return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: scrollTo.target === "result" ? "start" : "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [scrollTo]);

  // Saved results for "Replay a saved result" (an empty list when the server has none).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/examples")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { examples?: SavedResultSummary[] } | null) => {
        if (!cancelled && Array.isArray(body?.examples)) setExamples(body.examples);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A clock for the elapsed time while checking and for the rate-limit countdown.
  const ticking = state.status === "loading" || (state.status === "error" && state.retryAt !== undefined && now < state.retryAt);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);

  function startLoading(phase: LoadingPhase) {
    const started = Date.now();
    setNow(started);
    setAnnouncement("");
    setState({ status: "loading", phase, step: null, stage: null, startedAt: started });
    setScrollTo({ target: "status" });
  }

  /**
   * The one analysis call: pasted text, demo scenarios and Check again all go
   * through here. Streamed, so each step and the verdict show up as they happen.
   */
  async function analyze(tx: string, fresh: boolean, controller: AbortController): Promise<Outcome> {
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const isCurrent = () => controllerRef.current === controller;
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { kind: "base64", tx, ...(userAddress.trim() ? { userAddress: userAddress.trim() } : {}) },
          ...(fresh ? { fresh: true } : {}),
          stream: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, ...(await readError(res)) };
      if (!(res.headers.get("content-type") ?? "").includes("ndjson") || !res.body) {
        // Cached answers come as plain JSON.
        return { ok: true, result: (await res.json()) as AnalyzeResponse, stageShown: false };
      }
      const out: { result?: AnalyzeResponse; error?: string; stageShown: boolean } = { stageShown: false };
      await readNdjson<AnalyzeStreamEvent>(res.body, (event) => {
        if (event.type === "result") out.result = event.result;
        else if (event.type === "error") out.error = event.error.message;
        else if (isCurrent()) {
          setState((s) =>
            s.status !== "loading" ? s : event.type === "step" ? { ...s, phase: "check", step: event.step } : { ...s, stage: event.result },
          );
          if (event.type === "verdict") {
            out.stageShown = true;
            setScrollTo({ target: "result" });
          }
        }
      });
      if (out.result) return { ok: true, result: out.result, stageShown: out.stageShown };
      return { ok: false, message: out.error ?? "The check stopped before it finished. Please try again." };
    } catch {
      return { ok: false, message: NETWORK_MESSAGE };
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(action: Action) {
    controllerRef.current?.abort(); // a newer request always wins
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => controllerRef.current === controller;
    const fail = (title: string, message: string, extra: Partial<ErrorState> = {}) => {
      if (!isCurrent()) return;
      setNow(Date.now()); // so a rate-limit countdown starts from the server's number
      setState({ status: "error", title, message, retry: action, ...extra });
      setScrollTo({ target: "status" });
    };

    if (action.kind === "replay") {
      setReveal(null);
      startLoading("replay");
      try {
        const res = await fetch(`/api/examples?id=${encodeURIComponent(action.id)}`, { signal: controller.signal });
        const body: unknown = await res.json().catch(() => null);
        if (!isCurrent()) return;
        const saved = body as { result?: AnalyzeResponse; tx?: string; reveal?: ScenarioReveal } | null;
        if (!res.ok || !saved?.result || typeof saved.tx !== "string") {
          fail("Could not load the saved result", isApiError(body) ? body.error.message : "The saved result could not be loaded.");
          return;
        }
        setInput(saved.tx);
        setState({ status: "success", result: saved.result, tx: saved.tx, scenarioId: action.id });
        setReveal(saved.reveal ?? null);
        setAnnouncement(`Saved result loaded, not a new check: ${saved.result.verdict.label}.`);
        setScrollTo({ target: "result" });
      } catch {
        fail("Could not load the saved result", "Could not reach the SignSafe server to load the saved result.");
      }
      return;
    }

    let tx: string;
    let scenarioId: string | undefined;
    if (action.kind === "scenario") {
      setReveal(null);
      startLoading("build");
      scenarioId = action.scenario.id;
      const replayId = examples.some((e) => e.id === scenarioId) ? scenarioId : undefined;
      const timer = setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS);
      try {
        const res = await fetch("/api/scenarios", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: action.scenario.id }),
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);
        if (!isCurrent()) return;
        if (!res.ok || typeof (body as { txBase64?: unknown } | null)?.txBase64 !== "string") {
          fail(
            "Could not build the demo transaction",
            isApiError(body) ? body.error.message : "The demo transaction could not be built.",
            { replayId },
          );
          return;
        }
        tx = (body as { txBase64: string }).txBase64;
      } catch {
        fail("Could not build the demo transaction", "Could not reach the SignSafe server or devnet to build the demo transaction.", { replayId });
        return;
      } finally {
        clearTimeout(timer);
      }
      setInput(tx); // visible in the paste box: it is a real, unsigned devnet transaction
      setState((s) => (s.status === "loading" ? { ...s, phase: "check" } : s));
    } else {
      tx = action.tx;
      scenarioId = action.scenarioId;
      startLoading("check");
    }

    const outcome = await analyze(tx, action.kind === "check" && action.fresh, controller);
    if (!isCurrent()) return;
    if (!outcome.ok) {
      fail("Could not check this transaction", outcome.message, outcome.retryAt !== undefined ? { retryAt: outcome.retryAt } : {});
      return;
    }
    setState({ status: "success", result: outcome.result, tx, scenarioId });
    setAnnouncement(`Check finished: ${outcome.result.verdict.label}.`);
    if (!outcome.stageShown) setScrollTo({ target: "result" });
    if (action.kind === "scenario") {
      // Only now, after the pipeline has given its verdict, ask what the scenario really was.
      const revealed: unknown = await fetch(`/api/scenarios?reveal=${encodeURIComponent(action.scenario.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (revealed && isCurrent()) setReveal(revealed as ScenarioReveal);
    }
  }

  const busy = state.status === "loading";
  const view =
    state.status === "success"
      ? { stage: state.result as VerdictStage, result: state.result }
      : state.status === "loading" && state.stage
        ? { stage: state.stage, result: null }
        : null;
  // A demo check that could not reach devnet: offer the saved result of the same scenario.
  const offerId =
    state.status === "success" && !state.result.replay && !state.result.simulation.ran && state.scenarioId
      ? examples.find((e) => e.id === state.scenarioId)
      : undefined;

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
        onSubmit={() => {
          setReveal(null);
          void run({ kind: "check", tx: input, fresh: false });
        }}
        busy={busy}
      />
      <ScenarioButtons busy={busy} onPick={(scenario) => void run({ kind: "scenario", scenario })} />
      <SavedResultsPicker examples={examples} busy={busy} onReplay={(id) => void run({ kind: "replay", id })} />

      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div ref={statusRef} className="scroll-mt-4 empty:hidden">
        {state.status === "loading" && <StepProgress phase={state.phase} step={state.step} elapsedMs={now - state.startedAt} />}
        {state.status === "error" && (
          <ErrorBox
            error={state}
            now={now}
            replayCode={examples.find((e) => e.id === state.replayId)?.code}
            onRetry={() => void run(state.retry)}
            onReplay={(id) => void run({ kind: "replay", id })}
          />
        )}
      </div>

      <div ref={resultRef} className="scroll-mt-4 empty:hidden">
        {view && (
          <ResultView
            stage={view.stage}
            result={view.result}
            reveal={reveal}
            busy={busy}
            onCheckAgain={() => {
              if (state.status === "success") void run({ kind: "check", tx: state.tx, fresh: true, scenarioId: state.scenarioId });
            }}
            replayOffer={offerId ? { code: offerId.code, onReplay: () => void run({ kind: "replay", id: offerId.id }) } : null}
          />
        )}
      </div>
    </div>
  );
}

/** A plain message, "Try again" (counting down after a rate limit), and a saved result when one fits. */
function ErrorBox({
  error,
  now,
  replayCode,
  onRetry,
  onReplay,
}: {
  error: ErrorState;
  now: number;
  replayCode?: string;
  onRetry: () => void;
  onReplay: (id: string) => void;
}) {
  const wait = error.retryAt !== undefined ? Math.max(0, Math.ceil((error.retryAt - now) / 1_000)) : 0;
  return (
    <div className="space-y-3 rounded-lg border-2 border-destructive bg-card p-3 text-sm">
      <div role="alert">
        <p className="font-semibold">{error.title}</p>
        <p className="mt-1">{error.message}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={wait > 0}
          className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {wait > 0 ? `Try again in ${wait} s` : "Try again"}
        </button>
        {error.replayId && (
          <button
            type="button"
            onClick={() => onReplay(error.replayId!)}
            className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-cream"
          >
            Replay the saved result{replayCode ? ` of ${replayCode}` : ""} instead
          </button>
        )}
      </div>
    </div>
  );
}
