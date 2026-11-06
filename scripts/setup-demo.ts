/**
 * setup:demo - creates the devnet demo accounts (ARCHITECTURE 12.3).
 * Safe to run again at any point, including after an interruption:
 *
 *   1. checks the RPC is devnet (genesis hash) and that keys/ is git-ignored
 *   2. loads the demo keypairs from keys/ or creates them once
 *      (demo-authority, demo-victim, demo-attacker, demo-mint; JSON byte arrays)
 *   3. reads balances; if work is left and the authority has < 0.3 SOL, prints
 *      the full authority address and its devnet balance and stops (exit 2)
 *      so the user can send ~1 devnet SOL from Phantom, then rerun
 *   4. creates the DEMO mint (6 decimals) only if it does not exist
 *   5. creates the victim's token account and mints only the missing DEMO up to 1,000
 *   6. tops the victim up to 0.05 SOL only if below
 *   7. writes data/demo.devnet.json (public addresses only)
 *
 * These setup transactions are the only ones SignSafe ever signs and sends,
 * and only on devnet. Key material is never printed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  type Address,
  address,
  appendTransactionMessageInstructions,
  type Base64EncodedWireTransaction,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Instruction,
  type KeyPairSigner,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { toSnapshot } from "../app/lib/solana/accounts";
import { formatSol, formatUnits } from "../app/lib/solana/format";
import { createSignSafeRpc, ensureDevnet, redactSecrets, type SignSafeRpc } from "../app/lib/solana/rpc";
import { DEMO_CONFIG_PATH, type DemoConfig, loadDemoConfig } from "../app/lib/scenarios/demo-config";

const KEYS_DIR = "keys";
const DECIMALS = 6;
const TARGET_TOKENS = 1_000n * 10n ** BigInt(DECIMALS); // 1,000 DEMO
const TARGET_VICTIM_LAMPORTS = 50_000_000n; // 0.05 SOL
const MIN_AUTHORITY_LAMPORTS = 300_000_000n; // 0.3 SOL
/** Deployed devnet programs that are not in SignSafe's registry, tried in order (scenario S7). */
const UNKNOWN_PROGRAM_CANDIDATES = [
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV", // SPL Noop: accepts any data
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", // Metaplex Token Metadata
];

class SetupError extends Error {}

function log(message: string): void {
  console.log(message);
}

/** keys/ must be ignored by git before any key file is written. */
function assertKeysIgnored(): void {
  try {
    execFileSync("git", ["check-ignore", "-q", `${KEYS_DIR}/demo-authority.json`], { stdio: "ignore" });
  } catch {
    throw new SetupError("keys/ is NOT ignored by git. Refusing to create keypairs. Check .gitignore.");
  }
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Loads a keypair (64-byte JSON array, Solana CLI format) or creates it once. */
async function loadOrCreateKeypair(name: string): Promise<{ signer: KeyPairSigner; created: boolean }> {
  const path = `${KEYS_DIR}/${name}.json`;
  if (existsSync(path)) {
    const bytes: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      throw new SetupError(`${path} is not a 64-byte keypair file. Move it away and rerun to create a new one.`);
    }
    // Kit checks that the public half matches the private half.
    return { signer: await createKeyPairSignerFromBytes(Uint8Array.from(bytes)), created: false };
  }
  // Kit's generated keys are non-extractable, so create the key from random bytes we can store.
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(secret);
  const publicKey = getAddressEncoder().encode(signer.address);
  mkdirSync(KEYS_DIR, { recursive: true });
  writeAtomic(path, JSON.stringify([...secret, ...publicKey]));
  return { signer, created: true };
}

async function balanceOf(client: SignSafeRpc, who: Address): Promise<bigint> {
  return (await client.rpc.getBalance(who, { commitment: "confirmed" }).send()).value;
}

async function accountSnapshot(client: SignSafeRpc, who: Address) {
  const info = await client.rpc.getAccountInfo(who, { encoding: "jsonParsed", commitment: "confirmed" }).send();
  return toSnapshot(info.value);
}

/** Signs with the given signers and sends one devnet transaction, then waits for confirmation. */
async function send(client: SignSafeRpc, feePayer: KeyPairSigner, instructions: Instruction[], label: string): Promise<void> {
  const { value: latest } = await client.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  log(`  sending: ${label}`);
  await client.rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed) as Base64EncodedWireTransaction, {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    const { value } = await client.rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new SetupError(`${label} failed on devnet: ${JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      log(`  confirmed: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
      return;
    }
  }
  throw new SetupError(`${label} was sent but not confirmed within 60 s (signature ${signature}). Rerun setup:demo; it is safe to rerun.`);
}

