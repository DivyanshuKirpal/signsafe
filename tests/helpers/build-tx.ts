/**
 * Builds real, serialized Solana transactions offline with Kit, so decoder
 * tests need no network (ARCHITECTURE section 13). The addresses are fixed,
 * made-up devnet-style addresses; nothing here is sent anywhere.
 */
import {
  address,
  type Address,
  type AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  type Instruction,
  lamports,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type V1TransactionConfig,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getApproveInstruction } from "@solana-program/token";
import { U64_MAX } from "../../app/lib/config";

export const VICTIM = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
export const FRIEND = address("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T");
export const ATTACKER = address("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH");
export const VICTIM_TOKEN_ACCOUNT = address("2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9");
export const DEMO_MINT = address("7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs");
export const LOOKUP_TABLE = address("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
export const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";

export const victimSigner = createNoopSigner(VICTIM);

/** S1-like: 0.01 SOL from the victim to a friend. */
export function solPaymentIx(amountLamports = 10_000_000n): Instruction {
  return getTransferSolInstruction({
    source: victimSigner,
    destination: FRIEND,
    amount: lamports(amountLamports),
  });
}

/** S2-like: the victim lets the attacker spend an unlimited amount of DEMO tokens. */
export function unlimitedApproveIx(amount: bigint = U64_MAX): Instruction {
  return getApproveInstruction({
    source: VICTIM_TOKEN_ACCOUNT,
    delegate: ATTACKER,
    owner: victimSigner,
    amount,
  });
}

export interface BuildOptions {
  version?: "legacy" | 0 | 1;
  feePayer?: Address;
  /** v1 only: compute budget config. */
  config?: V1TransactionConfig;
  /** v0 only: compress addresses found in these tables into lookups. */
  lookupTables?: AddressesByLookupTableAddress;
}

/** Builds an unsigned transaction and returns its base64 wire encoding. */
export function buildTxBase64(instructions: Instruction[], options: BuildOptions = {}): string {
  const version = options.version ?? "legacy";
  const message = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(options.feePayer ?? VICTIM, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: blockhash(BLOCKHASH), lastValidBlockHeight: 1_000n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  let finalMessage: typeof message = message;
  if (version === 1 && options.config) {
    finalMessage = setTransactionMessageConfig(options.config, message as typeof message & { version: 1 });
  }
  if (version === 0 && options.lookupTables) {
    finalMessage = compressTransactionMessageUsingAddressLookupTables(
      message as typeof message & { version: 0 },
      options.lookupTables,
    );
  }
  return getBase64EncodedWireTransaction(compileTransaction(finalMessage));
}
