/**
 * Simulation and state diff (ARCHITECTURE section 9.3).
 *
 *   1. watch list candidates: fee payer, signers, resolved writable accounts
 *   2. pre-state: getMultipleAccounts (jsonParsed), plus the mints of any
 *      token accounts found
 *   3. cap the list (signers first); anything dropped becomes a warning
 *   4. simulateTransaction (sigVerify off, replaceRecentBlockhash on, inner
 *      instructions on, post-state of the watched accounts in jsonParsed)
 *   5. diff pre vs post, decode inner instructions, look up token decimals,
 *      map errors to plain messages
 *
 * Nothing is signed or sent. A failed simulation is a result, not an exception;
 * only an unreachable RPC throws (SimulationUnavailableError).
 */
import {
  address,
  type Base64EncodedWireTransaction,
  isSolanaError,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { LIMITS } from "../config";
import type { DecodedIx, DecodedTx, SimulationResult, WatchedAccount } from "../types";
import { type AccountSnapshot, toAccountState, toSnapshot } from "./accounts";
import { withoutSignatures } from "./decode";
import { describeInstruction } from "./describe";
import { shortAddress } from "./format";
import { decodeInnerInstructions } from "./inner";
import { isTokenProgram } from "./programs";
import { redactSecrets } from "./rpc";
import { mapRpcRefusal, mapSimulationError } from "./sim-errors";
import { diffStates } from "./state-diff";
import { baseCandidates, mintCandidates, selectWatched, type WatchCandidate } from "./watch-list";

/** The RPC could not be reached (network, timeout, HTTP errors after retry). */
export class SimulationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationUnavailableError";
  }
}

type SignSafeRpcApi = Rpc<SolanaRpcApi>;

/** JSON-RPC errors (the node answered but refused) carry a server message. */
function serverMessage(error: unknown): string | undefined {
  if (!isSolanaError(error)) return undefined;
  const message = (error.context as { __serverMessage?: unknown }).__serverMessage;
  return typeof message === "string" ? message : undefined;
}

function unavailable(error: unknown): SimulationUnavailableError {
  const reason = error instanceof Error ? error.message : String(error);
  return new SimulationUnavailableError(redactSecrets(reason));
}

async function fetchAccounts(
  rpc: SignSafeRpcApi,
  addresses: readonly string[],
  into: Map<string, AccountSnapshot | null>,
): Promise<bigint | undefined> {
  let slot: bigint | undefined;
  for (let i = 0; i < addresses.length; i += LIMITS.accountsPerRequest) {
    const chunk = addresses.slice(i, i + LIMITS.accountsPerRequest);
    const result = await rpc
      .getMultipleAccounts(chunk.map((a) => address(a)), { encoding: "jsonParsed", commitment: "confirmed" })
      .send();
    slot = result.context.slot;
    result.value.forEach((account, j) => into.set(chunk[j], toSnapshot(account)));
  }
  return slot;
}

function capLogs(logs: readonly string[] | null | undefined): { logs: string[]; truncated: boolean } {
  const all = logs ?? [];
  const kept = all.slice(0, LIMITS.maxLogLines).map((line) =>
    line.length > LIMITS.maxLogLineChars ? `${line.slice(0, LIMITS.maxLogLineChars)}...` : line,
  );
  return { logs: kept, truncated: all.length > LIMITS.maxLogLines || all.some((l) => l.length > LIMITS.maxLogLineChars) };
}

const TOKEN_ACCOUNT_KEYS = ["source", "account", "token", "destination"];

/**
 * Plain Transfer/Approve/Burn/MintTo carry no decimals. Look up the mint and
 * decimals from the token account (or mint) state fetched for the diff.
 */
export function attachTokenInfo(
  ix: DecodedIx,
  pre: ReadonlyMap<string, AccountSnapshot | null>,
  post: ReadonlyMap<string, AccountSnapshot | null>,
): DecodedIx {
  if (!isTokenProgram(ix.programId) || ix.token || typeof ix.args.decimals === "number") return ix;
  const lookup = (a: string | undefined) => (a ? (pre.get(a) ?? post.get(a) ?? null) : null);
  for (const key of TOKEN_ACCOUNT_KEYS) {
    const token = lookup(ix.accounts[key])?.token;
    if (token) {
      const next = { ...ix, token: { mint: token.mint, decimals: token.decimals } };
      return { ...next, summary: describeInstruction(next) };
    }
  }
  const mintAddress = ix.accounts.mint;
  const mint = lookup(mintAddress)?.mint;
  if (mint && mintAddress) {
    const next = { ...ix, token: { mint: mintAddress, decimals: mint.decimals } };
    return { ...next, summary: describeInstruction(next) };
  }
  return ix;
}

export interface SimulateOutput {
  simulation: SimulationResult;
  /** The decoded transaction with token decimals attached and any watch-list warning added. */
  decoded: DecodedTx;
}

