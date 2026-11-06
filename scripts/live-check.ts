/**
 * live:check - runs the real decode + simulate pipeline against devnet using
 * existing public devnet accounts. Simulation only: nothing is signed or sent,
 * and no keys are needed (signature checks are off in simulation).
 *
 *   npm run live:check              run the cases and check expectations
 *   npm run live:check -- --record  also save the raw RPC traffic of cases that
 *                                   have no fixture yet in tests/fixtures/live/
 *   npm run live:check -- --record --overwrite   re-record every fixture
 *
 * Cases:
 *   sol-transfer        0.01 SOL from a funded devnet wallet to a fresh address
 *   token-approval      unlimited Approve on that wallet's existing token account
 *   lookup-table        v0 transfer whose recipient is loaded from an existing
 *                       devnet address lookup table
 *   unfunded-fee-payer  fee payer that does not exist on devnet (simulation fails)
 *   approval-unfunded-fee-payer  unlimited Approve with a non-existent fee payer:
 *                       simulation fails, but the verdict must stay Danger
 *
 * The RPC URL is read from .env.local and never printed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  address,
  type Address,
  createNoopSigner,
  fetchAddressesForLookupTables,
  generateKeyPairSigner,
  lamports,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getApproveInstruction } from "@solana-program/token";
import { analyzeTransaction } from "../app/lib/analyze";
import { U64_MAX } from "../app/lib/config";
import { describeChange } from "../app/lib/solana/describe-change";
import { shortAddress } from "../app/lib/solana/format";
import { createSignSafeRpc, ensureDevnet, redactSecrets, type SignSafeRpc } from "../app/lib/solana/rpc";
import { createRecordingTransport, type RecordedExchange, toFixtureJson } from "../app/lib/solana/rpc-recording";
import type { AnalyzeResponse } from "../app/lib/types";
import { buildTxBase64 } from "../tests/helpers/build-tx";

const RECORD = process.argv.includes("--record");
/** Without --overwrite, existing fixtures are kept so earlier recordings stay stable. */
const OVERWRITE = process.argv.includes("--overwrite");
const FIXTURE_DIR = "tests/fixtures/live";
/** Circle's devnet USDC mint: widely held on devnet, so funded holders exist. */
const USDC_DEVNET = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
/** Existing devnet lookup tables found on 7 Nov 2026 (re-checked on every run). */
const LOOKUP_TABLE_CANDIDATES = [
  "4HWdfpj3pbNQfV1fHoGx1tykAJVzUx6Brz3Wru8ZzVK6",
  "9GaqMBcCQchyL1ybT5WqRs2RCEBuWHodYsMAuCgjc55k",
  "BjxWCHdSZcG3MGp7JjxcgwLiQNCPmoMFyPUUqneRsuuN",
];
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SYSVAR_OWNER = "Sysvar1111111111111111111111111111111111111";

type Analysis = Omit<AnalyzeResponse, "requestId">;

interface CaseResult {
  name: string;
  analysis: Analysis;
  checks: { label: string; pass: boolean }[];
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !value.includes("REPLACE_ME") ? value : undefined;
}

function newRpc(sink?: RecordedExchange[]): SignSafeRpc {
  const primary = env("SOLANA_RPC_URL") ?? env("SOLANA_RPC_FALLBACK_URL");
  if (!primary) throw new Error("SOLANA_RPC_URL is missing in .env.local");
  const fallback = env("SOLANA_RPC_FALLBACK_URL");
  return createSignSafeRpc(primary, fallback, sink ? (t) => createRecordingTransport(t, sink) : undefined);
}

/** Discovery calls only: retry a few times with backoff (free RPC plans rate-limit bursts). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 1_500 * i));
    }
  }
}

/** A funded, normal (System-owned) wallet that holds devnet USDC. */
async function findWalletWithTokens(client: SignSafeRpc) {
  const largest = await withRetry(() => client.rpc.getTokenLargestAccounts(USDC_DEVNET, { commitment: "confirmed" }).send());
  const tokenAccounts = largest.value.slice(0, 20).map((a) => a.address);
  const parsed = await withRetry(() => client.rpc.getMultipleAccounts(tokenAccounts, { encoding: "jsonParsed" }).send());
  const owners = parsed.value.map((a) => {
    const info = (a?.data as { parsed?: { info?: { owner?: string; tokenAmount?: { amount?: string } } } })?.parsed?.info;
    return info?.owner && info.tokenAmount?.amount !== "0" ? address(info.owner) : undefined;
  });
  const wallets = await client.rpc
    .getMultipleAccounts(owners.map((o) => o ?? USDC_DEVNET), { encoding: "base64" })
    .send();
  for (let i = 0; i < tokenAccounts.length; i++) {
    const w = wallets.value[i];
    if (owners[i] && w && w.owner === SYSTEM_PROGRAM && !w.executable && w.lamports > 50_000_000n) {
      return { wallet: owners[i] as Address, tokenAccount: tokenAccounts[i] };
    }
  }
  throw new Error("no funded devnet wallet holding USDC was found");
}

