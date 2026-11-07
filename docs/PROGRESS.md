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
| M5 AI | **Completed and verified** (Sat 7 Nov ~04:40 IST). Approved by the user for M5 only (effort max), started from c8f58de. |
| M6 Polish | **In progress.** Approved by the user for M6 only (effort high) on Sat 7 Nov, starting from 66615b7. Recording plan: A + D (record after the Gemini reset; saved replays as the backup). |
| M7-M8 | Not approved |

- Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges are recorded here; none so far.
- M7 is not approved. Stop after M6 and wait.

## Completed and verified
### M0-M4 (summary)
- Scaffold, env/secret tooling, git; decoder (legacy/v0/v1); devnet simulation and state diff; 12 risk rules + verdict (DANGER > UNKNOWN > CAUTION > LOW_RISK, `complete` flag); demo setup (funded, rerun-safe) and scenarios S1-S8 with buttons; `live:check`, `scenarios:check`, recorded fixtures.

### M5 (AI explanation)
- Pipeline: decode -> simulate -> rules/verdict -> **explanation** (`app/lib/analyze.ts`). The explainer receives only `buildExplanationContext(...)` of the finished analysis; it returns text and cannot change the verdict (tested, including an explainer that tries).
- `app/lib/ai/facts.ts`: facts sent to Gemini (verdict, findings with "based on" lines, our instruction descriptions, account changes, simulation status, could-not-check list, optional yourAddress) + capped `untrusted` block (memos, program logs). Never: raw tx, keys, URLs, scenario labels/expected verdicts. Also the validator's meta (coverage, grounding from trusted facts only).
- `app/lib/ai/prompt.ts`: system instruction + JSON schema. `app/lib/ai/gemini.ts`: REST client (key in `x-goog-api-key`), JSON schema output, thinking MINIMAL -> LOW -> none per model, retry/fallback per ARCHITECTURE 9.6 bounded by the 35 s route deadline, 400 `API_KEY_INVALID` = auth.
- `app/lib/ai/validate.ts`: zod shape + meaning checks (guarantees, signing advice vs verdict, downplaying, grounding of amounts/percentages/addresses, invented transfers, hedge for incomplete checks, coverage of findings and SOL transfers).
- `app/lib/ai/template.ts` (built-in explanation, passes the same validator) and `app/lib/ai/explain.ts` (cache of accepted answers keyed by the exact facts, 6 h; notices; `explainerFromEnv`: AI_ENABLED=false or no key -> built-in, no call).
- `/api/analyze`: analysis cache (10 min, 200, tx + userAddress), `fresh: true` = Check again, per-IP rate limit 10/min (cached answers and bad requests free, 429 + Retry-After), `maxDuration = 40`. `app/lib/server-state.ts`, `app/lib/util/cache.ts`, `app/lib/util/rate-limit.ts`, `app/lib/gaps.ts`.
- UI: `explanation-panel.tsx` beside the VerdictCard ("AI explanation" + model, or "Built-in explanation" + reason), "Saved result from ..." note and **Check again** button.
- `scenarios:check -- --ai` (live explanation step); default stays AI off.

### M5 results, by source
**Live provider (Gemini REST, 7 Nov 2026, primary gemini-3.5-flash served as gemini-3.6-flash):**
- Field check: `thinkingLevel` MINIMAL accepted by the primary (0 thought tokens vs 167 without), rejected by gemini-flash-latest (400 naming the level); `responseJsonSchema` and `responseSchema` both accepted; invalid key -> HTTP 400 `API_KEY_INVALID`; unknown model -> 404.
- `scenarios:check -- --ai` run 1: **7/8 explanations accepted from Gemini**, including **S3** (explains the 0.01 SOL payment and the separate unlimited permission, "No tokens move right now") and **S8** (Danger kept; memo mentioned only as sender text; no "safe"); S2 fell back (`SIGNING_ADVICE`), traced to a validator false positive and fixed with a regression test built from that exact answer.
- Through the running `/api/analyze` route: S3 accepted (both parts explained), repeat served from the cache (`cache.hit`), Check again re-asked Gemini (accepted, different wording), **S8 accepted from Gemini, verdict Danger**. Server log contained no key, prompt or memo text.
- Bogus key (live): one call, HTTP 400 INVALID_ARGUMENT -> built-in with AI_AUTH, log "check GEMINI_API_KEY", key not logged. AI_ENABLED=false: zero calls.
- `scenarios:check -- --ai` run 2 (after the quota ran out): primary 429 `RESOURCE_EXHAUSTED` (daily), fallback 503/timeouts -> built-in explanations for 7/8 (S6 still got through); all 8 verdicts unchanged.
**Mocked (offline tests):** invalid JSON, schema/format errors, 401/403/400 API_KEY_INVALID, 429, 503, timeouts, network errors, 404 -> fallback, 400 thinking step-down (remembered), 400 strip-and-retry, deadline (none / mid-way / real hanging attempt cut off), blocked answer, AI off, not configured, cache reuse / Check again / different facts never reuse, "go ahead and sign" for Danger -> built-in shown in the UI.
**Built-in fallback:** used for AI off, missing key, rejected answers and provider failures; its text passes the validator for all 14 fixtures; "Could not fully check" and "Danger with incomplete evidence" pages keep the gap visible in the VerdictCard, the "What could not be checked" panel and the explanation.

