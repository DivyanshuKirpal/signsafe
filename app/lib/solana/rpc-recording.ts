/**
 * Record and replay RPC traffic at the transport level.
 *
 * `npm run live:check -- --record` records the raw JSON-RPC requests and
 * responses of a live devnet run into a fixture file. Offline tests then
 * replay them through the same Kit RPC client and the same pipeline, so the
 * regression tests exercise real devnet response shapes without a network.
 * Fixtures hold public devnet data only: no URLs, no keys.
 */
import { createSolanaRpcFromTransport, type Rpc, type RpcTransport, type SolanaRpcApi } from "@solana/kit";

export interface RecordedExchange {
  method: string;
  params: unknown;
  response: unknown;
}

/** JSON with bigints preserved as { "$bigint": "123" }. */
export function toFixtureJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v: unknown) => (typeof v === "bigint" ? { $bigint: v.toString() } : v),
    2,
  );
}

export function fromFixtureJson<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (typeof v === "object" && v !== null && "$bigint" in v && Object.keys(v).length === 1) {
      return BigInt((v as { $bigint: string }).$bigint);
    }
    return v;
  }) as T;
}

/** Order-independent JSON text used as the replay lookup key. */
function stableKey(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function methodAndParams(payload: unknown): { method: string; params: unknown; id: unknown } {
  const p = (payload ?? {}) as { method?: unknown; params?: unknown; id?: unknown };
  return { method: String(p.method), params: p.params ?? null, id: p.id };
}

/** Wraps a transport and appends every exchange to `sink`. */
export function createRecordingTransport(inner: RpcTransport, sink: RecordedExchange[]): RpcTransport {
  const transport = async <TResponse>(config: Parameters<RpcTransport>[0]): Promise<TResponse> => {
    const response = await inner<TResponse>(config);
    const { method, params } = methodAndParams(config.payload);
    sink.push({ method, params, response });
    return response;
  };
  return transport as RpcTransport;
}

/**
 * A transport that answers from recorded exchanges, matched by method and
 * params. An unrecorded request fails loudly, so a test never silently passes
 * on missing data.
 */
export function createReplayTransport(exchanges: readonly RecordedExchange[]): RpcTransport {
  const byKey = new Map<string, unknown>();
  for (const e of exchanges) byKey.set(`${e.method}:${stableKey(e.params)}`, e.response);
  const transport = async <TResponse>(config: Parameters<RpcTransport>[0]): Promise<TResponse> => {
    const { method, params, id } = methodAndParams(config.payload);
    const key = `${method}:${stableKey(params)}`;
    if (!byKey.has(key)) throw new Error(`No recorded response for ${method}`);
    const recorded = byKey.get(key) as Record<string, unknown>;
    // Echo the request id, as a real server would.
    return { ...recorded, id } as TResponse;
  };
  return transport as RpcTransport;
}

export function createReplayRpc(exchanges: readonly RecordedExchange[]): Rpc<SolanaRpcApi> {
  return createSolanaRpcFromTransport(createReplayTransport(exchanges));
}