const U64_MAX_TEXT = U64_MAX.toString();

interface TableChoice {
  table: Address;
  entries: Address[];
  recipient: Address;
}

/**
 * Existing lookup tables and, for each, an entry that can receive SOL
 * (any non-executable, non-sysvar account, or an empty address). A table is "active" when it has no
 * deactivation slot; entries added in the latest extension are skipped
 * because they only become usable in the next slot.
 */
async function findLookupTables(client: SignSafeRpc, exclude: string) {
  let active: TableChoice | undefined;
  let deactivated: TableChoice | undefined;
  for (const candidate of LOOKUP_TABLE_CANDIDATES) {
    try {
      const table = address(candidate);
      const account = await withRetry(() =>
        client.rpc.getAccountInfo(table, { encoding: "jsonParsed", commitment: "confirmed" }).send(),
      );
      const info = (account.value?.data as { parsed?: { info?: Record<string, unknown> } })?.parsed?.info;
      if (!info) continue;
      const isActive = String(info.deactivationSlot) === U64_MAX_TEXT;
      if ((isActive && active) || (!isActive && deactivated)) continue;
      const entries = (await fetchAddressesForLookupTables([table], client.rpc))[table] ?? [];
      const usableCount = Math.min(Number(info.lastExtendedSlotStartIndex ?? entries.length), 40);
      const sample = entries.slice(0, usableCount);
      const infos = await client.rpc.getMultipleAccounts(sample, { encoding: "base64" }).send();
      const index = sample.findIndex((addr, i) => {
        const a = infos.value[i];
        // Anyone can credit lamports to a non-executable account; sysvars are read-only.
        const receivable = a === null || (!a.executable && a.owner !== SYSVAR_OWNER);
        return receivable && addr !== exclude && !addr.startsWith("Sysvar");
      });
      if (index < 0) continue;
      const choice = { table, entries, recipient: sample[index] };
      if (isActive) active = choice;
      else deactivated = choice;
    } catch {
      // Table closed or unreadable: try the next one.
    }
  }
  return { active, deactivated };
}

async function runCase(
  name: string,
  description: string,
  txBase64: string,
  expectations: (a: Analysis) => { label: string; pass: boolean }[],
): Promise<CaseResult> {
  const sink: RecordedExchange[] = [];
  const client = newRpc(sink);
  const analysis = await analyzeTransaction(txBase64, { rpc: client, log: (m) => console.log(`  [log] ${m}`) });
  const checks = expectations(analysis);
  const fixturePath = `${FIXTURE_DIR}/${name}.json`;
  if (RECORD && (OVERWRITE || !existsSync(fixturePath))) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const fixture = {
      case: name,
      description,
      source: "live devnet RPC, recorded by scripts/live-check.ts",
      endpoint: analysis.simulation.rpcEndpoint ?? null,
      recordedAt: new Date().toISOString(),
      txBase64,
      exchanges: sink,
    };
    writeFileSync(fixturePath, toFixtureJson(fixture) + "\n");
    console.log(`  recorded ${fixturePath}`);
  }
  return { name, analysis, checks };
}

