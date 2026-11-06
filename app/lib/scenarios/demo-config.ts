/**
 * Public demo identities (ARCHITECTURE 12.1), written by `npm run setup:demo`
 * to data/demo.devnet.json. Public addresses only: the keypairs stay in keys/
 * (git-ignored) and are never read by the app.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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

/** Validates demo config JSON text; unknown fields are dropped. Null when invalid. */
export function parseDemoConfig(text: string): DemoConfig | null {
  try {
    const parsed = DemoConfigSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Reads data/demo.devnet.json; null when setup has not been run. The path is
 * statically scoped to data/ so the bundler does not trace (and ship) the
 * whole project, which would include keys/ and .env.local.
 */
export function loadDemoConfig(): DemoConfig | null {
  try {
    return parseDemoConfig(readFileSync(path.join(process.cwd(), "data", "demo.devnet.json"), "utf8"));
  } catch {
    return null;
  }
}
