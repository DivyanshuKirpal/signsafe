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
| M4 Scenarios | Completed and verified (Sat 7 Nov ~03:10 IST) |
| M5 AI | Completed and verified (Sat 7 Nov ~04:40 IST), effort max, from c8f58de |
| M6 Polish | **Completed and verified** (Sat 7 Nov ~15:35 IST). Approved by the user for M6 only (effort high), started from 66615b7. |
| M7 Stretch | **Awaiting the user's explicit approval and choice. Do not start.** ARCHITECTURE 14: the user picks F3 (check with Phantom before signing), F4 (explain a confirmed transaction by signature) or a Vercel deploy, or skips to M8. |
| M8 Submit | Not approved |

- Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges are recorded here; none so far.
- **Next recommended effort (M7): high** for a Vercel deploy or F4; **xhigh** for F3 (wallet signing flow, security-sensitive). The deploy is public, so it needs the user's go-ahead and the user sets the keys in the Vercel dashboard (never in chat).

## Completed and verified
### M0-M5 (summary)
- Scaffold, env/secret tooling, git; decoder (legacy/v0/v1); devnet simulation and state diff; 12 risk rules + verdict (DANGER > UNKNOWN > CAUTION > LOW_RISK, `complete` flag); demo setup (funded, rerun-safe) and scenarios S1-S8 with buttons; `live:check`, `scenarios:check`, recorded fixtures.
- M5: Gemini explanation after the verdict (`app/lib/ai/`): facts only (never the raw transaction), JSON schema output, lowest thinking level, retry/fallback bounded by a 35 s deadline, validation of meaning, built-in fallback, explanation cache (6 h, accepted answers only), analysis cache (10 min), rate limit (10 fresh checks/min/IP), `AI_ENABLED=false` = no call. Live: 7/8 accepted on the first run; S3 and S8 accepted through the route.

### M6 (polish, accessibility, README, learning notes, saved replay)
- **Saved results:** `npm run fixtures:save` (`scripts/save-fixtures.ts`, `app/lib/replay/saved-results.ts`) saves the AnalyzeResponse from the same pipeline and JSON conversion as `/api/analyze` to `data/fixtures/<scenario>.json`, with capture time, cluster, data source (live or recorded) and the unsigned transaction. Saved only when the simulation ran and the verdict matches. A refresh never replaces a better capture (AI explanation first, then live over recorded). Options: scenario list, `--ai`, `--offline`.
- **Captured (live devnet, 7 Nov 14:42 IST):** S1-S8, all verdicts as expected. **S3 and S8 with accepted Gemini explanations** (model version gemini-3.6-flash); the others with the built-in text (AI off). Re-runs kept both AI captures byte-identical (AI off; and AI with an invalid key -> AI_AUTH -> "KEPT").
- **Replay:** `GET /api/examples` (list) and `?id=` (one), reading only `data/fixtures` (the build traces exactly those 8 files). The page shows a "Saved result from (time)" banner above the verdict and a "Saved result" tag in the verdict card. Check again on a replay runs a new check. A failed demo build or a demo check without devnet offers that scenario's saved result.
- **Verified after a restart** of the production server with the RPC on a closed port and all outbound HTTPS through a dead proxy (devnet and Gemini unreachable): replays byte-identical to the saved files (capture time, verdict, completeness, explanation source and model kept); a live check on the same server honestly gives "Could not fully check" with the built-in explanation in 1.9 s; server log has codes only.
- **UI states (ARCHITECTURE 11):** streamed progress (`stream: true`, NDJSON): Done / Running / Waiting per step, the verdict shown as soon as the rules have run ("Writing the plain-English explanation... The verdict is already final."); errors in plain words with Try again (repeats the exact request; after a 429 it counts down from Retry-After); "New check, finished in ..." / "Cached result from ..." / "Saved result from ..." notes; raw JSON (rendered only when opened, copyable); screen-reader status line when a check finishes; the page scrolls the progress, then the verdict, into view.
- **Real-browser review** (Chrome via Playwright + axe-core, outside the repo; `docs/QA.md`): 375 px and 1280 px, dark and light, live (AI off) and with devnet and Gemini unreachable. S1, S3, S8, S7, an incomplete check, a very long memo, invalid input, copy buttons, keyboard and focus, Check again, Try again, the rate limit, slow network, replays. 64 checks passed after fixing 4 problems the review found (copy-button accessible name, stretched verdict card, verdict below the fold, countdown off by one second).
- **Docs:** README rewritten per ARCHITECTURE 16 (Windows/npm setup, demo commands, how the rules decide, what simulation can and cannot establish, Gemini and the fallback, how to recognise new, cached and saved results, security, limitations, credits, license); `docs/LEARNING_NOTES.md` reorganised into four parts with the M6 topics; `docs/QA.md` added. Template credit and both MIT notices kept (`LICENSE`).

