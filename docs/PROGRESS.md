# SignSafe progress

Source of truth for a fresh session. Read with `docs/DECISIONS.md`, `CLAUDE.md`, `ARCHITECTURE.md`.

## Timing
- **Hacking start:** confirmed by the user on Fri 6 Nov 2026 (exact ceremony time not yet given; work began about 11:15 PM IST).
- **Deadlines (planning values, earlier reading, until the user confirms the Devpost countdown):**
  - Initial submission: **Sun 8 Nov 2026, 7:30 PM IST**
  - Final submission and end of hacking: **Sun 8 Nov 2026, 9:15 PM IST**
  - (Later reading, not used for planning: 8:30 PM / 10:15 PM IST.)
- Devpost countdown confirmed: **not yet**. Devpost rules (video length etc.): **not yet read**.

## Milestone approval state
| Milestone | Status |
|---|---|
| M0 Kickoff | **In progress** (approved by the user) |
| M1 Decode | Not approved. Must not start until the user explicitly approves. |

Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges (for example "approved through M3") are recorded here.

## Current state
- Template scaffolded into the root and dependencies installed (npm).
- git initialised on `main`; `origin` = https://github.com/DivyanshuKirpal/signsafe.git (remote was empty).
- `scripts/scan-secrets.ts` + `npm run scan:secrets` added.

## In progress (M0)
- Remove template demo code; minimal SignSafe page shell; devnet only.
- `.env.example`, `scripts/check-env.ts`, script stubs, `check` script, docs stubs, README, LICENSE.

## Next three steps
1. Finish M0 items above.
2. `npm run check`, `npm run build`, dev server smoke test.
3. Checkpoint commit and push; milestone report; wait for approval of M1.

## Known issues
- The template's Surfpool-based test cannot run on Windows (no win32 binary). Being removed with the demo cards (see DECISIONS).

## Environment variables (names only; values live in `.env.local`, which the user creates)
Server-only: `SOLANA_RPC_URL`, `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run
- `npm install`, then `npm run dev` (http://localhost:3000).
- `npm run scan:secrets` before every push.

## Unpushed local commits
- None yet.

## Open questions for the user
- Exact official start time and the Devpost countdown deadline.

## Next recommended effort
- To be set at the end of M0.
