# CLAUDE.md: SignSafe (MLH Solana Hackathon, 6-8 Nov 2026)

SignSafe (working name; confirm or rename in Milestone 0) checks a Solana transaction before the user signs it:
1. decodes the instructions
2. simulates the transaction on devnet and compares account state before and after
3. flags risky patterns with fixed rules that decide the risk level
4. has an AI model explain the result in plain English

Target: the AI Track (Top 3 Overall entry is automatic).

`ARCHITECTURE.md` holds the full design: flows, pipeline, rules, scenarios, milestones, risks with options. This file covers how to work.
- Read `ARCHITECTURE.md` in full in the first session.
- Re-read the relevant section before starting each milestone.

## 1. Hard rules (non-negotiable; everything else is a default you can adapt)
1. **Hackathon timing.**
   - Write no project code and run no scaffolding until the user confirms hacking has officially started. Before that, only environment checks and reading docs are fine. These docs were written before the start; plans are allowed, code is not.
   - Stop development at the final deadline shown on the Devpost countdown. Nothing is committed or pushed after it.
2. **Originality.**
   - Never reuse code from the user's earlier projects.
   - Open-source libraries and the official Solana template are allowed. Credit them in the README.
3. **Secrets.**
   - API keys live only in `.env.local`. Never print, log, echo or commit their values.
   - Never put a secret in a `NEXT_PUBLIC_` variable; those reach the browser.
   - When checking configuration, report present or missing only.
   - The user pastes key values into `.env.local` himself. Never ask him to paste keys into the chat.
4. **Wallets.**
   - Never ask for, read or handle the user's Phantom seed phrase or private key, and the app never asks for them either.
   - Anything that sends a transaction runs on devnet only.
   - Demo keypairs live in `keys/` (git-ignored) and are devnet-only.
5. **Git safety.**
   - Never force-push and never rewrite pushed history without the user's explicit approval.
   - Run the secret scan before every push.
6. **Honesty.**
   - The UI never calls a transaction "safe" or "guaranteed". Use "No known risks found".
   - The README and Devpost text credit the template, the libraries and AI assistance ("built with help from Claude Code").

## 2. The user and the machine
- **User:** Divyanshu Kirpal (GitHub `DivyanshuKirpal`), third-year B.E. CSE student. He's working solo.
  - Comfortable with JavaScript, React, Node/Express, Java, Python, SQL, MongoDB and Git.
  - New to Solana, `@solana/kit` and Next.js App Router internals.
- **Judging:** he must be able to explain every part of this project to judges and in interviews. Only build what you can explain to him in a few sentences.
- **Machine:**
  - Windows; VS Code's integrated terminal (PowerShell); Node 22 (check with `node -v`); Git installed.
  - Project root: `C:\Users\divya\Downloads\sem_5_project_work\hackathons\solana`.
  - Use cross-platform Node/TypeScript scripts (run with `tsx`), not bash.
  - Start long-running processes like `npm run dev` in the background, or ask the user to run them in a second terminal, so they don't block the session.
- **Already set up (5 Nov):**
  - Phantom in Testnet Mode on Solana Devnet with 10 devnet SOL.
  - A Helius free key, tested on devnet.
  - A Gemini key: `gemini-3.5-flash` works, `gemini-2.5-flash` returned 404, `gemini-flash-latest` returned 503 once.
- **Skills:** `solana-dev-skill` should be installed; check by typing `/`. If it's missing, tell the user and use the official docs.

## 3. How to work
**Default: checkpoint mode.**
- Build in small, verifiable steps: one function, component or route at a time.
- After each step, report in at most 6 lines:
  - what changed (files)
  - why, in plain English
  - how you verified it (command and result)
  - what comes next
