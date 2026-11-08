/**
 * Server-only RPC access (ARCHITECTURE sections 7 and 9.7).
 *
 * - Endpoints come from SOLANA_RPC_URL (primary, e.g. Helius devnet; its URL
 *   contains the API key) and SOLANA_RPC_FALLBACK_URL (public devnet). URLs are
 *   never logged, returned or sent to the browser; callers only learn
 *   "primary" or "fallback".
 * - Every request has a 10 s timeout. A network error, timeout, HTTP 429/5xx
 *   or rate-limit reply is retried once after a short wait, on the fallback
 *   endpoint if there is one.
 * - Each endpoint is checked on its own before anything is sent to it: its
 *   genesis hash must be devnet's (devnetOnly). An endpoint that is not devnet
 *   is never used, so a mainnet URL set by mistake (primary or fallback) can
 *   never receive a request; if no endpoint passes, the request fails.
 */
import {
  type AddressesByLookupTableAddress,
  address,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isSolanaError,
  type Rpc,
  type RpcTransport,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type SolanaRpcApi,
} from "@solana/kit";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const RPC_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 400;

export type EndpointLabel = "primary" | "fallback";

export interface SignSafeRpc {
  rpc: Rpc<SolanaRpcApi>;
  /** The endpoint that answered the most recent request. */
  lastEndpoint(): EndpointLabel | undefined;
}

