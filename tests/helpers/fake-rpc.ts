/**
 * Test RPCs that never touch the network:
 *   - replayFixture: answers from traffic recorded live by `npm run live:check -- --record`
 *   - fakeRpc: answers from hand-written handlers (synthetic cases)
 */
import { readFileSync } from "node:fs";
import { createSolanaRpcFromTransport, type RpcTransport } from "@solana/kit";
import type { EndpointLabel, SignSafeRpc } from "../../app/lib/solana/rpc";
import { createReplayRpc, fromFixtureJson, type RecordedExchange } from "../../app/lib/solana/rpc-recording";

export interface LiveFixture {
  case: string;
  description: string;
  source: string;
  endpoint: EndpointLabel | null;
  recordedAt: string;
  txBase64: string;
  exchanges: RecordedExchange[];
}

export function loadFixture(name: string, dir = "tests/fixtures/live"): LiveFixture {
  return fromFixtureJson<LiveFixture>(readFileSync(`${dir}/${name}.json`, "utf8"));
}

export function replayFixture(fixture: LiveFixture): SignSafeRpc {
  return { rpc: createReplayRpc(fixture.exchanges), lastEndpoint: () => fixture.endpoint ?? undefined };
}

type Handler = (params: unknown[]) => unknown;

/** A JSON-RPC server made of handlers; unknown methods fail the test loudly. */
export function fakeRpc(handlers: Record<string, Handler>, calls: string[] = []): SignSafeRpc {
  const transport = (async (config: { payload: unknown }) => {
    const { method, params, id } = config.payload as { method: string; params: unknown[]; id: unknown };
    calls.push(method);
    const handler = handlers[method];
    if (!handler) throw new Error(`fakeRpc: unexpected method ${method}`);
    return { jsonrpc: "2.0", id, result: handler(params) };
  }) as unknown as RpcTransport;
  return { rpc: createSolanaRpcFromTransport(transport), lastEndpoint: () => "primary" };
}

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
