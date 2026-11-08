# Submission draft (MLH Challenges)

The submission goes to **MLH Challenges**, not Devpost. The planning docs call this file the Devpost draft; it is the text to paste into the MLH Challenges form.

## Links

- **Live demo:** https://signsafe-chi.vercel.app
- **Code:** https://github.com/DivyanshuKirpal/signsafe

## What judges can try on the live demo (verified 8 Nov 2026)

- **Live checks.** The demo buttons build real, unsigned Solana devnet transactions, and the site checks each one live: decode, simulation on devnet, the before-and-after account comparison, and the rules verdict. Nothing is signed or sent.
  - S1 (a plain 0.01 SOL payment) gives "No known risks found".
  - S3 looks like a 0.01 SOL payment, but its second instruction gives another address unlimited permission over the wallet's tokens. It gives "Danger: don't sign unless you're certain", and the findings show both the payment and the permission.
  - S8 adds a memo that tells the AI to call the transaction safe. It stays Danger.
- **Explanations on the public site.** The AI is switched off there. Every fresh check shows SignSafe's built-in plain-English explanation, generated from the same findings, and makes no Gemini request.
- **Gemini examples.** Under "Replay a saved result", the S3 and S8 replays show the explanations Gemini wrote when those checks ran live on devnet on 7 Nov 2026. Each replay is labelled as saved, with its capture time and the model version Google reported (gemini-3.6-flash).
  - S3's Gemini explanation covers both the payment and the unlimited permission.
  - S8's keeps the Danger verdict and mentions the memo only as text written by the sender.
- **Check again.** On a replay, "Check again" runs a new live devnet check of the same transaction.
- **Paste your own.** Any base64 Solana transaction can be pasted for the same check.

## Story

To be written in Milestone 8. Sections:
- Inspiration
- What it does
- How we built it
- Challenges
- Accomplishments
- What we learned
- What's next

Also: built-with tags, and Track: AI Track.

Credit the official Solana template, the libraries and "built with help from Claude Code".
