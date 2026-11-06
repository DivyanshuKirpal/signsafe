"use client";

import { ThemeToggle } from "./theme-toggle";

export function AppHeader() {
  return (
    <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight">SignSafe</span>
        {/* The cluster is fixed: everything SignSafe sends or simulates is devnet only. */}
        <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium">
          Devnet
        </span>
      </div>
      <ThemeToggle />
    </header>
  );
}
