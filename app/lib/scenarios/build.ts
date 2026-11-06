/**
 * Builds the demo scenario transactions (ARCHITECTURE 12.4): UNSIGNED, fee
 * payer = owner (the demo victim by default). They are never signed or sent;
 * they go through exactly the same analysis as a pasted transaction.
 */
import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  type Instruction,
  lamports,
  pipe,
  type Rpc,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type SolanaRpcApi,
} from "@solana/kit";
import { getAssignInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  AuthorityType,
  findAssociatedTokenPda,
  getApproveInstruction,
  getSetAuthorityInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { U64_MAX } from "../config";
import type { DemoConfig } from "./demo-config";
import { S8_MEMO, type ScenarioId } from "./index";

/** The classic Memo program (deployed on devnet); not a signer-checking variant. */
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const PAYMENT_LAMPORTS = 10_000_000n; // 0.01 SOL

export interface ScenarioContext {
  owner: Address;
  ownerTokenAccount: Address;
  attacker: Address;
  friend: Address;
  unknownProgram: Address;
  /** The owner's SOL balance (only S6 uses it). */
  ownerLamports: bigint;
}

/** The instructions of each scenario. Pure: no network. */
export function scenarioInstructions(id: ScenarioId, ctx: ScenarioContext): Instruction[] {
  const owner = createNoopSigner(ctx.owner);
  const payment = () => getTransferSolInstruction({ source: owner, destination: ctx.friend, amount: lamports(PAYMENT_LAMPORTS) });
  const unlimitedApproval = () =>
    getApproveInstruction({ source: ctx.ownerTokenAccount, delegate: ctx.attacker, owner, amount: U64_MAX });

  switch (id) {
    case "s1-normal-payment":
      return [payment()];
    case "s2-unlimited-approval":
      return [unlimitedApproval()];
    case "s3-hidden-approval":
      return [payment(), unlimitedApproval()];
    case "s4-token-account-takeover":
      return [
        getSetAuthorityInstruction({
          owned: ctx.ownerTokenAccount,
          owner,
          authorityType: AuthorityType.AccountOwner,
          newAuthority: ctx.attacker,
        }),
      ];
    case "s5-wallet-assign":
      return [getAssignInstruction({ account: owner, programAddress: ctx.attacker })];
    case "s6-drain-sol":
      return [getTransferSolInstruction({ source: owner, destination: ctx.attacker, amount: lamports((ctx.ownerLamports * 95n) / 100n) })];
    case "s7-unknown-program":
      return [
        {
          programAddress: ctx.unknownProgram,
          accounts: [{ address: ctx.owner, role: AccountRole.READONLY_SIGNER }],
          data: new TextEncoder().encode("mint badge"),
        },
      ];
    case "s8-memo-injection":
      return [unlimitedApproval(), { programAddress: MEMO_PROGRAM, accounts: [], data: new TextEncoder().encode(S8_MEMO) }];
  }
}

/** Unsigned v0 transaction, base64. */
export function compileScenario(
  instructions: Instruction[],
  feePayer: Address,
  lifetime: { blockhash: Blockhash; lastValidBlockHeight: bigint },
): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

export async function ownerTokenAccount(cfg: DemoConfig, owner: Address): Promise<Address> {
  if (owner === cfg.victim) return address(cfg.victimTokenAccount);
  const [ata] = await findAssociatedTokenPda({ owner, mint: address(cfg.mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

/**
 * Builds a scenario for `owner` (default: the demo victim) with a real recent
 * blockhash, so the base64 shown is a genuine devnet transaction. Reads only
 * public data from the RPC.
 */
export async function buildScenario(
  id: ScenarioId,
  cfg: DemoConfig,
  rpc: Rpc<SolanaRpcApi>,
  ownerInput?: string,
): Promise<{ txBase64: string; owner: Address }> {
  const owner = address(ownerInput ?? cfg.victim);
  const [latest, balance] = await Promise.all([
    rpc.getLatestBlockhash({ commitment: "confirmed" }).send(),
    id === "s6-drain-sol" ? rpc.getBalance(owner, { commitment: "confirmed" }).send() : Promise.resolve(null),
  ]);
  const ctx: ScenarioContext = {
    owner,
    ownerTokenAccount: await ownerTokenAccount(cfg, owner),
    attacker: address(cfg.attacker),
    friend: address(cfg.friend),
    unknownProgram: address(cfg.unknownProgram),
    ownerLamports: balance?.value ?? 0n,
  };
  return { txBase64: compileScenario(scenarioInstructions(id, ctx), owner, latest.value), owner };
}
