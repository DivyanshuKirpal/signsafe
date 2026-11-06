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
| M2 Simulate and diff | **Completed and verified** (Sat 7 Nov ~00:55 IST). Approved by the user for M2 only. |
| M3 Rules and verdict | **Awaiting the user's explicit approval. Do not start.** |
| M4-M8 | Not approved |

- Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges (for example "approved through M3") are recorded here; none so far.
- **Next recommended effort (M3): high.** The rules decide the verdict, so every rule needs positive and negative tests, dedup/merge (R-APPROVE with R-DELEGATE-STATE), precedence (DANGER > UNKNOWN > CAUTION > LOW_RISK) and "compare against the account's current owner, not the user" all have to be exactly right.

## Completed and verified
### M0
- Official Solana `kit/nextjs` template scaffolded; npm; minimal SignSafe page with fixed "Devnet" label; `.gitignore` verified; `.env.example`; scripts `check`, `check:env`, `scan:secrets`; git `main` -> https://github.com/DivyanshuKirpal/signsafe.git (public).

### M1 (decode)
- `LICENSE` with the template's MIT notice; `config.ts`; `programs.ts` registry; `format.ts`; `bigint-json.ts`; `decode.ts` (legacy, v0, v1); `instructions.ts` (official program clients); `describe.ts`; `POST /api/analyze`; paste-and-check UI.

### M2 (simulate and diff)
- `app/lib/solana/rpc.ts`: Kit RPC on a failover transport (10 s timeout, one retry on the fallback for network/timeout/429/5xx); genesis-hash devnet guard (`ensureDevnet`); lookup-table fetcher (one table per request, missing ones stay unresolved); `redactSecrets`.
- `app/lib/solana/rpc-recording.ts`: record/replay of raw RPC traffic (fixtures).
- `app/lib/solana/accounts.ts`: RPC account (jsonParsed) -> validated snapshot (lamports, owning program, token: mint/owner/amount/decimals/delegate/allowance/close authority; mint: decimals/authorities).
- `app/lib/solana/watch-list.ts`: fee payer, signers, resolved writable accounts, mints of token accounts; cap 40 (signers first, then signer-owned token accounts, other writable, mints); dropped writable accounts -> `WATCH_LIST_TRUNCATED` warning.
- `app/lib/solana/simulate.ts`: pre-state `getMultipleAccounts` -> `simulateTransaction` (sigVerify false, replaceRecentBlockhash true, innerInstructions true, accounts jsonParsed, commitment confirmed) -> diff, inner instructions, capped logs (50 x 200), RPC-reported fee, token decimals attached to plain Approve/Transfer, error mapping; node refusals are results.
- `app/lib/solana/state-diff.ts` (pure): sol (fee identified on the fee payer), token, delegate + allowance, tokenOwner, closeAuthority, programOwner, created, closed.
- `app/lib/solana/inner.ts`: inner instructions from the node's parsed form (mapped to client names, `decodedBy: "rpc"`) or raw data (our parser).
- `app/lib/solana/sim-errors.ts`: plain messages for unfunded fee payer / another network, missing program, lookup table invalid, instruction errors (index + program), compute budget, rent, unknown.
- `app/lib/solana/describe-change.ts`: plain-English before/after for each change.
- `app/lib/analyze.ts`: shared pipeline (devnet check -> decode with lookup tables -> simulate). No RPC / not devnet / unreachable -> decoded result + `simulation.ran = false` with a reason.
- UI: `simulation-panel.tsx` (status, fee, changes, inner instructions, untrusted logs in Raw details), `state-changes.tsx`, `could-not-check.tsx`. Still says "no risk verdict yet".
- `scripts/live-check.ts` (`npm run live:check`, `-- --record`).

### M2 demonstration (user's two cases)
- **Live devnet RPC** (Helius primary endpoint; `npm run live:check`, all 5 cases PASS on Sat 7 Nov ~00:36 IST; and again through the running `/api/analyze` route):
  1. SOL transfer from existing wallet `Hjc6...zVRR` to a fresh address: sender 506.657270258 -> 506.647265258 SOL (**-0.010005 SOL, includes the network fee of 0.000005 SOL reported by the RPC**); recipient **Account created** and 0 -> 0.01 SOL (**+0.01 SOL**).
  2. Unlimited Approve on existing devnet USDC token account `9Jyw...6b2h`: **delegate none -> fresh address, allowance 0 -> u64 max (UNLIMITED)**; **no token-balance change**; only other change is the fee payer's -0.000005 SOL; decimals 6 looked up for the instruction.
  3. v0 transfer whose recipient `HjaM...trBY` is loaded from existing devnet lookup table `9Gaq...c55k`: table resolved over RPC, recipient +0.01 SOL.
  4. Deactivated devnet lookup table `4HWd...zVK6`: node refuses -> `LOOKUP_TABLE_INVALID`, no changes claimed.
  5. Fee payer that does not exist on devnet: `AccountNotFound` -> `FEE_PAYER_UNFUNDED` ("may be meant for another network"), no changes claimed.
