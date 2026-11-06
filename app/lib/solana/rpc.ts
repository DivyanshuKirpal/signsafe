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
 * - ensureDevnet() checks the genesis hash once per client, so a mainnet URL
 *   pasted by mistake can never be used.
 */
import {
  type AddressesByLookupTableAddress,
  address,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  fetchAddressesForLookupTables,
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
        if (config.signal?.aborted || !isTransient(error)) throw error;
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
  const primary: Endpoint = { label: "primary", transport: createDefaultRpcTransport({ url: primaryUrl }) };
  const second: Endpoint =
    fallbackUrl && fallbackUrl !== primaryUrl
      ? { label: "fallback", transport: createDefaultRpcTransport({ url: fallbackUrl }) }
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

/** True if the endpoint is Solana devnet (checked by genesis hash, once per client). */
export function ensureDevnet(rpc: Rpc<SolanaRpcApi>): Promise<boolean> {
  let check = devnetChecks.get(rpc);
  if (!check) {
    check = rpc
      .getGenesisHash()
      .send()
      .then((hash) => hash === DEVNET_GENESIS_HASH);
    // Do not cache failures (for example the RPC being briefly unreachable).
    check.catch(() => devnetChecks.delete(rpc));
    devnetChecks.set(rpc, check);
  }
  return check;
}

/**
 * Loads lookup tables one by one, so one missing table does not hide the
 * others. Tables that cannot be loaded are simply absent from the result; the
 * decoder then reports them as unresolved.
 */
export function lookupTableFetcher(rpc: Rpc<SolanaRpcApi>) {
  return async (addresses: string[]): Promise<AddressesByLookupTableAddress> => {
    const results = await Promise.allSettled(
      addresses.map((a) => fetchAddressesForLookupTables([address(a)], rpc, { commitment: "confirmed" })),
    );
    const tables: AddressesByLookupTableAddress = {};
    for (const result of results) {
      if (result.status === "fulfilled") Object.assign(tables, result.value);
    }
    return tables;
  };
}
