"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { LIMITS } from "../lib/config";

interface TxInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
}

export function TxInput({ value, onChange, onSubmit, busy }: TxInputProps) {
  const length = value.trim().length;
  const tooLong = value.length > LIMITS.maxInputChars;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!busy && length > 0) onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+Enter (or Cmd+Enter) submits, a common shortcut for multi-line inputs.
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) handleSubmit(event);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor="tx-input" className="block text-sm font-medium">
        Transaction (base64, signed or unsigned)
      </label>
      <textarea
        id="tx-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={6}
        spellCheck={false}
        autoComplete="off"
        placeholder="Paste a serialized transaction, for example AQAAAA..."
        aria-describedby="tx-input-help"
        className="w-full rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed break-all"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="tx-input-help" className={`text-xs ${tooLong ? "text-destructive" : "text-muted"}`}>
          {value.length.toLocaleString("en-US")} / {LIMITS.maxInputChars.toLocaleString("en-US")} characters
          {tooLong ? " (too long)" : ""}. Ctrl+Enter also checks.
        </p>
        <button
          type="submit"
          disabled={busy || length === 0}
          aria-busy={busy}
          className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Checking..." : "Check"}
        </button>
      </div>
    </form>
  );
}
