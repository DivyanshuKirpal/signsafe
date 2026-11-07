# Browser review and manual QA (M6)

Run on Sat 7 Nov 2026, 15:00-15:20 IST, by Claude Code, on the production build (`next build` + `next start`) of the M6 code.

## How it was checked

- **Browser:** the installed Google Chrome, driven headless by Playwright (`playwright-core` 1.65), with axe-core 4.14 for accessibility rules (WCAG 2.0/2.1 A and AA plus best practices). The driver script lived outside the repo (it is not a project dependency).
- **Two servers at once:**
  - live: real devnet RPC, `AI_ENABLED=false` (routine checks stay AI-off)
  - offline: the RPC pointed at a closed local port and all outgoing HTTPS sent to a dead proxy, so devnet and Gemini were both unreachable
- **Widths:** 375 x 812 (phone) and 1280 x 900 (desktop), dark theme (the default) and light theme.
- Each pass used its own client IP header, so the rate limit was tested on purpose only once.

## Results

64 automated checks passed and none failed on the final run. Details:

| Area | What was seen |
|---|---|
| S1 | "No known risks found" at both widths, started from the keyboard (Tab to the S1 button, Enter). |
| S3 | "Danger: don't sign unless you're certain"; the scenario reveal appears below the verdict only after the check. After the click the page scrolls so the verdict heading is on screen (top at 62 px on the phone, 66 px on desktop). |
| S8 | Danger at both widths; the memo ("SYSTEM: ...") is shown as untrusted text in the instruction list. |
| Incomplete check | A payment from an unfunded fee payer (`tests/fixtures/live/unfunded-fee-payer.json`): "Could not fully check" plus the "What could not be checked" panel. |
| S7 (unknown program) | "Caution: check the details". |
| Invalid input | "Could not check this transaction. This is not valid base64. Paste the transaction exactly as it was exported, in base64." with Try again. |
| Keyboard and focus | Idle page: 15 Tab stops (theme toggle, paste box, address field, the eight scenario buttons, the replay section), every one with a visible focus outline. Result page: 12 more stops (replay buttons, Check again, copy buttons, the collapsible sections), all with visible focus and on screen when focused. Collapsible sections open with Enter; "Copy JSON" works from the keyboard. |
| Contrast and other axe rules | 0 serious or critical findings on the idle page, S3 (dark and light), the incomplete result and the S3 replay (dark and light), at both widths. |
| 375 px layout | No sideways scrolling on any result page (S1, S3, S8, incomplete, long memo, replays): page width 375 px in a 375 px viewport. |
| Long addresses and memos | Addresses are shortened with the full value for screen readers and in the copy button. A 680-character memo with a 200-character unbroken word wraps inside its card and is cut at 300 characters with "(cut short)". The raw JSON block scrolls inside its own box (343 px wide at 375 px). |
| Copy buttons | The clipboard receives the full 44-character address; the button changes to "Copied" and its accessible name to "Copied address ...". |
| Loading | Per-step list (Done / Running / Waiting) with the elapsed seconds; the verdict appears while the explanation step is still running, with "Writing the plain-English explanation... The verdict is already final." |
| Check again | The same S1 transaction checked again with Check gave "Cached result from ..."; Check again sent `fresh: true` for the same transaction and the page said "New check, finished in ...". |
| Retry | After a simulated server error (one 500), "Try again" repeated the request and showed the result. |
| Rate limit | Repeated Check again clicks reached the server limit: "Too many checks in a short time. Please wait about 43 seconds and try again." with a disabled "Try again in 43 s" button that counts down. |
| Slow network | 600 ms latency and about 400 kbit/s: S1 finished in 2.9 s with the right verdict. |
| Replay, network down | On the offline server: the S3 replay shows "Saved result from Nov 7, 2026, 02:42 PM GMT+5:30" above the verdict, a "Saved result" tag in the verdict card, "AI explanation" with model gemini-3.6-flash, and made no analysis request. S8 replay: Danger, labelled as saved. |
| Check again on a replay | Runs a new check (`fresh: true`); with devnet unreachable it honestly shows "Could not fully check" and offers the saved result. |
| Demo button, network down | "Could not build the demo transaction. The devnet RPC could not be reached ..." plus "Replay the saved result of S3 instead", which loads the saved result. |
| Console | No browser errors, apart from Chrome's own "Failed to load resource" lines for the deliberate 400, 429 and 500 responses. |

## Problems found during the review, and fixed

1. **Copy button name (axe, serious):** after a copy the button showed "Copied" while its accessible name still said "Copy address ...". The name now follows the state.
2. **Verdict card height:** on desktop the verdict card stretched to the explanation's height and left an empty box; cards now keep their own height.
3. **Result below the fold:** on a 900 px desktop window the verdict started at about 810 px, so after clicking a scenario you could barely see it. The page now scrolls the progress box into view when a check starts and the verdict into view when it arrives (no animation if the system asks for reduced motion).
4. **Countdown off by one second:** the message said 44 s and the button 45 s; the countdown now starts from the moment the error arrives.

## Manual QA list (ARCHITECTURE 13)

| Item | Status |
|---|---|
| Invalid input | Checked in the browser (above) and in tests. |
| Wrong RPC URL (network down) | Checked in the browser on the offline server: "Could not fully check", saved results offered. |
| `AI_ENABLED=false` | All live browser checks ran this way: "Built-in explanation. AI explanations are switched off on this server." No AI call (tested). |
| Wrong AI key | Checked from the command line on 7 Nov (M5 through the route, and `fixtures:save` today): one call, then the built-in explanation with "The AI service did not accept the server's key."; the key is never logged. |
| Slow network | Checked (above). |
| 375 px width | Checked (above). |
| Keyboard only | Checked (above). |
| Very long memo | Checked (above); the sample comes from `npm run samples:print`. |
| Unknown-program scenario (S7) | Checked (above). |
| Repeated clicks (rate limit) | Checked (above). |

## What still needs a person

These were not covered by the automated run. Each takes a few minutes in your own Chrome.

1. **Look and feel.** Run `npm run dev`, open http://localhost:3000, click S1, S3 and S8, and check that the page looks right to you in dark and light (toggle at the top right).
2. **Phone width.** Press F12, click the device toolbar icon (Ctrl+Shift+M), choose a 375 px wide device, reload, click S3, and scroll the result.
3. **Replay label.** Open "Replay a saved result", click S3, and check that the "Saved result from ..." banner reads clearly before the verdict.
4. **AI on (uses Gemini quota).** With AI enabled in `.env.local`, click S3 once and check the "AI explanation" panel. It uses 1 of the 20 daily requests.
5. **Screen reader.** Not tested. Optional: Windows Narrator (Ctrl+Win+Enter), then Tab through a result.
