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
| M3 Rules and verdict | Completed and verified (Sat 7 Nov ~01:40 IST) |
| M4 Scenarios | **Completed and verified** (Sat 7 Nov ~03:10 IST). Approved by the user for M4 only. Demo authority funded by the user (1 devnet SOL from Phantom). |
| M5 AI | **Approved by the user (M5 only, Sat 7 Nov ~03:55 IST), in progress.** Started from c8f58de. Effort: max (user). |
| M6-M8 | Not approved |

- Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges are recorded here; none so far.
- **Next recommended effort (M5): high.** The AI step has edge cases that matter for the demo: Gemini request/response format and field names for JSON output and thinking level (must be checked against the live API), retries/fallback model/template, output validation, the contradiction check, and S8 prompt injection.

## Completed and verified
### M0-M2 (summary)
- Template scaffold, env/secret tooling, git; decoder (legacy/v0/v1, official program clients); devnet simulation with failover RPC, genesis guard, lookup tables, pre/post state diff, inner instructions, error mapping; `live:check` + live fixtures.

### M3 (rules and verdict)
- `app/lib/risk/*`: 12 rules, merge per account/problem, verdict DANGER > UNKNOWN > CAUTION > LOW_RISK with `complete` flag, templates; VerdictCard, FlagList, optional user address ("(you)" only).

### M4 (scenarios), plus two rule decisions made at the start of M4
- **Empty-balance decision:** known empty token account + external delegate: unlimited -> DANGER, finite positive -> CAUTION with exact allowance (`allowanceRaw`); zero allowance never fires.
- **Ownership correction:** without verified owner data the instruction's owner is an unverified claim; approval / set-authority / close-account / assign then give a CAUTION "could not be verified" flag + R-UNRESOLVED gap -> "Could not fully check", unless verified Danger exists elsewhere (kept, gap shown). Regression test: delegate claimed as owner -> UNKNOWN; mutation-checked.
- `app/lib/scenarios/index.ts` (S1-S8: pitch shown on button, description + expected revealed after the check), `build.ts` (unsigned v0, real recent blockhash, fee payer = owner), `demo-config.ts` (public addresses, statically scoped read).
- `app/api/scenarios/route.ts`: `GET` list (no expected verdicts), `GET ?reveal=<id>`, `POST {id, owner?}` -> `{ txBase64, owner }` (devnet check first).
- UI: `scenario-buttons.tsx` (buttons + reveal card); `checker.tsx` routes pasted text and scenarios through the same `check(tx)`.
- `scripts/setup-demo.ts` (rerun-safe; see DECISIONS) and `scripts/scenarios-check.ts` (AI off, delay, exit 1 on mismatch, `--record`).
- Demo accounts on devnet (public, in `data/demo.devnet.json`): authority `7uGEmoiKToMgPKcBLrUFBraKsM6cWiNDWc7i65RduVV3`, victim `4gow1QUNG34T5UhNEjnAph9oovSxTbbyWVQYkezBpj9r` (0.05 SOL, 1,000 DEMO), attacker `59WCXruvf9gS3wUajDcaGnyMQfvueVa74ba8s5bhv3ZB`, DEMO mint `5yGYXCHGR1jyF3znb7Xc2vT8XKCGoqBjpmWNh7h9KNss` (6 decimals), victim token account `4is5nB5zd7T3Hn3KS5mn1wyFXjXzG3pDnmtR8BrSJfc1`, friend `F61U...AG9Y`, S7 program SPL Noop `noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV`. Keypairs in `keys/` (git-ignored; never committed or printed).

### M4 verification
- Setup runs: (1) keys created, stopped for funding (exit 2, nothing sent); (2) rerun reused the same keys, still stopped; (3) after the user funded 1 SOL: balance read first, then 3 confirmed devnet transactions (create mint, mint 1,000 DEMO, send 0.05 SOL); (4) rerun: "to do: nothing", no transaction, balances unchanged (authority 0.94742476 SOL), data file unchanged except `updatedAt`.
- `npm run scenarios:check` (live devnet, AI off): **8/8 match** (S1 No known risks found; S2, S3, S4, S5, S6, S8 Danger; S7 Caution); all simulations ok; S8 Danger with the memo as an info flag. Mismatch path proven: S1's expectation temporarily changed -> FAIL and exit 1 (reverted).
- Scenario buttons: jsdom test (call order build -> analyze -> reveal; tx in paste box; same `kind: "base64"` path) and the same HTTP sequence against the dev server with live devnet: 8/8 unsigned, simulated ok, verdict matches. Dev log clean.
- Fixtures: `tests/fixtures/scenarios/*.json` (live, M4) replayed offline; `tests/fixtures/live/*.json` (M2/M3) unchanged.

