# SignSafe progress

Source of truth for a fresh session. Read with `docs/DECISIONS.md`, `CLAUDE.md`, `ARCHITECTURE.md`. Then run `git log --oneline -15`, `git status`, `npm run check`.

## Timing (confirmed by the user, 6 Nov 2026)
- **Official MLH schedule:**
  - Hacking start: **Fri 6 Nov 2026, 10:30 PM IST**. Our local work began about 11:15 PM IST.
  - Initial submission due: **Sun 8 Nov 2026, 8:30 PM IST**
  - Final submission and end of hacking: **Sun 8 Nov 2026, 10:15 PM IST**. No commits or pushes after this.
- **Our personal targets (plan to these):** initial submission by **7:30 PM IST**, final by **9:15 PM IST** on Sun 8 Nov.
- **Submission platform: MLH Challenges** (not Devpost). `CLAUDE.md` and `ARCHITECTURE.md` say "Devpost"; read that as MLH Challenges. `docs/DEVPOST.md` is the submission draft for MLH Challenges.
- MLH Challenges rules (video length, required fields): **not yet read**. Ask the user to check them before M8.

## Milestone approval state
| Milestone | Status |
|---|---|
| M0 Kickoff | Completed and verified (Fri 6 Nov ~11:40 PM IST) |
| M1 Decode | Completed and verified (Sat 7 Nov ~00:20 IST) |
| M2 Simulate and diff | Completed and verified (Sat 7 Nov ~00:55 IST) |
| M3 Rules and verdict | **Completed and verified** (Sat 7 Nov ~01:40 IST). Approved by the user for M3 only (user chose xhigh effort). |
| M4 Scenarios | **Awaiting the user's explicit approval. Do not start.** Demo funding happens in M4 (option A: user sends ~1 devnet SOL from Phantom). |
| M5-M8 | Not approved. Gemini stays in M5. |

- Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges (for example "approved through M3") are recorded here; none so far.
- **Next recommended effort (M4): medium.** Clear scope: setup script, scenario builders and buttons, scenarios:check. The tricky part (keypair creation from bytes, idempotent setup, funding handshake) is well defined; the rules it exercises are already tested.

## Completed and verified
### M0
- Official Solana `kit/nextjs` template; npm; `.gitignore` verified; `.env.example`; `check`, `check:env`, `scan:secrets`; git `main` -> https://github.com/DivyanshuKirpal/signsafe.git (public).

### M1 (decode)
- `decode.ts` (legacy, v0, v1), `instructions.ts` (official program clients), `describe.ts`, `programs.ts`, `format.ts`, `POST /api/analyze`, paste-and-check UI. LICENSE with the template's MIT notice.

### M2 (simulate and diff)
- `rpc.ts` (failover, devnet genesis guard, lookup tables, redaction), `rpc-recording.ts`, `accounts.ts`, `watch-list.ts`, `simulate.ts`, `state-diff.ts`, `inner.ts`, `sim-errors.ts`, `describe-change.ts`, `analyze.ts`; simulation UI; `npm run live:check`; 5 live fixtures.

