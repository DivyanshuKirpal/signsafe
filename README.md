# SignSafe

SignSafe shows what a Solana transaction will actually do before you sign it, and warns you in plain English when it looks like a wallet drainer.

Built for the MLH Solana Hackathon (6-8 November 2026), AI Track.

> Work in progress. This README is filled in as features land.

## How it works

```
Decode -> Simulate (devnet) -> State diff -> Risk rules -> Verdict -> AI explanation
```

Fixed, unit-tested rules decide the risk level. The AI model only explains the result and cannot change it. If the AI is unavailable, a built-in explanation is used.

### What works so far

- **Decoding:** paste a base64 transaction (signed or unsigned; legacy, v0 or v1). SignSafe lists the fee payer, signers, compute budget, durable-nonce use and every instruction with a plain-English sentence, for example "Send 0.01 SOL from 9xQe...VFin to 4Nd1...DB4T." or "Allow HN7c...YWrH to spend UNLIMITED (u64 max) from token account 2wmV...dri9." Known programs (System, SPL Token, Token-2022, Associated Token Account, Compute Budget, Memo, Address Lookup Table) are decoded with the official program clients; anything else is labelled "Unknown program". Memo text is treated as untrusted.
- **Simulation on devnet:** the transaction is simulated with `simulateTransaction` (nothing is signed or sent), and the before/after state of the fee payer, signers, written accounts and related token mints is compared: SOL balances (the network fee is identified), token balances, delegate and allowance, token-account owner, close authority, owning program, and created or closed accounts. An approval shows up as a delegate change even though no tokens move. Calls between programs (inner instructions) and program logs are listed. Lookup tables are loaded over RPC. Anything that could not be checked (unloaded tables, a failed simulation, accounts left out of the comparison) is listed separately.
- **Risk rules and verdict:** fixed, unit-tested rules decide the verdict: Danger: don't sign unless you're certain / Could not fully check / Caution: check the details / No known risks found (in that order of precedence). Rules cover token approvals (from instructions and from the account state, merged into one flag per token account), changes of token-account owner or close authority, wallets assigned to a program, large outflows from signers, token accounts closed to someone else, unknown programs, durable nonces, high priority fees, failed or incomplete simulations, and memos (never used for decisions). Permission checks use the token account's owner and balance before the transaction, not "the user", so a drainer cannot hide by paying the fee or co-signing. When that state cannot be read, the instruction's own claim about the owner is treated as unverified and the verdict says "Could not fully check" (unless something verified is already Danger). Each flag lists the instruction or account change that triggered it. The optional "your address" field only marks your address with "(you)"; it never changes the verdict.
- **Demo scenarios:** eight buttons (S1-S8) build real, unsigned devnet transactions for a demo wallet and run them through exactly the same check as a pasted transaction. Each button shows what a website would claim ("Send 0.01 SOL to claim a reward"); what the transaction really does and the expected verdict are shown only after SignSafe's verdict. They cover a normal payment, an unlimited approval, a payment with a hidden approval, a token-account takeover, a wallet assigned to another program, a 95% SOL drain, an unknown program, and a memo that tries to tell the AI the transaction is fine (it stays Danger).
- **Plain-English explanation:** after the verdict is final, Gemini (server-side REST, key in a header) explains it for a wallet user. It receives only a description of the findings, never the raw transaction; memo text and program logs are passed as clearly marked untrusted data. Its answer is checked before it is shown: valid JSON in a fixed shape, no "safe" or "guaranteed", advice that matches the verdict, only amounts and addresses from the findings, no "tokens moving" when the findings show only a permission to move them later, and a clear statement when part of the check is missing. Anything else is replaced by SignSafe's built-in explanation. The page labels which one you see ("AI explanation" with the model version, or "Built-in explanation" with the reason). With `AI_ENABLED=false`, no AI is called.
- Results are cached for 10 minutes ("Check again" re-runs everything); accepted AI explanations are reused only for identical findings. `/api/analyze` allows 10 fresh checks per minute per IP.

### Demo setup (devnet only)

```
npm run setup:demo        # creates keys/ (git-ignored) and the DEMO token; stops and asks for devnet SOL if needed
npm run scenarios:check   # runs all eight scenarios and fails on any verdict mismatch
```

`setup:demo` is safe to run again: it reuses the keys and the mint and only mints or funds what is missing. If the demo authority has less than 0.3 devnet SOL it prints its address and stops; send it about 1 devnet SOL (for example from Phantom on Solana Devnet) and run it again. Only `data/demo.devnet.json` (public addresses) is committed.

## Setup

Requirements: Node.js 24 or newer, npm.

```
npm install
copy .env.example .env.local     # then fill in your own values in .env.local
npm run check:env                # reports present / missing only, never values
npm run dev                      # http://localhost:3000
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `npm run build` | Next.js dev server / production build |
| `npm run check` | typecheck + lint + unit tests |
| `npm run check:env` | reports which config variables are present or missing |
| `npm run scan:secrets` | scans tracked and staged files for real key patterns |
| `npm run setup:demo` | creates or reuses the devnet demo accounts and DEMO token (safe to rerun) |
| `npm run scenarios:check` | runs every demo scenario on devnet and exits 1 on a verdict mismatch (`-- --record` saves fixtures; `-- --ai` also runs the live Gemini explanation step, which uses free-tier quota) |
| `npm run fixtures:save` | (planned) saves scenario results for offline replay |
| `npm run samples:print` | prints two example transactions (a normal payment and an unlimited token approval) to paste into the app |
| `npm run live:check` | runs the decode + simulate pipeline against devnet with existing public devnet accounts and checks the results (`-- --record` saves the RPC traffic as test fixtures) |

## Security notes

- Devnet only. Anything that sends a transaction runs on devnet.
- The app never asks for a seed phrase or private key.
- API keys stay on the server and are read from `.env.local`, which is git-ignored.
- The AI never decides anything: the rules set the verdict first, and text inside a transaction (memos, logs) cannot change it. A memo that tells the AI to call the transaction safe (scenario S8) stays Danger.
- Privacy: only public devnet facts are sent to Gemini. On Google's free plan, inputs may be used to improve Google's products; that is acceptable for public devnet data, but keep it in mind before pointing SignSafe at anything private.

## Credits

- Scaffolded from the official Solana `kit/nextjs` template (solana-foundation/templates, via `create-solana-dapp`), MIT licensed; its copyright and permission notice are included in `LICENSE`. The template's demo pages were removed.
- Libraries: Next.js, React, Tailwind CSS, `@solana/kit`, `@solana-program/*` clients, zod, vitest, tsx.
- Built with help from Claude Code.

## License

MIT. See `LICENSE`, which also contains the license of the Solana template this project started from.