## Test and check status (end of M5)
- `npm run check`: pass (typecheck clean, lint clean, **270/270 tests** in 21 files: risk-rules 48, decode 29, ai-validate 24, ai-gemini 24, simulation-units 19, scenarios 15, risk-pipeline 14, ai-pipeline 13, scenarios-replay 12, simulate-pipeline 11, format 10, analyze-route 9, scripts 8, state-diff 7, explanation-ui 5, cache-rate-limit 5, verdict-ui 4, simulation-ui 4, analyze-route-cache 4, instruction-list 3, scenario-buttons 2).
- `npm run build`: pass, no warnings.
- `npm run scenarios:check` (AI off, live devnet): 8/8. Fixture regressions (scenarios-replay, risk-pipeline, simulate-pipeline, ai-pipeline): pass.
- `npm run scan:secrets`: clean.

## Partially implemented work
- M6 started Sat 7 Nov 14:30 IST.
  - Done and verified (15:00): `fixtures:save` (live, `--ai`, `--offline`), `data/fixtures/` for S1-S8 captured live on devnet at 14:42 IST, **S3 and S8 with accepted Gemini explanations** (model version gemini-3.6-flash); replay route and page (banner above the verdict); streamed step progress with the verdict shown before the explanation; Try again, rate-limit countdown, raw JSON. Replays verified after a restart of the production server with the RPC and Gemini unreachable (byte-identical to the saved files).
  - Next: real-browser review (desktop and 375 px), manual QA list, README and learning notes.

## Next three steps (once M6 is approved)
1. UI states and accessibility pass (keyboard, 375 px, contrast, loading per step), user browser check of the result page.
2. `scripts/save-fixtures.ts` (`fixtures:save`) and a "Replay saved example" option, labelled with the time it was saved; ideally captured when Gemini quota is available so replays include accepted AI explanations.
3. README draft per ARCHITECTURE 16, `docs/LEARNING_NOTES.md` review, and the manual QA list from ARCHITECTURE 13.

## Known issues
- **Gemini free tier: 20 requests per day for gemini-3.5-flash** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), used up on 7 Nov (reset about 14:00 IST, midnight Pacific). The fallback gemini-flash-latest was overloaded all session. Until the reset, explanations fall back to the built-in text (verdicts unaffected). See "Decisions awaiting the user".
- Each live AI call took about 6.5-7.7 s inside the route (well within the 35 s deadline).
- The rate limit (10 fresh checks/min/IP) can be hit when clicking many scenarios quickly while recording.
- Without any RPC, owner-dependent findings are "could not be verified" (by design).
- Windows `git` CRLF warnings; npm 11 skipped `esbuild` postinstall (tsx works); 8 moderate `npm audit` advisories in template deps; stopping a background `next dev` on Windows leaves a child process on the port.
- Result pages not yet checked by the user in a browser (looks, keyboard, 375 px) - M6.

## Environment variables (names only; values live in `.env.local`, which the user creates)
- Server-only: `SOLANA_RPC_URL` (required), `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY` (required unless `AI_ENABLED=false`), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
- Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run and verify
- `npm install`; `.env.local` from `.env.example` (the user fills values; never print the file); `npm run check:env`.
- `npm run dev` -> http://localhost:3000, click a scenario button or paste a transaction; "Check again" re-runs without the cache.
- `npm run check`, `npm run build`, `npm run scenarios:check` (AI off), `npm run scan:secrets` before every push. `npm run scenarios:check -- --ai` uses 8 Gemini requests (of 20/day).

## Unpushed local commits
- None (the M5 checkpoint commit is pushed; verify with `git status -sb`).

## Decisions awaiting the user
- **Gemini quota for the demo** (20 requests/day on the primary model). Options, no paid options suggested:
  - A: record after the daily reset (about 14:00 IST) and keep Gemini calls for the demo itself (the 6 h explanation cache reuses answers for the same findings).
  - B: the user creates a second free key in another Google Cloud project (quota is per project) and pastes it into `.env.local` themself.
  - C: switch `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` to models with their own free quota (needs a live check after the reset).
  - D: rely on saved replays (M6 fixtures) captured while quota is available, labelled as saved.
- Read the MLH Challenges rules when convenient.

## Decided by the user
- 6 Nov: scaffold via sibling folder; npm; demo funding option A; MIT license.
- 7 Nov: schedule; MLH Challenges; personal targets 7:30 PM / 9:15 PM IST; M2 simulation only; M3 rules/verdict; empty-balance rule; ownership correction; M4 scenarios (funded 1 devnet SOL); M5 Gemini explanations only (max effort); M6 approved (high effort) with recording options A + D, the existing Gemini project and models, routine checks AI off.
