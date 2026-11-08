# Security review before the public Vercel deployment

- **When:** Sun 8 Nov 2026, about 05:30 IST.
- **What:** commit `d44ac77` on `main`, plus one uncommitted change in `next.config.ts` (see I5).
- **Who:** Claude Code, at the user's request. Review only: no code was changed, nothing was committed, no build was run, and no server was started.

## Scope and method

The user asked me to check eight areas:
- secrets reaching the browser, including `NEXT_PUBLIC_` variables
- anything that reads, logs or returns `.env.local` values
- any path that can send to mainnet
- untrusted text rendered as HTML
- prompt injection into Gemini
- any way the AI output can change the verdict
- input limits on every API route
- rate limits on every API route, including on serverless instances

How the checks were done:
- **Code reading.** Every API route (`app/api/*`) and the server modules they use, every browser component, the scripts that read `.env.local`, and the Next.js config.
- **Searches.** Environment access, HTML sinks, links, transaction-sending calls, wallet packages, and regexes with nested quantifiers.
- **Two offline measurements.** These were scratch scripts outside the repo, with the RPC stubbed and no AI call. One measured the size of the Gemini prompt; the other measured lookup-table fetches per request.
- **`npm audit`.** This only reads.

Severity scale:
- **High:** likely to expose a secret, risk funds or run attacker script on the public site.
- **Medium:** an anonymous visitor can degrade the service for everyone, or a safety guarantee has a gap that a likely misconfiguration would trigger.
- **Low:** limited impact, unusual conditions, or defence in depth.
- **Info:** no risk today; hygiene or wording.

## Summary

No Critical or High findings. Specifically:
- No secret reaches the browser or an API response.
- Nothing renders untrusted text as HTML.
- The deployed app has no code path that sends a transaction.
- The AI cannot change the verdict.

The main risks for a public deployment are about **availability**. An anonymous visitor can use up the Gemini free tier (20 requests per day) or the RPC capacity for everyone. Small transactions can be crafted to make one request very expensive.