- **Fixtures** (`tests/fixtures/live/*.json`, recorded from the live run above, replayed offline in `tests/simulate-pipeline.test.ts`): the same 5 cases.
- **Synthetic** (hand-written RPC answers, `tests/simulate-pipeline.test.ts` part 2 and unit tests): no RPC configured, non-devnet endpoint, RPC unreachable, 46 accounts > cap 40 (6 reported), unresolved lookup table placeholder, log capping, all state-diff kinds.

## Test and check status (end of M2)
- `npm run check`: pass (typecheck clean, lint clean, **99/99 tests** in 9 files: decode 29, simulation-units 19, simulate-pipeline 11, format 10, analyze-route 8, scripts 8, state-diff 7, simulation-ui 4 (jsdom), instruction-list 3 (jsdom)).
- `npm run build`: pass.
- `npm run live:check`: all checks passed (5 live devnet cases).
- Dev server: 3 POSTs to `/api/analyze` with live RPC returned 200 with the expected changes; no warnings or secrets in the server log.
- `npm run scan:secrets`: clean. Fixtures checked: no URLs or keys.

## Partially implemented work
- None. M3 has not started.

## Next three steps (once M3 is approved)
1. `app/lib/risk/types.ts`, `engine.ts`, `rules/*.ts`: R-APPROVE, R-DELEGATE-STATE (merge), R-SET-AUTHORITY, R-ASSIGN, R-OUTFLOW, R-CLOSE-ACCOUNT, R-UNKNOWN-PROGRAM, R-SIM-FAILED, R-UNRESOLVED, R-MEMO (+ Should: R-DURABLE-NONCE, R-HIGH-FEE); thresholds in `config.ts`; positive and negative tests for each, reusing the live fixtures.
2. Verdict precedence DANGER > UNKNOWN > CAUTION > LOW_RISK and `templates.ts` (rule texts and fallback sentences).
3. Wire the verdict into `analyze.ts` / the route; `VerdictCard` and `FlagList` in the UI (labels never say "safe").

## Known issues
- Inner instructions of known programs are decoded by the RPC node, not by our program clients (no raw bytes available); marked `decodedBy: "rpc"`.
- The public devnet endpoint (fallback) rate-limits some heavy methods (e.g. `getTokenLargestAccounts`, used only by `live:check` discovery); the pipeline does not use them.
- Plain token amounts stay in raw units when the token account is not in the watch list (rare).
- Windows `git` CRLF warnings; npm 11 skipped `esbuild` postinstall (tsx works); 8 moderate `npm audit` advisories in template deps; stopping a background `next dev` on Windows leaves a child process on the port.

## Environment variables (names only; values live in `.env.local`, which the user creates)
- Server-only: `SOLANA_RPC_URL` (required), `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY` (required unless `AI_ENABLED=false`), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
- Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run and verify
- `npm install`; `.env.local` from `.env.example` (the user fills values; never print the file); `npm run check:env`.
- `npm run dev` -> http://localhost:3000. Paste a transaction (`npm run samples:print`, or a `txBase64` from `tests/fixtures/live/*.json`) and click Check.
- `npm run check`, `npm run build`, `npm run live:check` (needs `.env.local`), `npm run scan:secrets` before every push.

## Unpushed local commits
- None (the M2 checkpoint commit is pushed; verify with `git status -sb`).

## Decisions awaiting the user
- Approval to start M3 (recommended effort: high).
- Read the MLH Challenges rules when convenient.
- Demo funding (M4): option A already chosen (user sends ~1 devnet SOL from Phantom to the printed demo-authority address when M4 starts).

## Decided by the user
- 6 Nov: scaffold via sibling folder; npm; demo funding option A; MIT license.
- 7 Nov: schedule above; MLH Challenges is the submission platform; personal targets 7:30 PM / 9:15 PM IST; M2 is simulation only (no sending, no funding).