export async function simulateDecoded(
  rpc: SignSafeRpcApi,
  base64: string,
  decoded: DecodedTx,
): Promise<SimulateOutput> {
  // 1-2. Candidates and pre-state.
  const candidates: WatchCandidate[] = baseCandidates(decoded);
  const pre = new Map<string, AccountSnapshot | null>();
  let preSlot: bigint | undefined;
  try {
    preSlot = await fetchAccounts(rpc, candidates.map((c) => c.address), pre);
  } catch (error) {
    throw unavailable(error);
  }
  const mints = mintCandidates(candidates, pre);
  if (mints.length > 0) {
    try {
      await fetchAccounts(rpc, mints, pre);
    } catch {
      // Not fatal: token accounts already carry their decimals.
    }
    candidates.push(...mints.map((m) => ({ address: m, roles: ["mint" as const] })));
  }

  // Pre-transaction state, exposed for the rules (owner and balance checks).
  const preState = [...pre].map(([a, snapshot]) => toAccountState(a, snapshot));

  // 3. Cap.
  const { watched, dropped } = selectWatched(candidates, decoded.signers, pre, LIMITS.maxWatchedAccounts);
  const warnings = [...decoded.warnings];
  const droppedWritable = dropped.filter((d) => d.roles.includes("writable")).map((d) => d.address);
  if (droppedWritable.length > 0) {
    warnings.push({
      code: "WATCH_LIST_TRUNCATED",
      message: `${droppedWritable.length} account(s) this transaction writes to were not compared (limit ${LIMITS.maxWatchedAccounts}): ${droppedWritable.map(shortAddress).join(", ")}.`,
    });
  }
  // Unresolved lookup-table accounts are writable but cannot be watched at all.
  const unresolvedWritable = decoded.accountKeys.filter((k) => k.writable && !k.resolved).map((k) => k.address);
  const notWatched = [...droppedWritable, ...unresolvedWritable];

  // 4. Simulate.
  const addresses = watched.map((w) => w.address);
  let value;
  let simSlot: bigint;
  try {
    const result = await rpc
      // Signatures are never sent: they are not checked (sigVerify off), and a signed
      // transaction should not leave the server in a form someone could submit.
      .simulateTransaction(withoutSignatures(base64) as Base64EncodedWireTransaction, {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        innerInstructions: true,
        commitment: "confirmed",
        accounts: { addresses: addresses.map((a) => address(a)), encoding: "jsonParsed" },
      })
      .send();
    value = result.value;
    simSlot = result.context.slot;
  } catch (error) {
    const refused = serverMessage(error);
    if (refused === undefined) throw unavailable(error);
    // The node answered but refused the transaction (for example a deactivated lookup table).
    const noPost = new Map<string, AccountSnapshot | null>();
    return {
      decoded: { ...decoded, instructions: decoded.instructions.map((ix) => attachTokenInfo(ix, pre, noPost)), warnings },
      simulation: {
        ran: true,
        ok: false,
        error: mapRpcRefusal(redactSecrets(refused)),
        logs: [],
        logsTruncated: false,
        innerInstructions: [],
        changes: [],
        watched: watched.map((w) => ({ address: w.address, roles: w.roles, existedBefore: pre.get(w.address) != null, existsAfter: null })),
        notWatched,
        preState,
        slots: { preState: preSlot?.toString() },
      },
    };
  }

  // 5. Diff and decode.
  const post = new Map<string, AccountSnapshot | null>();
  const postAccounts: readonly unknown[] = value.accounts ?? [];
  addresses.forEach((a, i) => post.set(a, toSnapshot(postAccounts[i] ?? null)));
  const feeLamports = value.fee ?? undefined;
  const ok = value.err === null;

  const changes = ok ? diffStates(addresses, pre, post, { feePayer: decoded.feePayer, feeLamports }) : [];
  const inner = decodeInnerInstructions(value.innerInstructions, decoded.accountKeys).map((ix) =>
    attachTokenInfo(ix, pre, post),
  );
  const instructions = decoded.instructions.map((ix) => attachTokenInfo(ix, pre, post));
  const { logs, truncated } = capLogs(value.logs);

  const watchedOut: WatchedAccount[] = watched.map((w) => ({
    address: w.address,
    roles: w.roles,
    existedBefore: pre.get(w.address) != null,
    existsAfter: ok ? post.get(w.address) != null : null,
  }));

  return {
    decoded: { ...decoded, instructions, warnings },
    simulation: {
      ran: true,
      ok,
      error: ok ? undefined : mapSimulationError(value.err, decoded),
      feeLamports: feeLamports?.toString(),
      unitsConsumed: value.unitsConsumed !== undefined ? Number(value.unitsConsumed) : undefined,
      logs,
      logsTruncated: truncated,
      innerInstructions: inner,
      changes,
      watched: watchedOut,
      notWatched,
      preState,
      slots: { preState: preSlot?.toString(), simulation: simSlot.toString() },
    },
  };
}
