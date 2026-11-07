"use client";

import { createContext, useContext, useState } from "react";
import { shortAddress } from "../lib/solana/format";

/** The optional "your address" from the form. Only used to add a "(you)" label. */
export const UserAddressContext = createContext<string | undefined>(undefined);

/**
 * A shortened address; the full value is in the tooltip and for screen
 * readers. Optional copy button. Marked "(you)" when it matches the address
 * the user entered.
 */
export function Address({ value, copy = false }: { value: string; copy?: boolean }) {
  const userAddress = useContext(UserAddressContext);
  const [copied, setCopied] = useState(false);
  const short = shortAddress(value);
  const isYou = userAddress !== undefined && userAddress === value;

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the full address is still in the tooltip.
    }
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      {short === value ? (
        <span className="font-mono break-all">{value}</span>
      ) : (
        <span className="font-mono" title={value}>
          <span aria-hidden="true">{short}</span>
          <span className="sr-only">{value}</span>
        </span>
      )}
      {isYou && <span className="text-xs font-semibold">(you)</span>}
      {copy && !value.startsWith("?") && (
        <button
          type="button"
          onClick={copyValue}
          className="cursor-pointer rounded border border-border px-1 text-[10px] leading-4 text-muted hover:bg-cream"
          aria-label={`Copy address ${value}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      {copy && (
        <span role="status" className="sr-only">
          {copied ? "Address copied" : ""}
        </span>
      )}
    </span>
  );
}
