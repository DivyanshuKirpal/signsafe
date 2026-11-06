/**
 * check:env - reports which configuration variables are present or missing.
 *
 * It never prints a value. It reads .env.local (if it exists) into this
 * process only, then prints one status per variable name:
 *   present | missing | placeholder (still REPLACE_ME) | default (optional, unset)
 * plus a few safety checks (devnet URL, no secrets in NEXT_PUBLIC_ variables).
 * Exits 1 if a required variable is missing or a safety check fails.
 */
import { existsSync } from "node:fs";

/** Environment variables by name (a plain map, so tests can pass partial objects). */
export type EnvMap = Record<string, string | undefined>;

export type VarStatus = "present" | "missing" | "placeholder" | "default";

export interface VarSpec {
  name: string;
  /** Required unless the predicate says otherwise for the current env. */
  required: (env: EnvMap) => boolean;
}

export const VARS: VarSpec[] = [
  { name: "SOLANA_RPC_URL", required: () => true },
  { name: "SOLANA_RPC_FALLBACK_URL", required: () => false },
  // The key is only needed while the AI step is switched on.
  { name: "GEMINI_API_KEY", required: (env) => env.AI_ENABLED !== "false" },
  { name: "GEMINI_MODEL", required: () => false },
  { name: "GEMINI_FALLBACK_MODEL", required: () => false },
  { name: "AI_ENABLED", required: () => false },
  { name: "NEXT_PUBLIC_SOLANA_CLUSTER", required: () => false },
  { name: "NEXT_PUBLIC_RPC_URL", required: () => false },
];

export function statusOf(value: string | undefined, required: boolean): VarStatus {
  if (value === undefined || value.trim() === "") return required ? "missing" : "default";
  if (value.includes("REPLACE_ME")) return "placeholder";
  return "present";
}

/** Safety checks. Messages name the variable, never its value. */
export function safetyProblems(env: EnvMap): string[] {
  const problems: string[] = [];
  for (const name of ["SOLANA_RPC_URL", "SOLANA_RPC_FALLBACK_URL", "NEXT_PUBLIC_RPC_URL"]) {
    const value = env[name];
    if (value && !value.includes("REPLACE_ME") && !/devnet/i.test(value)) {
      problems.push(`${name} does not look like a devnet URL. SignSafe is devnet only.`);
    }
  }
  const cluster = env.NEXT_PUBLIC_SOLANA_CLUSTER;
  if (cluster && cluster !== "devnet") {
    problems.push("NEXT_PUBLIC_SOLANA_CLUSTER must be 'devnet'.");
  }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    if (/api-key=|AIza|key=/i.test(value)) {
      problems.push(`${name} looks like it contains a key. NEXT_PUBLIC_ values reach the browser.`);
    }
  }
  return problems;
}

function main(): void {
  const file = ".env.local";
  if (existsSync(file)) {
    process.loadEnvFile(file);
    console.log(`${file}: found`);
  } else {
    console.log(`${file}: not found (copy .env.example to .env.local and fill in values)`);
  }

  let failed = false;
  for (const spec of VARS) {
    const required = spec.required(process.env);
    const status = statusOf(process.env[spec.name], required);
    if (required && status !== "present") failed = true;
    const tag = required ? "required" : "optional";
    console.log(`  ${spec.name.padEnd(28)} ${status.padEnd(12)} (${tag})`);
  }
  const problems = safetyProblems(process.env);
  for (const problem of problems) console.log(`  WARNING: ${problem}`);

  if (failed || problems.length > 0) {
    console.log("check:env: not ready.");
    process.exit(1);
  }
  console.log("check:env: ok.");
}

if (process.argv[1] && /check-env\.ts$/.test(process.argv[1])) {
  main();
}