function report(result: CaseResult): void {
  const { decoded, simulation } = result.analysis;
  console.log(`\n=== ${result.name} (live devnet, endpoint: ${simulation.rpcEndpoint ?? "n/a"})`);
  for (const ix of decoded.instructions) console.log(`  instruction #${ix.path}: ${ix.summary}`);
  for (const ix of simulation.innerInstructions) console.log(`  inner #${ix.path}: ${ix.summary}`);
  console.log(
    `  simulation: ran=${simulation.ran} ok=${simulation.ok}` +
      (simulation.feeLamports ? ` fee=${simulation.feeLamports} lamports` : "") +
      (simulation.unitsConsumed !== undefined ? ` units=${simulation.unitsConsumed}` : ""),
  );
  if (simulation.error) console.log(`  error: [${simulation.error.code}] ${simulation.error.userMessage}`);
  const { verdict } = result.analysis;
  console.log(`  verdict: ${verdict.label}${verdict.complete ? "" : " (check incomplete)"}`);
  for (const flag of verdict.flags) console.log(`    [${flag.severity}] ${flag.ruleId}${flag.relatedRuleIds ? " + " + flag.relatedRuleIds.join(", ") : ""}: ${flag.title}`);
  for (const change of simulation.changes) {
    const t = describeChange(change);
    console.log(
      `  change ${shortAddress(change.address)}: ${t.label}: ${t.before} -> ${t.after}` +
        (t.delta ? ` (${t.delta})` : "") +
        (t.note ? `  [${t.note}]` : ""),
    );
  }
  for (const w of decoded.warnings) console.log(`  could not check: ${w.message}`);
  for (const check of result.checks) console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.label}`);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    console.error("live:check: .env.local not found. Copy .env.example to .env.local and fill in SOLANA_RPC_URL.");
    process.exit(1);
  }
  const discovery = newRpc();
  if (!(await ensureDevnet(discovery.rpc))) {
    console.error("live:check: the configured RPC is not devnet (genesis hash mismatch). Stopping.");
    process.exit(1);
  }
  console.log("Devnet confirmed by genesis hash. Finding existing devnet accounts...");
  const { wallet, tokenAccount } = await withRetry(() => findWalletWithTokens(discovery));
  console.log(`  wallet ${wallet} with token account ${tokenAccount} (devnet USDC)`);
  const tables = await findLookupTables(discovery, wallet);
  const lookup = tables.active;
  console.log(lookup ? `  active lookup table ${lookup.table} (${lookup.entries.length} entries), recipient ${lookup.recipient}` : "  no active lookup table found");
  if (tables.deactivated) console.log(`  deactivated lookup table ${tables.deactivated.table}`);

  const recipient = (await generateKeyPairSigner()).address;
  const delegate = (await generateKeyPairSigner()).address;
  const ghost = (await generateKeyPairSigner()).address;
  const owner = createNoopSigner(wallet);
  const amount = 10_000_000n;
  const results: CaseResult[] = [];

  results.push(
    await runCase(
      "sol-transfer",
      "0.01 SOL from an existing funded devnet wallet to a fresh address",
      buildTxBase64([getTransferSolInstruction({ source: owner, destination: recipient, amount: lamports(amount) })], {
        feePayer: wallet,
      }),
      (a) => {
        const sender = a.simulation.changes.find((c) => c.address === wallet && c.kind === "sol");
        const receiver = a.simulation.changes.find((c) => c.address === recipient && c.kind === "sol");
        const fee = BigInt(a.simulation.feeLamports ?? "-1");
        return [
          { label: "simulation succeeded", pass: a.simulation.ok },
          { label: "fee reported by the RPC", pass: fee > 0n },
          { label: "sender delta = -(0.01 SOL + fee) and labelled as including the fee", pass: sender?.delta === (-(amount + fee)).toString() && sender?.includesFeeLamports === fee.toString() },
          { label: "recipient delta = +0.01 SOL", pass: receiver?.delta === amount.toString() },
          { label: "recipient shown as a new account", pass: a.simulation.changes.some((c) => c.address === recipient && c.kind === "created") },
          { label: "verdict: No known risks found", pass: a.verdict.level === "LOW_RISK" && a.verdict.flags.length === 0 },
        ];
      },
    ),
  );

  results.push(
    await runCase(
      "token-approval",
      "unlimited Approve on an existing devnet USDC token account, delegate is a fresh address",
      buildTxBase64([getApproveInstruction({ source: tokenAccount, delegate, owner, amount: U64_MAX })], { feePayer: wallet }),
      (a) => {
        const d = a.simulation.changes.find((c) => c.address === tokenAccount && c.kind === "delegate");
        return [
          { label: "simulation succeeded", pass: a.simulation.ok },
          { label: "delegate changes to the new address", pass: d?.after === delegate },
          { label: "allowance becomes u64 max (unlimited)", pass: d?.allowanceAfter === U64_MAX.toString() },
          { label: "token balance unchanged (no token change reported)", pass: !a.simulation.changes.some((c) => c.kind === "token") },
          { label: "decimals looked up for the approve instruction", pass: typeof a.decoded.instructions[0].token?.decimals === "number" },
          { label: "verdict: Danger", pass: a.verdict.level === "DANGER" },
          {
            label: "one approval flag for the token account, merging instruction and state evidence",
            pass:
              a.verdict.flags.filter((f) => f.account === tokenAccount).length === 1 &&
              a.verdict.flags.some((f) => f.ruleId === "R-APPROVE" && f.relatedRuleIds?.includes("R-DELEGATE-STATE") && f.sources.length === 2),
          },
        ];
      },
    ),
  );

  if (lookup) {
    results.push(
      await runCase(
        "lookup-table",
        "v0 transfer of 0.01 SOL whose recipient is loaded from an existing devnet lookup table",
        buildTxBase64(
          [getTransferSolInstruction({ source: owner, destination: lookup.recipient, amount: lamports(amount) })],
          { version: 0, feePayer: wallet, lookupTables: { [lookup.table]: lookup.entries } },
        ),
        (a) => [
          { label: "transaction uses the lookup table", pass: a.decoded.lookupTables.some((t) => t.address === lookup.table) },
          { label: "lookup table resolved over RPC", pass: a.decoded.lookupTables.every((t) => t.resolved) },
          { label: "recipient address resolved from the table", pass: a.decoded.instructions[0].accounts.destination === lookup.recipient },
          { label: "simulation succeeded", pass: a.simulation.ok },
          { label: "recipient balance change detected", pass: a.simulation.changes.some((c) => c.address === lookup.recipient && c.kind === "sol" && c.delta === amount.toString()) },
          { label: "verdict: No known risks found", pass: a.verdict.level === "LOW_RISK" },
        ],
      ),
    );
  }

  if (tables.deactivated) {
    const dead = tables.deactivated;
    results.push(
      await runCase(
        "deactivated-lookup-table",
        "v0 transfer that uses a deactivated devnet lookup table (the node refuses it)",
        buildTxBase64(
          [getTransferSolInstruction({ source: owner, destination: dead.recipient, amount: lamports(amount) })],
          { version: 0, feePayer: wallet, lookupTables: { [dead.table]: dead.entries } },
        ),
        (a) => [
          { label: "simulation could not complete", pass: !a.simulation.ok },
          { label: "error mapped to LOOKUP_TABLE_INVALID", pass: a.simulation.error?.code === "LOOKUP_TABLE_INVALID" },
          { label: "no state changes claimed", pass: a.simulation.changes.length === 0 },
          { label: "verdict: Could not fully check", pass: a.verdict.level === "UNKNOWN" && !a.verdict.complete },
        ],
      ),
    );
  }

  results.push(
    await runCase(
      "unfunded-fee-payer",
      "transfer whose fee payer does not exist on devnet (simulation fails)",
      buildTxBase64(
        [getTransferSolInstruction({ source: createNoopSigner(ghost), destination: recipient, amount: lamports(amount) })],
        { feePayer: ghost },
      ),
      (a) => [
        { label: "simulation ran and failed", pass: a.simulation.ran && !a.simulation.ok },
        { label: "error mapped to FEE_PAYER_UNFUNDED", pass: a.simulation.error?.code === "FEE_PAYER_UNFUNDED" },
        { label: "no state changes claimed", pass: a.simulation.changes.length === 0 },
        { label: "verdict: Could not fully check", pass: a.verdict.level === "UNKNOWN" && !a.verdict.complete },
      ],
    ),
  );

  results.push(
    await runCase(
      "approval-unfunded-fee-payer",
      "unlimited Approve on the existing USDC token account, but the fee payer does not exist on devnet (simulation fails)",
      buildTxBase64([getApproveInstruction({ source: tokenAccount, delegate, owner, amount: U64_MAX })], { feePayer: ghost }),
      (a) => {
        const approval = a.verdict.flags.find((f) => f.ruleId === "R-APPROVE");
        return [
          { label: "simulation ran and failed", pass: a.simulation.ran && !a.simulation.ok },
          { label: "pre-transaction owner of the token account read from devnet", pass: approval?.evidence.owner === wallet },
          { label: "verdict stays Danger (independent instruction evidence)", pass: a.verdict.level === "DANGER" },
          { label: "incomplete check still reported", pass: !a.verdict.complete && a.verdict.flags.some((f) => f.ruleId === "R-SIM-FAILED") },
        ];
      },
    ),
  );

  for (const r of results) report(r);
  const failed = results.flatMap((r) => r.checks).filter((c) => !c.pass).length;
  if (!lookup) console.log("\nNOTE: lookup-table case skipped: no active devnet lookup table was found.");
  if (!tables.deactivated) console.log("NOTE: deactivated-lookup-table case skipped: none found.");
  console.log(`\nlive:check: ${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}${RECORD ? `; fixtures written to ${FIXTURE_DIR}/` : ""}.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`live:check: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
});