async function findUnknownProgram(client: SignSafeRpc): Promise<Address> {
  for (const candidate of UNKNOWN_PROGRAM_CANDIDATES) {
    const info = await client.rpc.getAccountInfo(address(candidate), { encoding: "base64" }).send();
    if (info.value?.executable) return address(candidate);
  }
  throw new SetupError("None of the S7 candidate programs is deployed on devnet.");
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    throw new SetupError(".env.local not found. Copy .env.example to .env.local and fill in SOLANA_RPC_URL.");
  }
  const primary = process.env.SOLANA_RPC_URL?.trim();
  if (!primary || primary.includes("REPLACE_ME")) throw new SetupError("SOLANA_RPC_URL is missing in .env.local.");
  const client = createSignSafeRpc(primary, process.env.SOLANA_RPC_FALLBACK_URL?.trim() || undefined);

  // 1. Safety checks before anything is created or sent.
  if (!(await ensureDevnet(client.rpc))) throw new SetupError("The configured RPC is not Solana devnet (genesis hash mismatch). Nothing was done.");
  log("Devnet confirmed by genesis hash.");
  assertKeysIgnored();
  log("keys/ is ignored by git.");

  // 2. Keypairs (reused when present).
  const authority = await loadOrCreateKeypair("demo-authority");
  const victim = await loadOrCreateKeypair("demo-victim");
  const attacker = await loadOrCreateKeypair("demo-attacker");
  const mint = await loadOrCreateKeypair("demo-mint");
  for (const [name, k] of [["demo-authority", authority], ["demo-victim", victim], ["demo-attacker", attacker], ["demo-mint", mint]] as const) {
    log(`  ${name.padEnd(15)} ${k.signer.address}${k.created ? "  (new keypair created in keys/)" : ""}`);
  }
  const previous = loadDemoConfig();
  const friend = previous?.friend ? address(previous.friend) : (await generateKeyPairSigner()).address;
  const [victimTokenAccount] = await findAssociatedTokenPda({
    owner: victim.signer.address,
    mint: mint.signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // 3. Current state, before any funding or minting.
  const [authorityLamports, victimLamports, mintState, tokenState] = await Promise.all([
    balanceOf(client, authority.signer.address),
    balanceOf(client, victim.signer.address),
    accountSnapshot(client, mint.signer.address),
    accountSnapshot(client, victimTokenAccount),
  ]);
  if (mintState && (!mintState.mint || mintState.mint.mintAuthority !== authority.signer.address || mintState.mint.decimals !== DECIMALS)) {
    throw new SetupError(`Account ${mint.signer.address} exists but is not the expected DEMO mint. Nothing was changed.`);
  }
  const tokens = tokenState?.token?.amount ?? 0n;
  const needMint = mintState === null;
  const needTokens = tokens < TARGET_TOKENS;
  const needSol = victimLamports < TARGET_VICTIM_LAMPORTS;
  log(`  authority balance: ${formatSol(authorityLamports)} (devnet)`);
  log(`  victim balance:    ${formatSol(victimLamports)}, ${formatUnits(tokens, DECIMALS)} DEMO`);
  log(`  to do: ${[needMint && "create DEMO mint", needTokens && "mint DEMO to victim", needSol && "send SOL to victim"].filter(Boolean).join(", ") || "nothing"}`);

  if ((needMint || needTokens || needSol) && authorityLamports < MIN_AUTHORITY_LAMPORTS) {
    log("");
    log("FUNDING NEEDED (devnet only). Setup has stopped; nothing was sent.");
    log(`  Demo-authority address: ${authority.signer.address}`);
    log(`  Network:                Solana Devnet`);
    log(`  Current balance:        ${formatSol(authorityLamports)} (needs at least ${formatSol(MIN_AUTHORITY_LAMPORTS)})`);
    log("  Option A (chosen): in Phantom (Testnet Mode, Solana Devnet) send about 1 devnet SOL to the address above.");
    log("  Option B: https://faucet.solana.com for that address.");
    log("  Then run `npm run setup:demo` again; it checks the balance first.");
    process.exitCode = 2;
    return;
  }

  // 4. DEMO mint.
  if (needMint) {
    const rent = await client.rpc.getMinimumBalanceForRentExemption(BigInt(getMintSize())).send();
    await send(
      client,
      authority.signer,
      [
        getCreateAccountInstruction({
          payer: authority.signer,
          newAccount: mint.signer,
          lamports: rent,
          space: getMintSize(),
          programAddress: TOKEN_PROGRAM_ADDRESS,
        }),
        getInitializeMint2Instruction({ mint: mint.signer.address, decimals: DECIMALS, mintAuthority: authority.signer.address }),
      ],
      "create DEMO mint (6 decimals)",
    );
  }

  // 5. Victim token account + only the missing DEMO.
  if (needTokens) {
    const missing = TARGET_TOKENS - tokens;
    await send(
      client,
      authority.signer,
      [
        await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: authority.signer, owner: victim.signer.address, mint: mint.signer.address }),
        getMintToInstruction({ mint: mint.signer.address, token: victimTokenAccount, mintAuthority: authority.signer, amount: missing }),
      ],
      `mint ${formatUnits(missing, DECIMALS)} DEMO to the victim`,
    );
  }

  // 6. Victim SOL top-up, only the difference.
  if (needSol) {
    const missing = TARGET_VICTIM_LAMPORTS - victimLamports;
    await send(
      client,
      authority.signer,
      [getTransferSolInstruction({ source: authority.signer, destination: victim.signer.address, amount: lamports(missing) })],
      `send ${formatSol(missing)} to the victim`,
    );
  }

  // 7. Public config.
  const config: DemoConfig = {
    cluster: "devnet",
    authority: authority.signer.address,
    victim: victim.signer.address,
    attacker: attacker.signer.address,
    friend,
    mint: mint.signer.address,
    decimals: DECIMALS,
    victimTokenAccount,
    unknownProgram: previous?.unknownProgram ?? (await findUnknownProgram(client)),
    updatedAt: new Date().toISOString(),
  };
  mkdirSync("data", { recursive: true });
  writeAtomic(DEMO_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");

  const [finalVictim, finalTokens, finalAuthority] = await Promise.all([
    balanceOf(client, victim.signer.address),
    accountSnapshot(client, victimTokenAccount),
    balanceOf(client, authority.signer.address),
  ]);
  log("");
  log(`Done. Wrote ${DEMO_CONFIG_PATH} (public addresses only).`);
  log(`  victim: ${formatSol(finalVictim)}, ${formatUnits(finalTokens?.token?.amount ?? 0n, DECIMALS)} DEMO; authority: ${formatSol(finalAuthority)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`setup:demo: ${redactSecrets(message)}`);
  process.exitCode = 1;
});
