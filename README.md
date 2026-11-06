# SignSafe

SignSafe shows what a Solana transaction will actually do before you sign it, and warns you in plain English when it looks like a wallet drainer.

Built for the MLH Solana Hackathon (6-8 November 2026), AI Track.

> Work in progress. This README is filled in as features land.

## How it works

```
Decode -> Simulate (devnet) -> State diff -> Risk rules -> Verdict -> AI explanation
```

Fixed, unit-tested rules decide the risk level. The AI model only explains the result and cannot change it. If the AI is unavailable, a built-in explanation is used.

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
| `npm run setup:demo` | (planned) creates devnet demo accounts |
| `npm run scenarios:check` | (planned) runs every demo scenario and compares verdicts |
| `npm run fixtures:save` | (planned) saves scenario results for offline replay |

## Security notes

- Devnet only. Anything that sends a transaction runs on devnet.
- The app never asks for a seed phrase or private key.
- API keys stay on the server and are read from `.env.local`, which is git-ignored.

## Credits

- Scaffolded from the official Solana `kit/nextjs` template (solana-foundation/templates, via `create-solana-dapp`). The template's demo pages were removed.
- Libraries: Next.js, React, Tailwind CSS, `@solana/kit`, `@solana-program/*` clients, zod, vitest, tsx.
- Built with help from Claude Code.

## License

MIT. See `LICENSE`.
