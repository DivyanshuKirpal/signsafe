/**
 * One RPC client per server process, shared by the API routes, so the devnet
 * genesis check is done once. Server-only: reads SOLANA_RPC_URL.
 */
import { rpcFromEnv, type SignSafeRpc } from "./rpc";

let cached: SignSafeRpc | null | undefined;

export function getServerRpc(): SignSafeRpc | null {
  if (cached === undefined) cached = rpcFromEnv();
  return cached;
}
