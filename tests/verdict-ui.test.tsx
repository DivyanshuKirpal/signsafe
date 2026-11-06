import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { UserAddressContext } from "../app/components/address";
import { FlagList } from "../app/components/flag-list";
import { VerdictCard } from "../app/components/verdict-card";
import type { RiskFlag, Verdict } from "../app/lib/types";

afterEach(cleanup);

const WALLET = "Hjc6jdakkNx83LTEfsMr8XEj5LjrSENiPLehSSpbzVRR";
const TOKEN_ACCOUNT = "9JywdjbDkb8a3nqcouuLV8TDZ2UA8whwpMN5Eett6b2h";
const DELEGATE = "7dP9TBMBjSs4PBPQ9pCU4BX4k9X8aeaUYR4A6WKLK7XL";

const approvalFlag: RiskFlag = {
  ruleId: "R-APPROVE",
  relatedRuleIds: ["R-DELEGATE-STATE"],
  severity: "danger",
  title: "Unlimited permission to spend tokens from a token account",
  detail: "7dP9...K7XL would be allowed to move UNLIMITED (u64 max) from token account 9Jyw...6b2h (owned by Hjc6...zVRR) at any time, without asking again.",
  account: TOKEN_ACCOUNT,
  evidence: { tokenAccount: TOKEN_ACCOUNT, delegate: DELEGATE, owner: WALLET, allowance: "UNLIMITED (u64 max)" },
  sources: [
    { type: "instruction", path: "0", inner: false, summary: "Allow 7dP9...K7XL to spend UNLIMITED (u64 max) from token account 9Jyw...6b2h." },
    { type: "stateChange", address: TOKEN_ACCOUNT, changeKind: "delegate", description: "Spending permission (delegate): no one -> 7dP9...K7XL may spend UNLIMITED (u64 max)" },
  ],
};

const simFlag: RiskFlag = {
  ruleId: "R-SIM-FAILED",
  severity: "info",
  title: "The simulation failed",
  detail: "The fee payer has no SOL on devnet.",
  evidence: { simulation: "ran and failed" },
  sources: [{ type: "simulation", code: "FEE_PAYER_UNFUNDED", message: "The fee payer has no SOL on devnet." }],
};

const verdict = (level: Verdict["level"], label: string, complete: boolean, flags: RiskFlag[]): Verdict => ({
  level,
  label,
  reason: flags[0]?.title ?? "The decoded instructions and the simulated account changes match none of SignSafe's risk rules.",
  complete,
  flags,
});

describe("VerdictCard", () => {
  test("Danger with an incomplete check keeps Danger and says what else is missing", () => {
    render(<VerdictCard verdict={verdict("DANGER", "Danger: don't sign unless you're certain", false, [approvalFlag, simFlag])} />);
    expect(screen.getByRole("heading", { name: "Danger: don't sign unless you're certain" })).toBeTruthy();
    expect(screen.getByText("Danger")).toBeTruthy(); // text label, not colour only
    expect(screen.getByText(/1 issue found/)).toBeTruthy();
    expect(screen.getByText(/could not be checked as well/)).toBeTruthy();
    expect(screen.getByText("Verdict from fixed rules, not from AI")).toBeTruthy();
  });

  test("No known risks found never claims the transaction is safe", () => {
    const { container } = render(<VerdictCard verdict={verdict("LOW_RISK", "No known risks found", true, [])} />);
    expect(screen.getByRole("heading", { name: "No known risks found" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bsafe\b|guarantee/i);
  });
});

describe("FlagList", () => {
  test("each flag shows what triggered it: the instruction and the account change", () => {
    render(
      <UserAddressContext.Provider value={WALLET}>
        <FlagList flags={[approvalFlag, simFlag]} />
      </UserAddressContext.Provider>,
    );
    const [approval, sim] = screen.getAllByRole("listitem").filter((li) => li.querySelector("h3"));
    expect(approval.textContent).toContain("Danger");
    expect(approval.textContent).toContain("Instruction #0: Allow 7dP9...K7XL");
    expect(approval.textContent).toContain("Account change at");
    expect(approval.textContent).toContain("Spending permission (delegate): no one -> 7dP9...K7XL");
    expect(approval.textContent).toContain("R-APPROVE + R-DELEGATE-STATE");
    // The address the user entered is marked, nothing else changes.
    expect(approval.textContent).toContain("(you)");
    expect(screen.getAllByRole("button", { name: `Copy address ${DELEGATE}` }).length).toBe(1);
    expect(sim.textContent).toContain("Note");
    expect(sim.textContent).toContain("Simulation: The fee payer has no SOL on devnet.");
  });

  test("renders nothing without flags", () => {
    const { container } = render(<FlagList flags={[]} />);
    expect(container.textContent).toBe("");
  });
});