### M6 results, by source
- **Live devnet:** `fixtures:save` S1-S8 (8/8 saved), `scenarios:check` AI off 8/8 at the checkpoint.
- **Live Gemini:** S3 accepted at the first attempt; S8 accepted after one timeout and a retry. About 3 of today's 20 requests used. Plus one call with a deliberately invalid key (rejected, AI_AUTH), which does not use project quota.
- **Browser (Chrome):** see `docs/QA.md`.
- **Offline tests:** saved-result format, replace rule, replay route (no network calls), streamed route, page states.

## Test and check status (end of M6)
- `npm run check`: pass (typecheck clean, lint clean, **299/299 tests** in 23 files; new: saved-results 17, checker-ui 8, 4 streaming tests in analyze-route-cache).
- Offline replay suites (saved-results, scenarios-replay, risk-pipeline, simulate-pipeline, ai-pipeline, analyze-route-cache, checker-ui): 83/83.
- `npm run build`: pass, no warnings.
- `npm run scenarios:check` (AI off, live devnet): 8/8.
- `npm run scan:secrets`: clean.

## Partially implemented work
- None.

## Next three steps (once approved)
1. M7, if the user approves it: the chosen stretch item (recommendation: Vercel deploy first; F3 is the most work).
2. M8: `docs/DEMO_SCRIPT.md` (2-3 min) and `docs/DEVPOST.md` (MLH Challenges text), final QA, freeze.
3. Recording (plan A + D): after the daily Gemini reset (about 13:30 IST), record S1, S3, S5 or S4, S8 live with AI on (about 4 requests; the 6 h explanation cache reuses answers); if the network fails, use "Replay a saved result".

## Remaining checks that need the user
- The five steps in `docs/QA.md`, "What still needs a person": the look in your own Chrome (dark and light), 375 px via DevTools device mode, the replay banner, one AI-on check (1 request), optionally a screen reader.
- Optional: also save S1 and S5 with AI explanations for the replay backup: `npm run fixtures:save -- s1 s5 --ai` (2 requests).
- Read the MLH Challenges rules (video length, required fields).

## Known issues
- **Gemini free tier: 20 requests per day for gemini-3.5-flash** (resets at midnight Pacific, about 13:30 IST). Beyond that, explanations fall back to the built-in text (verdicts unaffected).
- The AI-on path was not run in the browser review (routine checks stay AI-off); it is covered by the live S3/S8 captures, the M5 route checks and mocked UI tests.
- The rate limit (10 fresh checks/min/IP) can be hit when clicking quickly while recording; cached results and replays do not count.
- Without any RPC, owner-dependent findings are "could not be verified" (by design), so S3/S8 checked offline give "Could not fully check".
- `npm run ci` (template script) includes `format:check`, which fails because the code is not Prettier-formatted (Prettier's 80-column wrap was never applied); `npm run check` is the project's gate.
- Windows `git` CRLF warnings; npm 11 skipped `esbuild` postinstall (tsx works); 8 moderate `npm audit` advisories in template deps; stopping a background `next dev`/`next start` on Windows leaves a child process on the port (stop it by port).

## Environment variables (names only; values live in `.env.local`, which the user creates)
- Server-only: `SOLANA_RPC_URL` (required), `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY` (required unless `AI_ENABLED=false`), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
- Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run and verify
- `npm install`; `.env.local` from `.env.example` (the user fills values; never print the file); `npm run check:env`.
- `npm run dev` -> http://localhost:3000; click a scenario button, paste a transaction, or open "Replay a saved result". "Check again" always runs a new check.
- `npm run check`, `npm run build`, `npm run scenarios:check` (AI off), `npm run scan:secrets` before every push.
- `npm run fixtures:save` (AI off) refreshes the saved results without touching the AI captures; `-- s3 s8 --ai` uses Gemini quota.
- Restart test without touching `.env.local`: start `npx next start -p 3123` with `SOLANA_RPC_URL=http://127.0.0.1:9 SOLANA_RPC_FALLBACK_URL=http://127.0.0.1:9 NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 NO_PROXY=localhost,127.0.0.1` in the environment; replays must still work.

## Unpushed local commits
- None after the M6 checkpoint push (verify with `git status -sb`).

## Decisions awaiting the user
- **M7:** approve it and pick F3, F4 or a Vercel deploy, or skip to M8.
- Whether to also save S1 and S5 with AI explanations (2 Gemini requests).
- Read the MLH Challenges rules when convenient.

## Decided by the user
- 6 Nov: scaffold via sibling folder; npm; demo funding option A; MIT license.
- 7 Nov: schedule; MLH Challenges; personal targets 7:30 PM / 9:15 PM IST; M2 simulation only; M3 rules/verdict; empty-balance rule; ownership correction; M4 scenarios (funded 1 devnet SOL); M5 Gemini explanations only (max effort); M6 approved (high effort) with recording options A + D, the existing Gemini project and models, routine checks AI off.
