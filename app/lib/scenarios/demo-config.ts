/**
 * Public demo identities (ARCHITECTURE 12.1), written by `npm run setup:demo`
 * to data/demo.devnet.json. Public addresses only: the keypairs stay in keys/
 * (git-ignored) and are never read by the app.
 */
import { readFileSync } from "node:fs";
import { isAddress } from "@solana/kit";
import { z } from "zod";

export const DEMO_CONFIG_PATH = "data/demo.devnet.json";

const AddressString = z.string().refine((v) => isAddress(v), { message: "not a valid address" });

export const DemoConfigSchema = z.object({
  cluster: z.literal("devnet"),
  /** Pays setup costs; mint authority of the DEMO token. */
  authority: AddressString,
  /** "The user" in the scenarios: holds SOL and DEMO tokens. */
  victim: AddressString,
  /** The address risky scenarios hand control or tokens to. */
  attacker: AddressString,
  /** A plain recipient for the normal payment (public address only, no key kept). */
  friend: AddressString,
  mint: AddressString,
  decimals: z.number().int().min(0).max(18),
  victimTokenAccount: AddressString,
  /** A deployed devnet program that is not in SignSafe's registry (scenario S7). */
  unknownProgram: AddressString,
  updatedAt: z.string(),
});

export type DemoConfig = z.infer<typeof DemoConfigSchema>;

/** Reads and validates the demo config; null when setup has not been run. */
export function loadDemoConfig(path = DEMO_CONFIG_PATH): DemoConfig | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const parsed = DemoConfigSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}
