import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { InstructionList } from "../app/components/instruction-list";
import type { DecodedIx } from "../app/lib/types";

afterEach(cleanup);

const payment: DecodedIx = {
  path: "0",
  programId: "11111111111111111111111111111111",
  programName: "System Program",
  known: true,
  action: "transferSol",
  accounts: {
    source: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    destination: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
  },
  args: { amount: "10000000" },
  inner: false,
  summary: "Send 0.01 SOL from 9xQe...VFin to 4Nd1...DB4T.",
  accountCount: 2,
  dataLength: 12,
};

const approval: DecodedIx = {
  path: "1",
  programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  programName: "SPL Token",
  known: true,
  action: "approve",
  accounts: {
    source: "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9",
    delegate: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
    owner: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  },
  args: { amount: "18446744073709551615" },
  inner: false,
  summary: "Allow HN7c...YWrH to spend UNLIMITED (u64 max) from token account 2wmV...dri9.",
  accountCount: 3,
  dataLength: 9,
};

describe("InstructionList", () => {
  test("shows the payment and the unlimited approval as different actions", () => {
    render(<InstructionList instructions={[payment, approval]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("System Program");
    expect(items[0].textContent).toContain("Send 0.01 SOL");
    expect(items[1].textContent).toContain("SPL Token");
    expect(items[1].textContent).toContain("UNLIMITED (u64 max)");
    // Full addresses are available to screen readers and on hover.
    expect(screen.getAllByTitle("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH").length).toBeGreaterThan(0);
  });

  test("labels unknown programs in text and renders memo text as plain text", () => {
    const unknown: DecodedIx = {
      ...payment,
      path: "0",
      programId: "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
      programName: "Unknown program",
      known: false,
      action: "unknown",
      summary: "Call an unknown program Fg6P...sLnS with 2 account(s) and 9 byte(s) of data.",
    };
    const memo: DecodedIx = {
      ...payment,
      path: "1",
      programName: "Memo",
      action: "memo",
      args: { text: "<img src=x onerror=alert(1)>", truncated: false, untrusted: true },
      summary: 'Attach a memo (text written by the sender): "<img src=x onerror=alert(1)>".',
    };
    const { container } = render(<InstructionList instructions={[unknown, memo]} />);
    expect(screen.getByText("Not a known program")).toBeTruthy();
    expect(screen.getByText(/Treat it as untrusted/)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  test("handles an empty instruction list", () => {
    render(<InstructionList instructions={[]} />);
    expect(screen.getByText("This transaction has no instructions.")).toBeTruthy();
  });
});
