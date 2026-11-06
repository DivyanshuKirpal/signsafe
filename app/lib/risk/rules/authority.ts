/**
 * R-SET-AUTHORITY (instructions + account state) and R-ASSIGN (instructions +
 * account state).
 *
 * R-SET-AUTHORITY: the owner or close authority of a token account moving to
 * an address other than its current owner is DANGER; any other authority
 * change (mint, freeze, Token-2022 extension authorities) is CAUTION.
 *
 * R-ASSIGN: an account that existed before the transaction and was owned by the
 * System Program (a normal wallet) getting a new owning program is DANGER.
 * Accounts created in the same transaction are normal and do not fire.
 */
import { changeSource, isSystemIx, isTokenIx, ixSource, type RawFlag, type RiskContext, short, SYSTEM_PROGRAM } from "../context";
import { lookupProgram } from "../../solana/programs";

function ownerTakeover(account: string, newOwner: string, ruleSource: RawFlag["sources"][number]): RawFlag {
  return {
    key: `authority:${account}:owner`,
    ruleId: "R-SET-AUTHORITY",
    severity: "danger",
    title: "Hands a token account to a different owner",
    detail: `The owner of token account ${short(account)} would change to ${short(newOwner)}, who would then control every token in it.`,
    account,
    evidence: { tokenAccount: account, newOwner },
    sources: [ruleSource],
  };
}

function closeAuthorityChange(account: string, newAuthority: string, ruleSource: RawFlag["sources"][number]): RawFlag {
  return {
    key: `authority:${account}:close`,
    ruleId: "R-SET-AUTHORITY",
    severity: "danger",
    title: "Lets another address close a token account",
    detail: `${short(newAuthority)} would become the close authority of token account ${short(account)}, so it could close the account and collect the SOL held in it.`,
    account,
    evidence: { tokenAccount: account, newCloseAuthority: newAuthority },
    sources: [ruleSource],
  };
}

export function setAuthorityRule(ctx: RiskContext): RawFlag[] {
  const flags: RawFlag[] = [];
  for (const ix of ctx.instructions) {
    if (!isTokenIx(ix) || ix.action !== "setAuthority") continue;
    const account = ix.accounts.owned;
    const type = typeof ix.args.authorityType === "string" ? ix.args.authorityType : "Unknown";
    const newAuthority = typeof ix.args.newAuthority === "string" ? ix.args.newAuthority : null;
    if (!account) continue;

    if (type === "AccountOwner" || type === "CloseAccount") {
      const owner = ctx.pre.get(account)?.token?.owner ?? ix.accounts.owner;
      // Removing the close authority hands it back to the owner; same owner is no change.
      if (newAuthority === null || newAuthority === owner) continue;
      flags.push(type === "AccountOwner" ? ownerTakeover(account, newAuthority, ixSource(ix)) : closeAuthorityChange(account, newAuthority, ixSource(ix)));
      continue;
    }
    flags.push({
      key: `authority:${account}:${type}`,
      ruleId: "R-SET-AUTHORITY",
      severity: "caution",
      title: "Changes a token authority",
      detail: `The ${type} authority of ${short(account)} would change to ${newAuthority ? short(newAuthority) : "no one"}. Check that this is expected.`,
      account,
      evidence: { account, authorityType: type, newAuthority: newAuthority ?? "none" },
      sources: [ixSource(ix)],
    });
  }

  for (const change of ctx.changes) {
    if (change.kind === "tokenOwner" && change.after && change.after !== change.before) {
      flags.push(ownerTakeover(change.address, change.after, changeSource(change)));
    }
    if (change.kind === "closeAuthority" && change.after) {
      const owner = ctx.pre.get(change.address)?.token?.owner ?? change.tokenAccountOwner;
      if (change.after !== owner) flags.push(closeAuthorityChange(change.address, change.after, changeSource(change)));
    }
  }
  return flags;
}

function programName(address: string): string {
  return lookupProgram(address)?.name ?? `program ${short(address)}`;
}

export function assignRule(ctx: RiskContext): RawFlag[] {
  const flags: RawFlag[] = [];
  const createdHere = new Set(
    ctx.instructions
      .filter((ix) => isSystemIx(ix) && (ix.action === "createAccount" || ix.action === "createAccountWithSeed" || ix.action === "createAccountAllowPrefund"))
      .map((ix) => ix.accounts.newAccount)
      .filter(Boolean),
  );

  const flag = (account: string, program: string, source: RawFlag["sources"][number], checked: boolean): RawFlag => ({
    key: `assign:${account}`,
    ruleId: "R-ASSIGN",
    severity: "danger",
    title: "Hands control of a wallet to a program",
    detail:
      `Account ${short(account)}, ${checked ? "an existing wallet owned by the System Program" : "which is not created in this transaction"}, ` +
      `would be assigned to ${programName(program)}. After that, that program controls the account and its SOL.`,
    account,
    evidence: { account, newProgram: program, existedBefore: checked ? "yes, owned by the System Program" : "not checked" },
    sources: [source],
  });

  for (const ix of ctx.instructions) {
    if (!isSystemIx(ix) || (ix.action !== "assign" && ix.action !== "assignWithSeed")) continue;
    const account = ix.accounts.account;
    const program = typeof ix.args.programAddress === "string" ? ix.args.programAddress : undefined;
    if (!account || !program || program === SYSTEM_PROGRAM) continue;
    const pre = ctx.pre.get(account);
    if (pre) {
      // Known state: only an existing System-owned account is a wallet takeover.
      if (!pre.exists || pre.owner !== SYSTEM_PROGRAM) continue;
      flags.push(flag(account, program, ixSource(ix), true));
    } else if (!createdHere.has(account)) {
      flags.push(flag(account, program, ixSource(ix), false));
    }
  }

  for (const change of ctx.changes) {
    if (change.kind === "programOwner" && change.before === SYSTEM_PROGRAM && change.after && change.after !== SYSTEM_PROGRAM) {
      flags.push(flag(change.address, change.after, changeSource(change), true));
    }
  }
  return flags;
}
