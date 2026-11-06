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
| M1 Decode | **Completed and verified** (Sat 7 Nov ~00:20 IST). Approved by the user for M1 only. |
| M2 Simulate and diff | **Awaiting the user's explicit approval. Do not start.** |
| M3-M8 | Not approved |

- Approval rule: stop at the end of every milestone, report, recommend an effort level, and wait. Pre-approved ranges (for example "approved through M3") are recorded here; none so far.
- **Next recommended effort (M2): high.** Simulation and state diff are edge-case heavy (RPC config names, pre/post account parsing, token vs SOL deltas, closed/created accounts, inner-instruction index mapping, error mapping), but the scope is clear. The user sets the effort manually.

## Completed and verified
### M0
- Official Solana `kit/nextjs` template scaffolded (create-solana-dapp 4.8.5); npm; demo code removed; minimal SignSafe page with fixed "Devnet" label.
- `.gitignore`/`.gitattributes` verified; `.env.example`; scripts `check`, `check:env`, `scan:secrets` (working) and stubs `setup:demo`, `scenarios:check`, `fixtures:save`.
- git `main` -> https://github.com/DivyanshuKirpal/signsafe.git (public).

### M1 (decode)
- `LICENSE`: our MIT notice plus the template's MIT notice verbatim (checked against upstream).
- `app/lib/config.ts`: limits (`maxInputChars` 12,000, `maxTransactionBytes` 4,096, memo cap 300, ...), `U64_MAX`.
- `app/lib/solana/programs.ts`: known-program registry (System, SPL Token, Token-2022, ATA, Compute Budget, 3 memo programs, Address Lookup Table).
- `app/lib/solana/format.ts`: integer-math amount formatting, `shortAddress`. `app/lib/util/bigint-json.ts`.
- `app/lib/solana/decode.ts`: input validation -> wire decode (legacy, v0, v1 via Kit 8.6) -> account list with signer/writable flags and lookup-table addresses -> top-level instructions, durable nonce, compute budget (instructions or v1 config), structured warnings. Lookup tables via an injected `fetchLookupTables` (mock in tests; RPC wiring is M2).
- `app/lib/solana/instructions.ts`: parses one instruction with the official program clients; failures -> `action: "unknown"` + `parseError`; memo text sanitised and capped. Reusable for inner instructions in M2.
- `app/lib/solana/describe.ts`: one plain-English sentence per instruction.
- `app/api/analyze/route.ts`: `POST /api/analyze` (Node runtime), zod body validation, size caps, plain error codes, no stack traces, logs only an input hash. Returns `{ requestId, cluster, decoded, timingsMs }`.
- UI (`app/components/checker.tsx`, `tx-input.tsx`, `tx-overview.tsx`, `instruction-list.tsx`, `address.tsx`): paste box, overview, decoded instruction list; says "Decoded only ... no risk verdict" until M3.
- **Demonstrated:** an S1-like 0.01 SOL payment decodes as `System Program:transferSol` "Send 0.01 SOL from 9xQe...VFin to 4Nd1...DB4T."; an S2-like approval decodes as `SPL Token:approve` with amount 18446744073709551615 "Allow HN7c...YWrH to spend UNLIMITED (u64 max) from token account 2wmV...dri9." Verified offline (tests, all three versions) and live against the dev server.
- `docs/LEARNING_NOTES.md`: lamports, transactions/signers, versions, program clients, accounts and owners, token accounts/ATAs, delegate/approve, authorities, lookup tables, compute budget, durable nonces, memos.

## Test and check status (end of M1)
- `npm run check`: pass (typecheck clean, lint clean, **58/58 tests** in 5 files: `scripts`, `format`, `decode` (29), `analyze-route` (8), `instruction-list` (jsdom, 3)).
- `npm run build`: pass (`/` static, `/api/analyze` dynamic).
- Dev server: `GET /` 200; `POST /api/analyze` 200 for both samples, 400 `INVALID_BASE64` for bad input; no warnings in the server log.
- `npm run scan:secrets`: clean.
- `npm run check:env`: ok. `.env.local` found; all 8 variables present; devnet-URL and `NEXT_PUBLIC_` safety checks pass (values never printed).

## Partially implemented work
- None. M2 has not started.

## Next three steps (once M2 is approved)
1. `app/lib/solana/rpc.ts`: Kit RPC client for `SOLANA_RPC_URL` with 10 s timeouts, one retry, fallback to `SOLANA_RPC_FALLBACK_URL`; wire `fetchLookupTables` into `/api/analyze`.
2. `app/lib/solana/simulate.ts`: watch list (fee payer, signers, writable, token mints; cap 40), `getMultipleAccounts` (jsonParsed) pre-state, `simulateTransaction` (sigVerify false, replaceRecentBlockhash true, innerInstructions true, accounts jsonParsed), error mapping to plain messages, logs capped; inner instructions decoded with `parseInstruction`.
3. `app/lib/solana/state-diff.ts` (pure, unit-tested): SOL, token, delegate, token owner, close authority, program owner, closed/created; then a StateChanges table in the UI. Plain `Approve`/`Transfer` amounts get decimals from the fetched token accounts/mints.

## Known issues
- v0 transactions that use lookup tables show placeholders and a warning until M2 wires the RPC fetcher.
- Plain `Approve`/`Transfer` amounts are shown as raw units until M2 fetches mint decimals (u64 max always shows UNLIMITED).
- Windows `git` prints "LF will be replaced by CRLF" warnings. Harmless.
- npm 11 skipped `esbuild`'s postinstall script; `tsx` works.
- `npm audit` reports 8 moderate advisories in template dependencies; no major upgrades mid-hackathon without asking.
- On Windows, stopping a background `next dev` leaves a child process on the port; stop it by port (see M0/M1 session).

## Environment variables (names only; values live in `.env.local`, which the user creates)
- Server-only: `SOLANA_RPC_URL` (required), `SOLANA_RPC_FALLBACK_URL`, `GEMINI_API_KEY` (required unless `AI_ENABLED=false`), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_ENABLED`.
- Public: `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_RPC_URL`.

## How to run and verify
- `npm install`
- `.env.local` from `.env.example` (the user fills values; never print the file). `npm run check:env` reports present/missing only.
- `npm run dev` -> http://localhost:3000 (background or second terminal). Paste the output of `npm run samples:print` into the box and click Check.
- `npm run check` before commits; `npm run build`; `npm run scan:secrets` before every push.

## Unpushed local commits
- None (the M1 checkpoint commit is pushed; verify with `git status -sb`).

## Decisions awaiting the user
- Approval to start M2 (recommended effort: high).
- Read the MLH Challenges rules (video length, required fields) when convenient.

## Decided by the user
- 6 Nov: scaffold via sibling folder; npm; demo funding option A (user sends about 1 devnet SOL from Phantom in M4); MIT license.
- 7 Nov: schedule above; MLH Challenges is the submission platform; personal targets 7:30 PM / 9:15 PM IST.
