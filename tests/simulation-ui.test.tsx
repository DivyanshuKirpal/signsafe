import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { CouldNotCheck } from "../app/components/could-not-check";
import { SimulationPanel } from "../app/components/simulation-panel";
import type { DecodedTx, SimulationResult } from "../app/lib/types";

afterEach(cleanup);

const WALLET = "Hjc6jdakkNx83LTEfsMr8XEj5LjrSENiPLehSSpbzVRR";
const RECIPIENT = "6ZUNcCbUqnHjFcgeswMXLmVURjTaHZz3E1uNBLxL5EDo";
const TOKEN_ACCOUNT = "9JywdjbDkb8a3nqcouuLV8TDZ2UA8whwpMN5Eett6b2h";
const DELEGATE = "4EpLxu3nDuBY2PsjSfGgkQvTXmFm7LXXQxJPtM2bFuzC";

const base: SimulationResult = {
  ran: true,
  ok: true,
  feeLamports: "5000",
  unitsConsumed: 150,
  logs: ["Program 11111111111111111111111111111111 invoke [1]", "<script>alert(1)</script>"],
  logsTruncated: false,
  innerInstructions: [],
  changes: [],
  watched: [
    { address: WALLET, roles: ["feePayer", "signer", "writable"], existedBefore: true, existsAfter: true },
    { address: RECIPIENT, roles: ["writable"], existedBefore: false, existsAfter: true },
    { address: TOKEN_ACCOUNT, roles: ["writable"], existedBefore: true, existsAfter: true },
  ],
  notWatched: [],
  preState: [],
};

describe("SimulationPanel", () => {
  test("SOL transfer: sender and recipient changes, fee shown", () => {
    render(
      <SimulationPanel
        simulation={{
          ...base,
          changes: [
            { address: WALLET, kind: "sol", before: "506657270258", after: "506647265258", delta: "-10005000", includesFeeLamports: "5000" },
            { address: RECIPIENT, kind: "created", before: null, after: "11111111111111111111111111111111" },
            { address: RECIPIENT, kind: "sol", before: "0", after: "10000000", delta: "10000000" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/the transaction would succeed/)).toBeTruthy();
    expect(screen.getByText(/Network fee: 0.000005 SOL/)).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("fee payer, signer");
    expect(items[0].textContent).toContain("(-0.010005 SOL)");
    expect(items[0].textContent).toContain("Includes the network fee of 0.000005 SOL");
    expect(items[1].textContent).toContain("Account created");
    expect(items[2].textContent).toContain("(+0.01 SOL)");
    // Logs render as text, never as HTML.
    expect(document.querySelector("script")).toBeNull();
  });

  test("approval: the delegate change is shown although no tokens move", () => {
    render(
      <SimulationPanel
        simulation={{
          ...base,
          changes: [
            {
              address: TOKEN_ACCOUNT,
              kind: "delegate",
              before: null,
              after: DELEGATE,
              allowanceBefore: "0",
              allowanceAfter: "18446744073709551615",
              mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
              decimals: 6,
              tokenAccountOwner: WALLET,
            },
          ],
        }}
      />,
    );
    const item = screen.getAllByRole("listitem")[0];
    expect(item.textContent).toContain("Spending permission (delegate)");
    expect(item.textContent).toContain("no one");
    expect(item.textContent).toContain("4EpL...FuzC may spend UNLIMITED (u64 max)");
    expect(item.textContent).toContain("token account of");
  });
});

describe("CouldNotCheck", () => {
  const decoded = { warnings: [{ code: "LOOKUP_TABLE_UNRESOLVED", message: "Lookup table 8Wf5...VwTt could not be loaded." }] } as unknown as DecodedTx;

  test("lists warnings, a failed simulation and accounts not compared", () => {
    render(
      <CouldNotCheck
        decoded={decoded}
        simulation={{
          ...base,
          ok: false,
          changes: [],
          error: { code: "FEE_PAYER_UNFUNDED", userMessage: "The fee payer has no SOL on devnet." },
          notWatched: ["?lookup:8Wf5...VwTt#0"],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "What could not be checked" })).toBeTruthy();
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/The simulation failed/)).toBeTruthy();
    expect(screen.getByText(/before\/after state was not compared/)).toBeTruthy();
  });

  test("renders nothing when everything was checked", () => {
    const { container } = render(<CouldNotCheck decoded={{ warnings: [] } as unknown as DecodedTx} simulation={base} />);
    expect(container.textContent).toBe("");
  });
});
