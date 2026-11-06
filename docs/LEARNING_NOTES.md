# Learning notes

Short notes on each Solana concept met while building SignSafe, with an example from this project. Use them to answer judges' and interviewers' questions.

## Clusters (devnet vs mainnet)
Solana runs several separate networks ("clusters"). Mainnet holds real value; devnet is a public test network where SOL is free and worthless. SignSafe simulates and sends only on devnet, which is why the header shows a fixed "Devnet" label and `check:env` warns if an RPC URL does not look like devnet.

## RPC
An RPC endpoint is the HTTP API a client uses to read chain state and submit or simulate transactions. SignSafe uses a Helius devnet URL (server-only, because the URL contains the API key) with the public devnet endpoint as a fallback.