/** Removes anything that looks like a URL or an API key (RPC or Google) from text before logging it. */
export function redactSecrets(text: string): string {
  return text
    .replace(/api[-_]?key=[^&\s"']+/gi, "api-key=[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]")
    .replace(/https?:\/\/[^\s"']+/gi, "[url]");
}

const RATE_LIMIT_CODES = new Set([429, -32005, -32429]);

function isTransient(error: unknown): boolean {
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const status = error.context.statusCode;
    return status === 429 || status >= 500;
  }
  // fetch() network failures surface as TypeError; our timeout as an AbortError/TimeoutError.
  return error instanceof TypeError || (error instanceof Error && /abort|timeout/i.test(error.name));
}

function isRateLimitedReply(response: unknown): boolean {
  if (typeof response !== "object" || response === null || !("error" in response)) return false;
  const code = (response as { error?: { code?: unknown } }).error?.code;
  return typeof code === "number" && RATE_LIMIT_CODES.has(code);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Endpoint {
  label: EndpointLabel;
  transport: RpcTransport;
}

/**
 * An endpoint did not pass its devnet check: either it is another network
 * (notDevnet, remembered) or the check could not be completed (tried again on
 * the next request). The failover moves on to the next endpoint either way.
 */
export class EndpointCheckError extends Error {
  constructor(
    readonly label: EndpointLabel,
    readonly notDevnet: boolean,
  ) {
    super(notDevnet ? `the ${label} RPC endpoint is not Solana devnet` : `the ${label} RPC endpoint could not be checked`);
    this.name = "EndpointCheckError";
  }
}

/**
 * Wraps an endpoint so that no request reaches it before its own genesis hash
 * has been confirmed as devnet's. The check runs once per endpoint; a failed
 * check (network error, rate limit) is retried on the next request.
 */
export function devnetOnly(endpoint: Endpoint): Endpoint {
  let check: Promise<boolean> | null = null;
  const isDevnet = (signal?: AbortSignal): Promise<boolean> => {
    if (!check) {
      const pending = endpoint.transport<unknown>({
        payload: { jsonrpc: "2.0", id: 0, method: "getGenesisHash", params: [] },
        signal,
      }).then((reply) => {
        if (typeof reply === "object" && reply !== null && "result" in reply) {
          return (reply as { result: unknown }).result === DEVNET_GENESIS_HASH;
        }
        throw new EndpointCheckError(endpoint.label, false); // for example a rate-limit reply
      });
      pending.catch(() => {
        if (check === pending) check = null;
      });
      check = pending;
    }
    return check;
  };
  const transport = async <TResponse>(config: Parameters<RpcTransport>[0]): Promise<TResponse> => {
    if (!(await isDevnet(config.signal))) throw new EndpointCheckError(endpoint.label, true);
    return endpoint.transport<TResponse>(config);
  };
  return { label: endpoint.label, transport: transport as RpcTransport };
}

/**
 * A transport that tries each attempt in `attempts` in order (for example
 * [primary, fallback] or [primary, primary]) until one succeeds.
 */
export function createFailoverTransport(
  attempts: readonly Endpoint[],
  onAnswer: (label: EndpointLabel) => void,
  timeoutMs = RPC_TIMEOUT_MS,
): RpcTransport {
  const transport = async <TResponse>(config: Parameters<RpcTransport>[0]): Promise<TResponse> => {
    let lastError: unknown;
    for (let i = 0; i < attempts.length; i++) {
      if (i > 0) await sleep(RETRY_DELAY_MS);
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = config.signal ? AbortSignal.any([config.signal, timeout]) : timeout;
      try {
        const response = await attempts[i].transport<TResponse>({ ...config, signal });
        if (isRateLimitedReply(response) && i < attempts.length - 1) {
          lastError = new Error("rate limited");
          continue;
        }
        onAnswer(attempts[i].label);
        return response;
      } catch (error) {
        lastError = error;
        if (config.signal?.aborted) throw error;
        // An endpoint that failed its devnet check is skipped, never used.
        if (error instanceof EndpointCheckError) continue;
        if (!isTransient(error)) throw error;
      }
    }
    throw lastError;
  };
  return transport as RpcTransport;
}

export function createSignSafeRpc(
  primaryUrl: string,
  fallbackUrl?: string,
  /** Optional wrapper, e.g. to record traffic for fixtures. */
  wrap: (transport: RpcTransport) => RpcTransport = (t) => t,
): SignSafeRpc {
  let last: EndpointLabel | undefined;
  // Every endpoint is checked against devnet's genesis hash before its first use.
  const primary = devnetOnly({ label: "primary", transport: createDefaultRpcTransport({ url: primaryUrl }) });
  const second =
    fallbackUrl && fallbackUrl !== primaryUrl
      ? devnetOnly({ label: "fallback", transport: createDefaultRpcTransport({ url: fallbackUrl }) })
      : primary;
  const transport = createFailoverTransport([primary, second], (label) => {
    last = label;
  });
  return { rpc: createSolanaRpcFromTransport(wrap(transport)), lastEndpoint: () => last };
}

/** Reads the server-only RPC configuration. Returns null when it is missing. */
export function rpcFromEnv(env: Record<string, string | undefined> = process.env): SignSafeRpc | null {
  const primary = env.SOLANA_RPC_URL?.trim();
  const fallback = env.SOLANA_RPC_FALLBACK_URL?.trim();
  if (primary && !primary.includes("REPLACE_ME")) return createSignSafeRpc(primary, fallback || undefined);
  if (fallback) return createSignSafeRpc(fallback);
  return null;
}

const devnetChecks = new WeakMap<object, Promise<boolean>>();

/**
 * True if the client answers with devnet's genesis hash (once per client).
 * Clients from createSignSafeRpc also check every endpoint on its own before
 * use (devnetOnly), so false here means no configured endpoint is devnet.
 */
export function ensureDevnet(rpc: Rpc<SolanaRpcApi>): Promise<boolean> {
  let check = devnetChecks.get(rpc);
  if (!check) {
    check = rpc
      .getGenesisHash()
      .send()
      .then(
        (hash) => hash === DEVNET_GENESIS_HASH,
        (error: unknown) => {
          if (error instanceof EndpointCheckError && error.notDevnet) return false;
          throw error;
        },
      );
    // Do not cache failures (for example the RPC being briefly unreachable).
    check.catch(() => devnetChecks.delete(rpc));
    devnetChecks.set(rpc, check);
  }
  return check;
}

const ADDRESS_LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";

/** The addresses stored in a lookup-table account (jsonParsed), or undefined if it is not one. */
function lookupTableContents(account: unknown): string[] | undefined {
  if (typeof account !== "object" || account === null) return undefined;
  const { owner, data } = account as { owner?: unknown; data?: unknown };
  if (owner !== ADDRESS_LOOKUP_TABLE_PROGRAM || typeof data !== "object" || data === null) return undefined;
  const parsed = (data as { parsed?: { type?: unknown; info?: { addresses?: unknown } } }).parsed;
  const list = parsed?.type === "lookupTable" ? parsed.info?.addresses : undefined;
  return Array.isArray(list) && list.every((a) => typeof a === "string") ? list : undefined;
}

/**
 * Loads lookup tables with one getMultipleAccounts call (duplicates removed;
 * the decoder caps how many are asked for). Accounts that are missing or are
 * not lookup tables are simply absent from the result; the decoder then
 * reports them as unresolved.
 */
export function lookupTableFetcher(rpc: Rpc<SolanaRpcApi>) {
  return async (addresses: string[]): Promise<AddressesByLookupTableAddress> => {
    const unique = [...new Set(addresses)].slice(0, 100); // getMultipleAccounts takes at most 100
    const tables: AddressesByLookupTableAddress = {};
    if (unique.length === 0) return tables;
    const { value } = await rpc
      .getMultipleAccounts(unique.map((a) => address(a)), { commitment: "confirmed", encoding: "jsonParsed" })
      .send();
    value.forEach((account, i) => {
      const contents = lookupTableContents(account);
      if (contents) tables[address(unique[i])] = contents.map((a) => address(a));
    });
    return tables;
  };
}
