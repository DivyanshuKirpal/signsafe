/**
 * One plain-English sentence per decoded instruction, written by our code.
 * The UI shows it, and later the AI prompt receives it as a fact. It describes
 * what the instruction asks for; it does not judge risk (the rules do that).
 */
import type { ArgValue, DecodedIx } from "../types";
import { formatSol, formatTokenAmount, shortAddress } from "./format";
import { lookupProgram } from "./programs";

type IxFacts = Omit<DecodedIx, "summary">;

function big(value: ArgValue | undefined): bigint | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return undefined;
  return BigInt(value);
}

function num(value: ArgValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function addr(value: string | undefined): string {
  return value ? shortAddress(value) : "an unknown account";
}

function sol(value: ArgValue | undefined): string {
  const lamports = big(value);
  return lamports === undefined ? "an unknown amount of SOL" : formatSol(lamports);
}

function tokens(value: ArgValue | undefined, decimals?: ArgValue): string {
  const raw = big(value);
  return raw === undefined ? "an unknown amount" : formatTokenAmount(raw, num(decimals));
}

/** "setComputeUnitLimit" -> "set compute unit limit". */
function humanize(action: string): string {
  return action.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

const AUTHORITY_LABELS: Record<string, string> = {
  AccountOwner: "owner",
  CloseAccount: "close authority",
  MintTokens: "mint authority",
  FreezeAccount: "freeze authority",
};

function describeSystem(ix: IxFacts): string | undefined {
  const { accounts: a, args } = ix;
  switch (ix.action) {
    case "transferSol":
      return `Send ${sol(args.amount)} from ${addr(a.source)} to ${addr(a.destination)}.`;
    case "transferSolWithSeed":
      return `Send ${sol(args.amount)} from seed account ${addr(a.source)} to ${addr(a.destination)}.`;
    case "createAccount":
    case "createAccountAllowPrefund":
      return `Create account ${addr(a.newAccount)} with ${sol(args.lamports)}, owned by program ${addr(String(args.programAddress ?? ""))}.`;
    case "createAccountWithSeed":
      return `Create seed account ${addr(a.newAccount)} with ${sol(args.amount)}, owned by program ${addr(String(args.programAddress ?? ""))}.`;
    case "assign":
    case "assignWithSeed":
      return `Hand control of account ${addr(a.account)} to program ${addr(String(args.programAddress ?? ""))}.`;
    case "allocate":
    case "allocateWithSeed":
      return `Reserve ${args.space ?? "some"} bytes of storage for account ${addr(a.newAccount)}.`;
    case "advanceNonceAccount":
      return `Use durable nonce account ${addr(a.nonceAccount)}, so this transaction does not expire.`;
    case "withdrawNonceAccount":
      return `Withdraw ${sol(args.withdrawAmount)} from nonce account ${addr(a.nonceAccount)} to ${addr(a.recipientAccount)}.`;
    default:
      return undefined;
  }
}

function describeToken(ix: IxFacts): string | undefined {
  const { accounts: a, args } = ix;
  switch (ix.action) {
    case "transfer":
      return `Move ${tokens(args.amount)} from token account ${addr(a.source)} to ${addr(a.destination)}.`;
    case "transferChecked":
      return `Move ${tokens(args.amount, args.decimals)} of mint ${addr(a.mint)} from token account ${addr(a.source)} to ${addr(a.destination)}.`;
    case "approve":
      return `Allow ${addr(a.delegate)} to spend ${tokens(args.amount)} from token account ${addr(a.source)}.`;
    case "approveChecked":
      return `Allow ${addr(a.delegate)} to spend ${tokens(args.amount, args.decimals)} of mint ${addr(a.mint)} from token account ${addr(a.source)}.`;
    case "revoke":
      return `Remove any spending permission (delegate) from token account ${addr(a.source)}.`;
    case "setAuthority": {
      const kind = typeof args.authorityType === "string" ? args.authorityType : "";
      const label = AUTHORITY_LABELS[kind] ?? (kind ? humanize(kind) : "authority");
      const target = typeof args.newAuthority === "string" ? addr(args.newAuthority) : "no one";
      return `Change the ${label} of ${addr(a.owned)} to ${target}.`;
    }
    case "closeAccount":
      return `Close token account ${addr(a.account)} and send its SOL to ${addr(a.destination)}.`;
    case "mintTo":
    case "mintToChecked":
      return `Mint ${tokens(args.amount, args.decimals)} to token account ${addr(a.token)}.`;
    case "burn":
    case "burnChecked":
      return `Burn ${tokens(args.amount, args.decimals)} from token account ${addr(a.account)}.`;
    default:
      return undefined;
  }
}

function describeOther(ix: IxFacts): string | undefined {
  const { accounts: a, args } = ix;
  switch (ix.action) {
    case "createAssociatedToken":
    case "createAssociatedTokenIdempotent":
      return `Create token account ${addr(a.ata)} for wallet ${addr(a.owner)} (mint ${addr(a.mint)}).`;
    case "setComputeUnitLimit":
      return `Set the compute unit limit to ${args.units ?? "an unknown value"}.`;
    case "setComputeUnitPrice":
      return `Set the priority fee to ${args.microLamports ?? "an unknown number of"} micro-lamports per compute unit.`;
    case "memo":
      return `Attach a memo (text written by the sender): "${String(args.text ?? "")}"${args.truncated ? " (cut short)" : ""}.`;
    default:
      return undefined;
  }
}

export function describeInstruction(ix: IxFacts): string {
  if (!ix.known) {
    return `Call an unknown program ${shortAddress(ix.programId)} with ${ix.accountCount} account(s) and ${ix.dataLength} byte(s) of data.`;
  }
  if (ix.parseError || ix.action === "unknown") {
    return `${ix.programName}: this instruction could not be decoded.`;
  }
  const key = lookupProgram(ix.programId)?.key;
  const specific =
    key === "system"
      ? describeSystem(ix)
      : key === "token" || key === "token2022"
        ? describeToken(ix)
        : describeOther(ix);
  return specific ?? `${ix.programName}: ${humanize(ix.action)}.`;
}