| ID | Severity | Finding | Main location |
|---|---|---|---|
| M1 | Medium | Anyone can use up the day's Gemini quota in about two minutes; rate limits are per serverless instance | `app/api/analyze/route.ts:139-153`, `app/lib/server-state.ts:15-17` |
| M2 | Medium | Prompt size is unbounded: a 3 KB transaction produced a 453,288-character prompt | `app/lib/ai/facts.ts:161-171,180` |
| M3 | Medium | One request can make the server fetch about 100 lookup tables (one RPC call each) | `app/lib/solana/decode.ts:196-198`, `app/lib/solana/rpc.ts:153-163` |
| M4 | Medium | `POST /api/scenarios` has no rate limit, and every call spends RPC requests | `app/api/scenarios/route.ts:43-70` |
| M5 | Medium | The devnet check never checks the fallback RPC endpoint, which failover (and the setup script's send) can reach | `app/lib/solana/rpc.ts:131-146`, `scripts/setup-demo.ts:128-133` |
| L1 | Low | Signed transactions are forwarded to the RPC provider with their signatures | `app/lib/solana/simulate.ts:163-172` |
| L2 | Low | Request bodies are read in full before the size check | `app/api/analyze/route.ts:108-115`, `app/api/scenarios/route.ts:44-45` |
| L3 | Low | Program logs and decoded text arguments keep control and text-direction characters | `app/lib/solana/simulate.ts:74-80`, `app/lib/solana/instructions.ts:139` |
| L4 | Low | Prompt injection: residual risk in the explanation's wording (never the verdict) | `app/lib/ai/facts.ts:154-157,181-185` |
| L5 | Low | Cross-site "simple" POSTs are accepted (any content type) | `app/api/analyze/route.ts:112-122` |
| L6 | Low | No security headers (framing, nosniff, CSP); `X-Powered-By` is sent | `next.config.ts:3-17` |
| L7 | Low | RPC work is not bounded by the route deadline | `app/lib/solana/rpc.ts:28`, `app/lib/analyze.ts:141` |
| L8 | Low | Rate-limit key trusts `x-forwarded-for` off Vercel; IPv6 clients can rotate addresses | `app/lib/util/rate-limit.ts:46-49` |
| L9 | Low | Deployment hygiene: no `.vercelignore`, environment variable scope, key restrictions | repository root, Vercel settings |
| I1 | Info | `NEXT_PUBLIC_RPC_URL` and `NEXT_PUBLIC_SOLANA_CLUSTER` are defined but never used | `.env.example:13-14` |
| I2 | Info | `POST /api/scenarios` builds drain-style transactions for any `owner` address | `app/api/scenarios/route.ts:36-40` |
| I3 | Info | Expected verdicts are hidden only by the page, not by the API | `app/api/scenarios/route.ts:21-28` |
| I4 | Info | The model version from Gemini is shown without a length cap | `app/lib/ai/gemini.ts:115`, `app/lib/ai/explain.ts:121` |
| I5 | Info | Uncommitted `allowedDevOrigins` in `next.config.ts` (development only) | `next.config.ts:4` |
| I6 | Info | `npm audit`: 0 advisories in production dependencies | `package.json` |

## Resolved (Sun 8 Nov 2026, fix step before M7)

These were fixed in the step after this review, before any deploy. The commit is in `docs/PROGRESS.md`.

**Verification:**
- 325 offline tests pass, and each main fix was mutation-checked: removing the fix makes its tests fail.
- `scenarios:check` (live devnet, AI off): 8/8.
- All 8 saved results match a live re-check of the same transactions.
- A local production server sent the new headers and answered text/plain with 415.

| ID | Status | What changed |
|---|---|---|
| M1 | Fixed, per instance | Each server instance makes at most 20 Gemini requests per 24 hours, counting every HTTP attempt including retries. After that it shows the built-in explanation with "This server has used its AI explanations for now" (`app/lib/ai/explain.ts`, `gemini.ts`, `config.ts`). No new service, so instances do not share the budget, and one visitor can still use up an instance's budget. The README says so. |
| M2 | Fixed | Refused at decode, before any RPC or AI work (`decode.ts`, `parseWireTransaction`): more than 64 instructions (`TOO_MANY_INSTRUCTIONS`), and legacy or v0 transactions over 1,232 bytes (`TOO_LARGE`). The facts are capped at 20 instructions plus a count, 5 "based on" lines per finding and 10 could-not-check items. Prompts over 16,000 characters are not sent (`AI_TOO_LARGE`). The 64-instruction case went from 30,132 to 6,590 characters; the 1,000-instruction case is refused. |
| M3 | Fixed | At most 8 distinct lookup tables, loaded in one `getMultipleAccounts` call with duplicates removed; only accounts owned by the lookup-table program are used (`rpc.ts` `lookupTableFetcher`, `decode.ts`). The 100-table transaction from the review (3,771 bytes) is now refused at decode without fetching anything. |
| M4 | Fixed | `POST /api/scenarios` allows 20 builds per minute per IP in its own bucket, and answers 429 with `Retry-After`. The page shows the countdown. |
| M5 | Fixed | `devnetOnly()` in `rpc.ts`: each endpoint checks its own genesis hash before its first request. An endpoint that is not devnet is skipped and never receives a request; if none passes, the request fails and `ensureDevnet` returns false. This covers the app and every script built on `createSignSafeRpc`, including the `sendTransaction` in `setup:demo`. |
| L1 | Fixed | `withoutSignatures()` replaces every signature with zeros before `simulateTransaction`. Unsigned transactions are sent byte for byte as before. |
| L5 | Fixed | Both POST routes answer 415 unless the content type is `application/json`. |
| L6 | Partly fixed | `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` are sent on every response (`next.config.ts`). Not done in this step: `Referrer-Policy`, `Permissions-Policy`, `poweredByHeader: false` (`X-Powered-By` is still sent), and a full script CSP. |
| I5 | Resolved | The user removed `allowedDevOrigins`. The only other leftover was a missing final newline, so the file was restored to the committed version before the headers were added. |

**Still open:**
- L2, L3, L4, L7 and L8.
- L9, which is settings to apply when deploying.
- I1 to I4 and I6.

**When deploying:** set `SOLANA_RPC_FALLBACK_URL=https://api.devnet.solana.com` exactly. A wrong fallback is now skipped instead of used, but it would leave the primary with no backup.

## Areas checked with no finding

1. **Secrets in the browser.**
   - `process.env` is read only in server modules: `app/lib/solana/rpc.ts:123-126`, `app/lib/ai/explain.ts:130-137` and `app/lib/server-state.ts:29`.
   - Browser components import only constants, formatting helpers and types; the import of `saved-results` is type-only and erased at build.
   - No `NEXT_PUBLIC_` variable is read anywhere in `app/`.
   - Production browser source maps are off (the Next.js default).
2. **Secrets in responses and logs.**
   - Responses name the RPC endpoint only as "primary" or "fallback" (`rpc.ts:31-37`).
   - RPC error text goes through `redactSecrets` (`rpc.ts:39-45`: API-key parameters, Google keys and every URL) before it is logged or returned. This covers `simulate.ts:52-55`, the refusal path at `simulate.ts:185`, the devnet-check log in `analyze.ts`, and `app/api/scenarios/route.ts:67`.
   - The Gemini key goes in the `x-goog-api-key` header (`gemini.ts:151`), never in the URL or the prompt. Gemini failures are logged as HTTP status codes only (`gemini.ts:172-176`).
   - The analyze route logs a 12-character hash of the input, not the transaction.
   - `check:env` prints present, missing, placeholder or default, never a value. No script prints an environment value.
   - The committed saved results (`data/fixtures/*.json`) contain no URL, `helius`, `api-key` or `AIza` string. `scan:secrets` was clean at `d44ac77`.
3. **Mainnet sending from the deployed app.**
   - No API route calls `sendTransaction` or `requestAirdrop`.
   - The app imports no wallet package (`@solana/kit-plugin-wallet` and `@solana/react` are listed but unused).
   - Demo scenario transactions are unsigned and only simulated.
   - The only code that signs and sends is the local `scripts/setup-demo.ts`; see M5 for its gap.
4. **Untrusted text as HTML.**
   - There is no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `<a href>` or `window.open` anywhere in `app/`.
   - Memos, logs, explanation text, decoded arguments and addresses are React text nodes, so they are escaped.
   - The AI answer is cleaned (`validate.ts:53-55`) and rejected if it contains markdown or links.
5. **AI output changing the verdict.**
   - The verdict is computed before the explainer runs (`analyze.ts:130-134`).
   - The explainer receives copied facts (`facts.ts:159-186` builds new objects). A test has an explainer overwrite its input, and the verdict stays Danger (`tests/ai-pipeline.test.ts:38`).
   - An accepted answer is rebuilt from exactly three strings (`validate.ts:252`) and stored only in `explanation` (`explain.ts:121`, `analyze.ts:145`). The AI cannot set its own `source`, `model` or notice.
   - The page draws the verdict card only from `verdict`.
   - The explanation cache key hashes the verdict and every fact, including the untrusted block (`explain.ts:86`), so an explanation is never reused for a different verdict or a different transaction's memo.
6. **Path traversal in replays.** Ids are checked against the fixed scenario list before any file access (`saved-results.ts:104-108`, `app/api/examples/route.ts:23-25`).
7. **Server-side request forgery.**
   - The server contacts only the configured RPC URLs and the fixed Gemini base URL.
   - Model names are pattern-checked (`gemini.ts:131`).
   - Nothing in a request chooses a URL.
8. **Regex denial of service.** No nested quantifiers in the decoder, validator or redaction regexes, and their inputs are length-capped.

## Findings

### M1. Anyone can use up the day's Gemini quota in about two minutes; rate limits are per instance (Medium)

**Where:**
- `app/api/analyze/route.ts:139-153`: a cache hit is free; otherwise one shared per-IP limit applies.
- `app/lib/config.ts:97-103`: 10 fresh analyses per minute per IP.
- `app/lib/ai/explain.ts:95-98`: "Check again" (`fresh: true`) skips the explanation cache.
- `app/lib/server-state.ts:15-17,28-31`: the limiter and both caches are module-level, so each serverless instance has its own.

**What happens:**
- The Gemini free tier allows 20 requests per day for the project. Every fresh analysis whose findings are new makes at least one Gemini request, and up to four attempts on transient errors.
- A visitor can vary one amount per request to get new findings each time. At 10 analyses per minute, one IP uses up the day's quota in about two minutes. "Check again" also re-asks Gemini for identical findings.
- On Vercel, each instance has its own limiter and caches, and a cold start resets them. The effective limit is 10 per minute times the number of instances.
- After that, every visitor sees the built-in explanation until the daily reset at about 13:30 IST. Verdicts are unaffected.

**Suggested fix:**
1. Give the AI its own, smaller budget, separate from the analysis rate limit. For example: 3 AI explanations per IP per hour, plus a daily cap (for example `AI_DAILY_LIMIT=15`) after which the built-in explanation is used with a clear notice.
   - For a cap that holds across instances, keep the counters in a shared store (for example Upstash Redis from the Vercel Marketplace) with an atomic increment.
   - A per-instance counter is weaker but still worthwhile. At hackathon traffic, Vercel usually reuses one warm instance.
2. Let "Check again" redo the simulation and rules but reuse an accepted explanation for identical findings, with the label "reused for the same findings". Offer a separate "Ask the AI again" only if needed.
3. If your Vercel plan includes Firewall rate-limit rules, add one for `/api/analyze`.
4. Keep the saved replays (option D) as the backup for judging.

### M2. Prompt size is unbounded (Medium)

**Where:**
- `app/lib/ai/facts.ts`:
  - lines 161-166: every finding with every "based on" line
  - lines 167-171: every top-level instruction
  - line 180: every could-not-check item
- `app/lib/solana/decode.ts`:
  - no limit on the number of instructions
  - line 326: a legacy or v0 transaction over 1,232 bytes only gets a warning
  - line 164: only the 4,096-byte cap is enforced

**Measured offline** (no RPC, no AI call; the real pipeline with a hand-built legacy transaction):

| Empty System instructions | Transaction | Prompt sent to Gemini |
|---|---|---|
| 64 | 358 bytes | 30,132 characters |
| 300 | 1,067 bytes (under the network's own 1,232-byte limit) | 136,696 characters |
| 1,000 | 3,167 bytes (4,224 base64 characters; the input limit is 12,000) | 453,288 characters (roughly 113,000 tokens) |

Each failing instruction adds three entries: one in `instructions`, one "based on" line in the R-UNRESOLVED finding, and one could-not-check item. Every AI attempt (up to four) sends the whole prompt.

**Impact:**
- It burns the tokens-per-minute quota.
- It slows answers, which leads to timeouts and retries.
- It would cost real money on a paid key.

**Suggested fix:**
1. Cap the facts:
   - the first 20 instructions plus "and N more not listed"
   - at most 5 "based on" lines per finding plus a count
   - at most 10 could-not-check items plus a count
2. Cap the serialized prompt, for example at 16,000 characters. Above it, skip the AI and show the built-in explanation with a notice such as "too large for an AI explanation".
3. Refuse obviously invalid transactions at decode, before any RPC or AI call:
   - more than 64 instructions (Kit itself refuses to build more than 64)
   - legacy or v0 transactions over 1,232 bytes, which the network rejects

### M3. One request can make the server fetch about 100 lookup tables (Medium)

**Where:**
- `app/lib/solana/decode.ts:196-198`: returns every lookup-table address, without de-duplicating or capping.
- `app/lib/solana/decode.ts:368-378`: passes them all to the fetcher.
- `app/lib/solana/rpc.ts:153-163`: fetches each table with its own RPC call, all in parallel.
- `app/lib/solana/rpc.ts:75-102`: each call is retried once on 429, 5xx or timeout, on the fallback endpoint.

**Measured offline** (fetcher stubbed with a counter):
- A Kit-built v0 transaction with 62 tables (2,403 bytes) requested 62 fetches.
- A hand-built v0 transaction with 100 tables (3,771 bytes, 5,028 characters) decoded fine and requested 100 fetches. The 4,096-byte cap allows about 108.

**Impact:**
- At the 10-per-minute limit, one IP can cause about 1,000 RPC calls per minute, or up to 2,000 with retries.
- That exceeds a free Helius plan's per-second limit, and failover then hits the public devnet endpoint, which rate-limits by the server's IP. Every visitor's checks degrade, and the Helius monthly credits drain.

**Suggested fix:**
1. De-duplicate the table addresses.
2. Cap them at about 8 distinct tables; real transactions use 1 to 4. Mark the rest unresolved ("Could not fully check") without fetching.
3. Load all tables in one `getMultipleAccounts` call (up to 100 addresses) and parse them locally, instead of one call per table.
4. Refusing legacy and v0 transactions over 1,232 bytes (M2, step 3) also caps this at about 30.

### M4. `POST /api/scenarios` has no rate limit (Medium)

**Where:**
- `app/api/scenarios/route.ts:43-70`: no limiter.
- `app/lib/scenarios/build.ts:124-125`: `getLatestBlockhash` on every call, plus `getBalance` for S6.

**What happens:** Anyone can call it as fast as they like. Each call spends 1-2 RPC requests on the same Helius key the checks use.

**Suggested fix:**
1. Apply the same limiter with its own bucket, for example 20 per minute per IP.
2. Cache the latest blockhash per instance for about 20-30 seconds, so most builds make no RPC call; a blockhash stays valid for about 60-90 seconds.
3. See I2 for the `owner` parameter.

### M5. The devnet check does not cover the fallback endpoint (Medium)

**Where:**
- `app/lib/solana/rpc.ts:131-146`: `ensureDevnet` runs once per client, through the failover transport.
- `app/lib/solana/rpc.ts:104-120`: requests fail over from primary to fallback.
- `scripts/setup-demo.ts:163-166`: the check.
- `scripts/setup-demo.ts:128-133`: `sendTransaction` through the same failover client.

**What happens:**
- `getGenesisHash` is answered by whichever endpoint responds first, normally the primary. The result is cached per client.
- Later requests that fail over go to `SOLANA_RPC_FALLBACK_URL`, which was never checked.
- If the fallback were set to a mainnet URL by mistake (for example a typo in the Vercel dashboard, where `check:env` does not run):
  - the deployed app would simulate pasted transactions against mainnet while labelling the results "devnet", and would send them there with their signatures (see L1)
  - `setup:demo` could submit its signed setup transactions to mainnet when the primary hiccups

The demo keys hold no mainnet SOL, so those transactions would fail. But this is the one hard rule the genesis check exists to guarantee, and the README says a mainnet URL "can never be used by mistake".

**Suggested fix:**
1. Check the genesis hash of each endpoint separately before its first use. Inside the failover transport, skip any endpoint that has not passed, and fail closed.
2. In `setup:demo`, send only through the verified primary, with no failover for `sendTransaction`.
3. In Vercel, set `SOLANA_RPC_FALLBACK_URL=https://api.devnet.solana.com` exactly.

### L1. Signed transactions are forwarded with their signatures (Low)

**Where:**
- `app/lib/solana/simulate.ts:163-172`: the pasted base64 is sent unchanged to `simulateTransaction` with `sigVerify: false`.
- `app/components/tx-input.tsx:32`: the label invites "signed or unsigned".

**What happens:**
- A signed or partly signed transaction goes unchanged to the devnet RPC provider. It might be a mainnet transaction, or one with a durable nonce, which never expires.
- Whoever runs or compromises that endpoint receives a valid signed transaction and could submit it to the network it belongs to. SignSafe never submits it itself.
- The realistic exposure is small, because SignSafe is used before signing.

**Suggested fix:**
1. Overwrite every signature with 64 zero bytes before simulating. They are not checked anyway (`sigVerify: false`).
2. Say in the README that signatures are removed before simulation.

### L2. Request bodies are read in full before the size check (Low)

**Where:**
- `app/api/analyze/route.ts:108-115`: a `Content-Length` pre-check, then `await request.text()`, then the length check.
- `app/api/scenarios/route.ts:44-45`: no pre-check at all.

**What happens:**
- A chunked request without `Content-Length` is buffered completely before being rejected.
- Vercel caps function request bodies at 4.5 MB, so the impact there is small. On other hosts, memory use per request is unbounded.

**Suggested fix:**
1. Read `request.body` with a byte counter and stop past the limit: 20,000 bytes for analyze, 2,000 for scenarios.
2. Add the `Content-Length` pre-check to `/api/scenarios`.

### L3. Program logs and decoded text arguments keep control and text-direction characters (Low)

**Where:**
- `app/lib/solana/simulate.ts:74-80`: log lines are only capped.
- `app/lib/solana/instructions.ts:139`: string arguments, for example Token-2022 metadata name, symbol or URI, are only capped.
- They are shown at `app/components/simulation-panel.tsx:50-53` and `app/components/instruction-list.tsx:9`. Log lines also go to Gemini (`facts.ts:184`).

**What happens:**
- React renders them as text, so there is no HTML injection.
- But a malicious program's log, or a Token-2022 metadata string, can contain right-to-left overrides that make an address or amount display differently from what it is.
- Memo text is already cleaned (`instructions.ts:197-204`); logs and string arguments are not.

**Suggested fix:**
1. Run `sanitizeUntrustedText` on each log line in `capLogs` and on string arguments in `toArgValue`.
2. Also strip zero-width characters (U+200B to U+200D, U+FEFF) and U+061C in `sanitizeUntrustedText`.

### L4. Prompt injection: residual risk in the explanation's wording (Low)

**Already in place (good):**
- Only memo text (at most 3 memos of 200 characters) and program logs (at most 6 lines of 120 characters) reach Gemini, in a block marked as data (`facts.ts:154-157,181-185`). System instruction rules 5 and 6 cover it (`prompt.ts:16-17`).
- Instruction descriptions are SignSafe's own templates; memo text is replaced by a pointer (`facts.ts:93-95`).
- The answer is checked:
  - amounts and addresses must come from the trusted facts only
  - the advice must match the verdict
  - no "safe", "guaranteed", "verified", "trusted" or "legitimate"
  - every finding must be covered
  - the answer must hedge when the check is incomplete

  If any check fails, the built-in text is shown.
- The model has no tools, and no secrets in its context.

**Residual risk:** An injected memo or log line can still steer the wording within those checks. For example, it could get the model to call the delegate "the official exchange" or "audited", or to stress the harmless part. The verdict card is unaffected.

**Suggested fix (optional):**
1. Stop sending program logs to the model. They add little to a short wallet-user explanation, and a custom program can write anything into them.
2. Reject "official", "audited", "reputable" and "partner" in the validator.
3. Add an S8-style test that injects through a program log.
4. When memos or logs are present, show "This transaction contains text written by its sender" next to the explanation.

### L5. Cross-site "simple" POSTs are accepted (Low)

**Where:**
- `app/api/analyze/route.ts:112-122`: the body is parsed as JSON whatever the content type.
- `app/api/scenarios/route.ts:44-48`: the same.

**What happens:**
- A page on another site can make its visitors' browsers send `POST /api/analyze` as `text/plain`, which skips the CORS preflight.
- It cannot read the answer, because no CORS headers are sent. But each visitor spends SignSafe's RPC and Gemini quota from their own IP, which sidesteps the per-IP limit.

**Suggested fix:**
1. Return 415 unless `Content-Type` is `application/json`. That forces a preflight, which fails cross-origin.
2. Optionally reject requests whose `Sec-Fetch-Site` header is `cross-site`.

### L6. No security headers (Low)

**Where:** `next.config.ts:3-17` has no `headers()`, and there is no middleware.

**What happens:**
- Another site can frame SignSafe and draw its own UI over a real verdict.
- Responses lack `X-Content-Type-Options`, `Referrer-Policy` and a Content Security Policy.
- `X-Powered-By: Next.js` is sent.
- React escaping already prevents script injection (no HTML sinks were found), so this is defence in depth.

**Suggested fix:**
1. Add `async headers()` returning, for `/(.*)`:
   - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'` (these directives do not affect Next.js's inline scripts)
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: no-referrer`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
2. Set `poweredByHeader: false`.

A full script CSP would need nonces, because next-themes injects an inline script. Leave that for later.

### L7. RPC work is not bounded by the route deadline (Low)

**Where:**
- `app/lib/solana/rpc.ts:28`: 10 seconds per attempt, two attempts per call.
- `app/lib/analyze.ts:141`: the deadline is passed only to the explainer.

**What happens:**
- With a slow RPC, the sequential calls (lookup tables, pre-state, simulation) can run past the 35-second budget and the 40-second `maxDuration`.
- Vercel then ends the function with a generic error (nothing is exposed), and the AI step gets no time. This affects availability only.

**Suggested fix:**
1. Pass an `AbortSignal` derived from the route deadline to every RPC call; Kit supports `.send({ abortSignal })`.
2. Skip the AI when less than about 5 seconds remain.

### L8. Rate-limit client key (Low)

**Where:** `app/lib/util/rate-limit.ts:46-49`. The first `x-forwarded-for` entry is used, then `x-real-ip`, then one shared "local" bucket.

**What happens:**
- Off Vercel, for example `npm start` on a VM without a proxy, `x-forwarded-for` is whatever the client sends, so the limit can be bypassed by changing it on every request.
- On Vercel, the platform sets this header itself; Vercel documents that it overwrites it to prevent spoofing. Confirm this on the deployment.
- IPv6 clients can rotate through the many addresses of their /64.

**Suggested fix:**
1. On Vercel, key on the platform header (`x-real-ip` or `x-vercel-forwarded-for`).
2. Key IPv6 clients by their /64 prefix.
3. Note in the README that self-hosting needs a proxy that sets the header.

### L9. Deployment hygiene (Low)

**Where:** the repository root has no `.vercelignore`; `.gitignore:34-38` covers `.env*` and `keys/`. The rest are Vercel settings.

**What happens:**
- Deploying through the Vercel GitHub integration uploads only committed files, so `.env.local` and `keys/` never leave this machine.
- Deploying with the Vercel CLI uploads the working folder. Vercel's CLI skips `.env.local` by default, but I could not confirm that it skips `keys/`, which holds the devnet demo keypairs.
- Those keypairs would not be served (only `public/` is served statically, and no route reads `keys/`), but they would sit in Vercel's copy of the source.

**Suggested fix:**
1. Deploy through the GitHub integration.
2. Add a `.vercelignore` with `keys/`, `.env*` and `!.env.example` anyway.
3. In Vercel:
   - mark `GEMINI_API_KEY` and `SOLANA_RPC_URL` as Sensitive
   - scope them to Production only, so preview deployments of other branches run with AI off and the public RPC
   - keep Deployment Protection on for previews
4. Use a separate Helius key for the public deployment.
5. Restrict the Gemini key in Google Cloud to the Generative Language API.
6. Rotate a key if it ever appears in a log, a screenshot or the demo recording.

### Info

- **I1. Unused `NEXT_PUBLIC_` variables** (`.env.example:13-14`).
  - Nothing in `app/` reads them, so nothing leaks today.
  - If a browser component later read `NEXT_PUBLIC_RPC_URL` while it held a keyed Helius URL, the key would ship in the JavaScript. `check:env` warns about that (`scripts/check-env.ts:54-58`), but it does not run on Vercel.
  - Suggested fix: remove both, or keep only the public devnet URL there.
- **I2. `owner` parameter** (`app/api/scenarios/route.ts:36-40`).
  - It accepts any valid address and returns, for example, an unsigned transaction that would send 95% of that address's devnet SOL to the demo attacker.
  - It uses a devnet blockhash and adds no capability, since anyone can build such a transaction. But the page never uses it, and it looks odd on a public API.
  - Suggested fix: remove it until F3 needs it.
- **I3. Expected verdicts** (`app/api/scenarios/route.ts:21-28`). `GET /api/scenarios?reveal=<id>` returns them to anyone at any time. Only the page waits until after the check. This is not a security issue; describe it as "the page shows them only after the check".
- **I4. Model version** (`gemini.ts:115` to `explain.ts:121`). The model version comes from Google and is rendered as text, without a length cap. Suggested fix: cap it at 64 characters of `[a-z0-9.-]`.
- **I5. Uncommitted `allowedDevOrigins: ["192.168.56.1"]`** (`next.config.ts:4`). This setting affects only `next dev`; it lets a device at that address load the development server. It has no effect on the production build. Commit or revert it deliberately; I did not change it.
- **I6. Dependencies.**
  - `npm audit --omit=dev`: 0 advisories.
  - All dependencies: 8 moderate advisories, all in development-only lint packages (typescript-eslint, eslint-config-next, minimatch).
  - Next.js 16.4.3, React 19.2.8.

## Input limits and rate limits, per API route

| Route | Input limits | Rate limit | Work per request | On serverless |
|---|---|---|---|---|
| `POST /api/analyze` | `Content-Length` over 20,000 rejected; then a full read and a length check (L2). `tx` at most 12,000 characters and 4,096 bytes; `userAddress` must be a valid address; unknown fields ignored. No cap on instructions (M2) or lookup tables (M3). | 10 fresh analyses per minute per IP; cached answers and invalid input are free (`route.ts:139-153`). No separate AI budget (M1). | Several sequential RPC calls, plus one per lookup table, plus up to 4 Gemini attempts. | Limiter and caches per instance, reset on cold start (M1). Vercel caps bodies at 4.5 MB. |
| `POST /api/scenarios` | Full read, then at most 2,000 characters (L2). `id` from the fixed list; `owner` any valid address (I2). | None (M4) | 1-2 RPC calls | Same per-instance concerns once a limiter is added. |
| `GET /api/scenarios` | `reveal` matched against the fixed list | None | A small file read | Fine. |
| `GET /api/examples` | `id` matched against the fixed list before any file access | None | Reads up to 8 small JSON files | Fine; could be cached in memory. |

## Suggested order before deploying

1. **M2 and M3:** cap the facts and the lookup tables, and refuse over-size legacy and v0 transactions and more than 64 instructions before any RPC or AI call. These are small, contained changes in `facts.ts`, `decode.ts` and `rpc.ts`.
2. **M1 and M4:** add a separate AI budget, a limiter on `/api/scenarios`, and let "Check again" reuse an accepted explanation.
3. **M5:** check each endpoint's genesis hash, and set the fallback URL in Vercel to the public devnet endpoint.
4. **L1, L5, L6:** strip signatures before simulating, accept JSON only, and add the security headers.
5. **L9:** Vercel settings (GitHub deploy, Sensitive and Production-only keys, a separate Helius key, a restricted Gemini key).

## Not covered by this review

- No dynamic testing against a running server, no build and no load test (as instructed).
- No review of the Vercel project, the Google Cloud project or the Helius account settings, since nothing has been deployed yet.
- Statements about Vercel platform behaviour (the request-body cap, `x-forwarded-for` handling, CLI ignore rules) come from Vercel's documentation as I know it. Confirm them on the deployment.
- Dependency internals were not audited beyond `npm audit`.
