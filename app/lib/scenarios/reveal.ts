/**
 * What a demo scenario really is and which verdict it should get. Sent to the
 * browser only after a result is on screen (a check that has run, or a replay).
 */
import { VERDICT_LABELS } from "../risk/templates";
import type { VerdictLevel } from "../types";
import type { Scenario } from "./index";

export interface ScenarioRevealInfo {
  id: string;
  code: string;
  pitch: string;
  description: string;
  expected: VerdictLevel[];
  expectedLabels: string[];
}

export function revealScenario(scenario: Scenario): ScenarioRevealInfo {
  return {
    id: scenario.id,
    code: scenario.code,
    pitch: scenario.pitch,
    description: scenario.description,
    expected: scenario.expected,
    expectedLabels: scenario.expected.map((level) => VERDICT_LABELS[level]),
  };
}
