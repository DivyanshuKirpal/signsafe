import type { AnalyzeResponse, VerdictStage } from "../lib/types";
import { UserAddressContext } from "./address";
import { CouldNotCheck } from "./could-not-check";
import { ExplanationPanel } from "./explanation-panel";
import { FlagList } from "./flag-list";
import { InstructionList } from "./instruction-list";
import { ExplanationPending, RawJson, ReplayBanner, ResultMeta } from "./result-notes";
import { ScenarioRevealCard, type ScenarioReveal } from "./scenario-buttons";
import { SimulationPanel } from "./simulation-panel";
import { TxOverview } from "./tx-overview";
import { VerdictCard } from "./verdict-card";

interface ResultViewProps {
  /** The verdict and its evidence (final before the explanation is written). */
  stage: VerdictStage;
  /** The full result; null while the explanation is still being written. */
  result: AnalyzeResponse | null;
  reveal: ScenarioReveal | null;
  busy: boolean;
  onCheckAgain: () => void;
  /** Offered when a demo check could not reach devnet and a saved result exists. */
  replayOffer: { code: string; onReplay: () => void } | null;
}

/** The result page, top to bottom (ARCHITECTURE 11). */
export function ResultView({ stage, result, reveal, busy, onCheckAgain, replayOffer }: ResultViewProps) {
  return (
    <UserAddressContext.Provider value={stage.userAddress}>
      <div className="space-y-6">
        {result?.replay && <ReplayBanner replay={result.replay} />}
        {/* The verdict (rules) and its explanation side by side on wide screens, stacked on phones. */}
        <div className="grid gap-4 md:grid-cols-2">
          <VerdictCard verdict={stage.verdict} saved={Boolean(result?.replay)} />
          {result ? <ExplanationPanel explanation={result.explanation} /> : <ExplanationPending />}
        </div>
        {result && <ResultMeta result={result} busy={busy} onCheckAgain={onCheckAgain} />}
        {replayOffer && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
            <span>Devnet could not be reached for this check. A saved result of {replayOffer.code} is available.</span>
            <button
              type="button"
              onClick={replayOffer.onReplay}
              disabled={busy}
              className="cursor-pointer rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
            >
              Replay the saved result
            </button>
          </div>
        )}
        {reveal && <ScenarioRevealCard reveal={reveal} actualLevel={stage.verdict.level} actualLabel={stage.verdict.label} />}
        <CouldNotCheck decoded={stage.decoded} simulation={stage.simulation} />
        <FlagList flags={stage.verdict.flags} />
        <SimulationPanel simulation={stage.simulation} />
        <section aria-labelledby="instructions-heading" className="space-y-3">
          <h2 id="instructions-heading" className="text-lg font-semibold">
            What this transaction asks to do
          </h2>
          <InstructionList instructions={stage.decoded.instructions} />
        </section>
        <TxOverview decoded={stage.decoded} />
        {result && <RawJson result={result} />}
      </div>
    </UserAddressContext.Provider>
  );
}
