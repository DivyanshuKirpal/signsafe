# SignSafe progress

Source of truth for a fresh session. Read with `docs/DECISIONS.md`, `CLAUDE.md`, `ARCHITECTURE.md`. Then run `git log --oneline -15`, `git status`, `npm run check`.

## Timing
- **Hacking start:** confirmed by the user on Fri 6 Nov 2026 (exact ceremony time not yet given; work began about 11:15 PM IST).
- **Deadlines (planning values, earlier reading, until the user confirms the Devpost countdown):**
  - Initial submission: **Sun 8 Nov 2026, 7:30 PM IST**
  - Final submission and end of hacking: **Sun 8 Nov 2026, 9:15 PM IST**. No commits or pushes after this.
  - (Later reading, not used for planning: 8:30 PM / 10:15 PM IST.)
- Devpost countdown confirmed: **not yet**. Devpost rules (video length, required fields): **not yet read**.

## Milestone approval state
| Milestone | Status |
|---|---|
| M0 Kickoff | **Completed and verified** (Fri 6 Nov, about 11:40 PM IST) |
| M1 Decode | **Awaiting the user's explicit approval. Do not start.** |
| M2-M8 | Not approved |

- Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges (for example "approved through M3") are recorded here; none so far.
- **Next recommended effort (M1): high.** Decoding has many edge cases (legacy vs v0 vs v1 messages, lookup tables, signer/writable derivation, parse failures, BigInt amounts).

## Completed and verified (M0)
- Official Solana `kit/nextjs` template scaffolded (create-solana-dapp 4.8.5) into the root via a sibling temp folder; npm; dependencies installed.
- Template demo code removed (action cards, wallet UI, cluster selector, hooks, Surfpool test). Minimal SignSafe page: title, tagline, fixed "Devnet" label, theme toggle.
- Added deps: `@solana-program/token-2022`, `@solana-program/compute-budget`, `zod`, dev `tsx`. Removed dev `@solana/surfpool` (no Windows binary).
- `.gitignore` (env files except `.env.example`, `keys/`, `*.log`, `.next`, `node_modules`, `coverage`, `.vercel`) verified with `git check-ignore`. `.gitattributes` (`* text=auto`).
- `.env.example` (placeholders only).
- Scripts: `check`, `check:env`, `scan:secrets` (working); `setup:demo`, `scenarios:check`, `fixtures:save` (stubs that exit 1).
- Unit tests: `tests/scripts.test.ts` (8 tests: secret patterns, env status, safety checks never print values).
- Vitest projects: `unit` (Node) and `ui` (jsdom).
- Docs: `PROGRESS.md`, `DECISIONS.md`, `LEARNING_NOTES.md`, `DEMO_SCRIPT.md` (outline), `DEVPOST.md` (outline), `README.md` (draft with credits), `LICENSE` (MIT).
- git on `main`, `origin` = https://github.com/DivyanshuKirpal/signsafe.git (public). Pushes verified with `git ls-remote`.

## Test and check status (end of M0)
- `npm run check`: pass (typecheck clean, lint clean, 8/8 tests).
- `npm run build`: pass (static `/`).
- Dev server: `GET /` returned 200 with title "SignSafe".
- `npm run check:env`: exits 1 as expected, because `.env.local` does not exist yet (`SOLANA_RPC_URL`, `GEMINI_API_KEY` missing).
- `npm run scan:secrets`: clean.

## Partially implemented work
- None. M1 has not started.

## Next three steps (once M1 is approved)
1. `app/lib/config.ts` (limits, thresholds) and `app/lib/solana/programs.ts` (known-program registry, ARCHITECTURE section 17).
2. `app/lib/solana/decode.ts`: base64 -> wire transaction -> compiled message (legacy, v0; v1 if Kit supports it) -> `DecodedTx` with signers, writable, durable-nonce flag; instruction parsing via `@solana-program/*` identify/parse helpers; unit tests that build S1-like (SOL transfer) and S2-like (Approve u64 max) transactions offline with Kit.
3. Input validation with zod, `POST /api/analyze` returning the decoded list (Node runtime), and a minimal TxInput + InstructionList on the page.

## Known issues
- Windows `git` prints "LF will be replaced by CRLF" warnings. Harmless (`.gitattributes` normalises to LF in the repo).
- npm 11 skipped `esbuild`'s postinstall script; `tsx` still works (verified).
- `npm audit` reports 8 moderate advisories in template dependencies. Not addressed; no major upgrades mid-hackathon without asking.

## Environment variables (names only; values live in `.env.local`, which the user creates)
- Server-only: `SOLANA_RPC_URL` (required), `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY` (required unless `AI_ENABLED=false`), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
- Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run and verify
- `npm install`
- Copy `.env.example` to `.env.local` and fill in values (the user does this; never print the file).
- `npm run check:env` (present/missing only)
- `npm run dev` -> http://localhost:3000 (run in the background or a second terminal)
- `npm run check` before commits; `npm run build`; `npm run scan:secrets` before every push.

## Unpushed local commits
- None (the M0 checkpoint commit is pushed; verify with `git status -sb`).

## Decisions awaiting the user
- Approval to start M1 (recommended effort: high).
- Exact official start time and the Devpost countdown deadline.
- The user should create `.env.local` from `.env.example` before M2 (simulation needs `SOLANA_RPC_URL`).

## Decided by the user (6 Nov)
- Scaffold via sibling folder; npm; demo funding option A (user sends about 1 devnet SOL from Phantom in M4); MIT license.