## Test and check status (end of M4)
- `npm run check`: pass (typecheck clean, lint clean, **195/195 tests** in 15 files: risk-rules 48, decode 29, simulation-units 19, scenarios 15, risk-pipeline 14, scenarios-replay 12, simulate-pipeline 11, format 10, analyze-route 9, scripts 8, state-diff 7, simulation-ui 4, verdict-ui 4, instruction-list 3, scenario-buttons 2).
- `npm run build`: pass, no warnings.
- `npm run live:check`: 6 live devnet cases pass. `npm run scenarios:check`: 8/8 live.
- `npm run scan:secrets`: clean (keys/ never staged; fixtures have no URLs or keys).

## Partially implemented work
- None. M5 has not started.

## Next three steps (once M5 is approved)
1. `app/lib/ai/gemini.ts`: REST `generateContent` with the key in `x-goog-api-key` (server only), 20 s timeout, retries per ARCHITECTURE 9.6 (429/503/timeout -> retry, fallback model, template; 404 -> fallback; 400 -> retry without optional fields; 401/403 -> template), `modelVersion` recorded. Check the current field names for JSON output and the thinking level against the live API first.
2. `app/lib/ai/prompt.ts` + `schema.ts` + `explain.ts`: compact facts (verdict, flags, decoded instructions, state changes) with an UNTRUSTED block for memos/logs; zod validation, length caps, control-character stripping; contradiction check ("safe" under DANGER etc.); template fallback from `FALLBACK_SENTENCES`. AI never changes the verdict.
3. Explanation UI (labelled "AI explanation" / "Built-in explanation"), in-memory cache and rate limit (ARCHITECTURE 9.7), `scenarios:check -- --ai` to confirm S8 is not called safe.

## Known issues
- Without any RPC, owner-dependent findings are "could not be verified" (by design since the ownership correction).
- Inner instructions of known programs come back node-parsed in the case observed (qualified note in DECISIONS).
- The public devnet fallback rate-limits some heavy methods (only `live:check` discovery uses them).
- Windows `git` CRLF warnings; npm 11 skipped `esbuild` postinstall (tsx works); 8 moderate `npm audit` advisories in template deps; stopping a background `next dev` on Windows leaves a child process on the port.
- Not yet looked at in a browser by the user: VerdictCard/FlagList/scenario buttons (looks, keyboard, 375 px) - M6 QA.
- Demo authority keeps ~0.947 devnet SOL; the victim's 0.05 SOL is only used by simulations (nothing is sent in scenarios).

## Environment variables (names only; values live in `.env.local`, which the user creates)
- Server-only: `SOLANA_RPC_URL` (required), `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY` (required unless `AI_ENABLED=false`), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
- Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run and verify
- `npm install`; `.env.local` from `.env.example` (the user fills values; never print the file); `npm run check:env`.
- `npm run setup:demo` (already done; rerun is safe), `npm run dev` -> http://localhost:3000, click a scenario button or paste a transaction.
- `npm run check`, `npm run build`, `npm run live:check`, `npm run scenarios:check`, `npm run scan:secrets` before every push.

## Unpushed local commits
- None (the M4 checkpoint commit is pushed; verify with `git status -sb`).

## Decisions awaiting the user
- Approval to start M5 (recommended effort: high).
- Read the MLH Challenges rules when convenient.
- Optional now: open `npm run dev`, click S3 and S8, and check the layout/wording in the browser.

## Decided by the user
- 6 Nov: scaffold via sibling folder; npm; demo funding option A; MIT license.
- 7 Nov: schedule; MLH Challenges; personal targets 7:30 PM / 9:15 PM IST; M2 simulation only; M3 rules/verdict; empty-balance rule; ownership correction (instruction owner unverified without state); M4 scenarios (funded 1 devnet SOL); Gemini only in M5.