### M3 (rules and verdict)
- `app/lib/risk/context.ts`: rule input (decoded tx, simulation, top-level + inner instructions, **pre-transaction state map**, signers, changes only from a successful simulation, thresholds) and helpers (`atLeastPct` integer math, sources).
- `app/lib/risk/rules/approve.ts`: R-APPROVE (Approve/ApproveChecked, Token and Token-2022, top-level and inner) + R-DELEGATE-STATE (delegate/allowance changes in state), same key per token account -> merged.
- `app/lib/risk/rules/authority.ts`: R-SET-AUTHORITY (owner/close authority DANGER, other authorities CAUTION; instruction + state), R-ASSIGN (existing System-owned wallet; instruction + state).
- `app/lib/risk/rules/balances.ts`: R-OUTFLOW (signers' SOL incl. fee, signer-owned token accounts; 90%/50%; dust floor), R-CLOSE-ACCOUNT, R-HIGH-FEE (Should).
- `app/lib/risk/rules/visibility.ts`: R-UNKNOWN-PROGRAM, R-DURABLE-NONCE (Should), R-SIM-FAILED, R-UNRESOLVED, R-MEMO (info).
- `app/lib/risk/engine.ts`: merge (one flag per account per kind, highest severity, combined sources/evidence, `relatedRuleIds`), verdict DANGER > UNKNOWN > CAUTION > LOW_RISK, `complete` flag.
- `app/lib/risk/templates.ts`: verdict labels ("Danger: don't sign unless you're certain" / "Could not fully check" / "Caution: check the details" / "No known risks found"), reasons, fallback sentences per rule (for M5).
- `simulation.preState` added (state of every fetched account before the transaction, also when the simulation fails).
- `/api/analyze` returns `verdict` and echoes `userAddress` (never used by the rules).
- UI: `verdict-card.tsx`, `flag-list.tsx` (severity label, title, detail, "Based on" sources, evidence with Copy buttons), optional "Which address is yours?" field ("(you)" marker via context).
- `live:check`: verdict checks for every case + 6th live case `approval-unfunded-fee-payer`; `--record` keeps existing fixtures (`--overwrite` to re-record).

### M3 demonstration (user's cases)
| Case | Source | Result |
|---|---|---|
| Ordinary 0.01 SOL payment | M2 fixture `sol-transfer` (and live route) | **No known risks found**, no flags, complete |
| Unlimited approval, no tokens moved | M2 fixture `token-approval` (and live route) | **Danger**; one flag for the token account: R-APPROVE + R-DELEGATE-STATE, sources = instruction #0 + delegate account change; owner/balance from pre-state |
| Delegate change only in account state | M2 fixture account data, synthetic transaction (unknown program, no Approve anywhere) | **Danger** via R-DELEGATE-STATE (+ R-UNKNOWN-PROGRAM caution) |
| Simulation failed | M2 fixtures `unfunded-fee-payer`, `deactivated-lookup-table` | **Could not fully check** (R-SIM-FAILED) |
| Unresolved lookup table | synthetic | **Could not fully check** (R-UNRESOLVED + R-SIM-FAILED) |
| Truncated watch list | synthetic (46 writable accounts, successful simulation) | **Could not fully check** (R-UNRESOLVED; R-UNKNOWN-PROGRAM caution) |
| Danger + incomplete | live fixture `approval-unfunded-fee-payer` (recorded in M3); synthetic: approval with RPC down, approval with unresolved table | **Danger** kept, `complete: false`, gaps listed |
| Drainer as fee payer / as co-signer | M2 fixture account data, synthetic transactions | **Danger** |
| User address changed | M2 fixture + live route | verdict identical (deep equal) |

## Test and check status (end of M3)
- `npm run check`: pass (typecheck clean, lint clean, **157/157 tests** in 12 files: risk-rules 39, decode 29, simulation-units 19, risk-pipeline 14, simulate-pipeline 11, format 10, analyze-route 9, scripts 8, state-diff 7, simulation-ui 4, verdict-ui 4, instruction-list 3).
- Mutation check: changing `>=` to `>` in the percentage helper fails 6 rule tests; trusting the instruction's owner field fails the pre-state owner test.
- `npm run build`: pass.
- `npm run live:check`: 6 live devnet cases, all checks passed (incl. verdicts).
- Live route (dev server, Helius primary): payment "No known risks found"; approval "Danger" (merged flag) identical for 3 user-address variants; approval with unfunded fee payer "Danger" + incomplete. No warnings or secrets in the server log.
- `npm run scan:secrets`: clean. Fixtures: no URLs or keys.

## Partially implemented work
- None. M4 has not started.

## Next three steps (once M4 is approved)
1. `scripts/setup-demo.ts`: create/load `keys/demo-{authority,victim,attacker}.json` (devnet only, git-ignored), print addresses/balances, stop and ask the user to send ~1 devnet SOL from Phantom to the demo authority (option A) if below 0.3 SOL; DEMO mint (6 decimals), victim ATA + 1,000 DEMO, 0.05 SOL to victim; write `data/demo.devnet.json` (public addresses only).
2. `app/lib/scenarios/` builders for S1-S8 (unsigned, fee payer = owner), `GET/POST /api/scenarios`, ScenarioButtons (expected verdict shown only after the check).
3. `scripts/scenarios-check.ts` (AI off, delay between scenarios, non-zero exit on mismatch).

## Known issues
- Inner instructions of known programs: in the one live case checked they came back node-parsed (see the qualified note in DECISIONS); mapped to client names and marked `decodedBy: "rpc"`.
- The public devnet fallback rate-limits some heavy methods (only `live:check` discovery uses them).
- Windows `git` CRLF warnings; npm 11 skipped `esbuild` postinstall (tsx works); 8 moderate `npm audit` advisories in template deps; stopping a background `next dev` on Windows leaves a child process on the port.
- Visual check of VerdictCard/FlagList in a browser (looks, keyboard, 375 px) not yet done by the user; planned for M6 QA.

## Environment variables (names only; values live in `.env.local`, which the user creates)
- Server-only: `SOLANA_RPC_URL` (required), `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY` (required unless `AI_ENABLED=false`), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
- Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run and verify
- `npm install`; `.env.local` from `.env.example` (the user fills values; never print the file); `npm run check:env`.
- `npm run dev` -> http://localhost:3000. Paste a transaction (`npm run samples:print`, or a `txBase64` from `tests/fixtures/live/*.json`) and click Check.
- `npm run check`, `npm run build`, `npm run live:check` (needs `.env.local`), `npm run scan:secrets` before every push.

## Unpushed local commits
- None (the M3 checkpoint commit is pushed; verify with `git status -sb`).

## Decisions awaiting the user
- Approval to start M4 (recommended effort: medium).
- Read the MLH Challenges rules when convenient.
- Optional: look at a result page in the browser (paste a fixture `txBase64`) to check the VerdictCard/FlagList wording and layout.

## Decided by the user
- 6 Nov: scaffold via sibling folder; npm; demo funding option A (in M4); MIT license.
- 7 Nov: schedule above; MLH Challenges; personal targets 7:30 PM / 9:15 PM IST; M2 simulation only; M3 rules/verdict only (no funding, no Gemini).