- Run typecheck, lint and tests yourself. Ask the user only for checks that need him: the browser, Phantom popups, how something looks.
- Carry on to the next step within the currently approved milestone unless a decision is needed, a check fails twice, or the user asked to review.
- At the end of every milestone, run the checkpoint procedure in section 6, report what was completed and verified, recommend High, xhigh or Max effort for the next milestone with a brief reason, then STOP and wait for the user's explicit approval before starting the next milestone. The user changes the effort setting manually; do not change it yourself.
- Record the milestone approval status and next recommended effort in `docs/PROGRESS.md`. A new session must respect a pending milestone approval and must not begin the next milestone without it.

**Other modes the user can ask for:**
- **"step mode":** stop after every function, explain it and wait for his go-ahead.
- **"speed mode":** batch related steps, still run checks, and summarise at the end of each milestone.

**Explaining:**
- Keep it short, technical and factual, with no filler.
- When a Solana concept first comes up (lamports, accounts and owners, token accounts and ATAs, delegate and approve, authorities, simulation, lookup tables, compute units, durable nonces), add 2-4 lines to `docs/LEARNING_NOTES.md` with an example from this project.

## 4. Decisions and questions
**Ask the user when:**
- a choice changes scope, timeline, security, cost or anything public (repo visibility, deployment, license)
- something involves keys, wallets or funds
- two honest attempts at a fix have failed
- `ARCHITECTURE.md` conflicts with reality and the conflict affects the demo

**How to ask:**
- One line of context.
- Two to four options with their trade-offs (time, risk, demo value).
- Your recommendation.
- Keep working on anything independent while you wait; don't sit blocked.

**Small reversible choices:** decide yourself and log them in `docs/DECISIONS.md` (time, choice, reason, alternatives).

## 5. When reality differs from the plan
- `ARCHITECTURE.md` describes intent and behaviour, not exact library calls.
- Check the installed versions and type definitions, the official docs and the skill before using any API name from the plan.
- Keep the intent, adapt the implementation and log the change.
- Prefer the template's existing patterns and versions. Do not upgrade major versions mid-hackathon without asking.
- `ARCHITECTURE.md` section 15 lists likely failures with several ways to respond to each. Choose based on the situation; don't force one fixed path.

## 6. Saving work: git and GitHub
**Goal:** never lose more than about 30-45 minutes of work, and GitHub always has the latest state before any session can end.

**Setup (Milestone 0, after the start is confirmed):**
- Before the first `git add`:
  - Create `.gitignore` covering `node_modules`, `.next`, `.env*` (but keep `!.env.example`), `keys/`, `*.log`, `coverage`, `.vercel`.
  - Create `.gitattributes` with `* text=auto`.
  - Verify with `git check-ignore -v .env.local keys/demo-victim.json`.
- `git init -b main` if the repo doesn't exist yet. The first commit includes `CLAUDE.md` and `ARCHITECTURE.md`.
- **Remote:**
  - If `gh auth status` shows a logged-in GitHub CLI, offer `gh repo create DivyanshuKirpal/<repo-name> --source . --remote origin --push` with `--public` or `--private`, as the user chooses (Devpost needs it public by submission time).
  - Otherwise, ask the user to create an empty repo on github.com (no README, license or .gitignore) and give you its URL. Then run `git remote add origin <url>` and `git push -u origin main`.
- **Authentication:** Git Credential Manager may open a browser window, or the user may use a personal access token. Never print or store tokens. If authentication fails, explain the options and let him sign in.

**When to commit, and always push right after:**
- after each verified step that leaves the app working (checks pass, the dev server starts)
- at the end of every milestone
- at least every 30 minutes of active work, even mid-feature. Use a `wip:` prefix and note what's broken in `PROGRESS.md`; a broken commit is better than lost work.
- before anything risky: dependency changes, big refactors, deleting files, anything touching git history
- immediately when the user says stop, pause, break, sleep, checkpoint, wrap up, or anything that sounds like leaving
- immediately when the session may be ending: a long session, context getting full or compacting, usage-limit warnings, or the user mentioning time limits
- before the final deadline, then freeze

**Checkpoint procedure:**
1. Update `docs/PROGRESS.md`.
2. Run `npm run check` (skip it only for a `wip:` commit, and say so).
3. Run `npm run scan:secrets`.
4. Review `git status`.
5. Commit with a clear message: `feat:`, `fix:`, `docs:`, `test:`, `chore:` or `wip:` plus a short summary.
6. Run `git push`.
7. Give the user a 3-line handoff: done, in progress, next.

**If a push fails** (offline or auth):
- Keep the local commit and tell the user.
- Retry at the next checkpoint. A failed push never blocks coding.

**If the secret scan finds something:** stop and tell the user before pushing. A key that was already pushed must be rotated (`ARCHITECTURE.md` R11).

## 7. Session routines
**Start of every session:**
1. Read `docs/PROGRESS.md` and `docs/DECISIONS.md`.
2. Run `git log --oneline -15` and `git status`.
3. Run `npm run check`.
4. Summarise where things stand in 8 lines or fewer.
5. Confirm the next step with the user.
6. Continue.

**The first session also:**
- reads `ARCHITECTURE.md` in full
- confirms the official start time and the Devpost deadline with the user, and writes both into `docs/PROGRESS.md`
- plans scaffolding around this folder not being empty (`ARCHITECTURE.md` R2)

**End of a session or before a break:** run the checkpoint procedure.

**`docs/PROGRESS.md` always contains:**
- the confirmed deadline
- the current milestone
- what's done, what's in progress and the next three steps
- known issues
- how to run the app
- open questions for the user

## 8. Commands
Create any npm scripts that are missing, keeping the template's names where they exist:
- `dev`, `build`
- `lint`
- `typecheck` (`tsc --noEmit`)
- `test` (vitest run)
- `check` (typecheck + lint + test)
- `check:env` (present or missing only)
- `setup:demo`
- `scenarios:check`
- `fixtures:save`
- `scan:secrets`: scans tracked and staged files for real key patterns. Placeholders like `REPLACE_ME` and the rule text in these docs are not findings. Look for:
  - Google keys: `AIza` followed by 35 key characters
  - `api-key=` followed by a UUID-like value
  - JSON arrays of 64 numbers (private keys)
  - `-----BEGIN`

## 9. Code defaults (adapt with a reason)
- **Types:** TypeScript strict. No `any` without a comment saying why.
- **Numbers:** BigInt for lamports and token amounts. Convert to strings for JSON, because `JSON.stringify` cannot serialise BigInt. Format amounts with integer math.
- **External calls** (RPC and Gemini) have timeouts and retries. Errors reach the UI as plain messages, never stack traces.
- **Rules engine:** pure (no network) and unit-tested. The AI never sets the verdict.
- **Untrusted text:** pasted input and on-chain text (memos, logs, names) are untrusted. Validate them, cap their length and render them as plain text. Never use `dangerouslySetInnerHTML`.
- **Route handlers:** use the Node.js runtime. Secrets stay server-side.
- **Accessibility:** colour always comes with a text label. Everything works with the keyboard and down to 375 px wide.
- **Writing:** no emojis in code comments, the README, docs or UI text. Write the README and Devpost text plainly, the way a person would.

## 10. Docs to keep updated
`docs/` holds `PROGRESS.md`, `DECISIONS.md`, `LEARNING_NOTES.md`, `DEMO_SCRIPT.md` and `DEVPOST.md`. Also keep `README.md` current. Outlines are in `ARCHITECTURE.md` section 16.

## 11. Final submission checklist (from about 6 PM IST Sunday)
- All Must items in `ARCHITECTURE.md` work end to end.
- `scenarios:check` passes, or the mismatches are explained.
- `npm run check` and `npm run build` pass.
- README is complete, including setup, limitations and credits.
- `.env.example` is up to date and `scan:secrets` is clean.
- The repo is public and pushed. Give the user the repo URL for Devpost.
- `DEMO_SCRIPT.md` is ready. Remind the user to keep `.env.local` and the dashboards off screen while recording.
- `DEVPOST.md` text is ready to paste.
- Remind the user to submit the first version by about 7:30 PM IST (or the Devpost countdown time), select the AI Track, and add the video link.
- After the final deadline: no more commits or pushes.
