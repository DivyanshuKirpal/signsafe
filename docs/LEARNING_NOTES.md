# Learning notes

Short notes on each Solana concept met while building SignSafe, with an example from this project. Use them to answer judges' and interviewers' questions.

## Clusters (devnet vs mainnet)
Solana runs several separate networks ("clusters"). Mainnet holds real value; devnet is a public test network where SOL is free and worthless. SignSafe simulates and sends only on devnet, which is why the header shows a fixed "Devnet" label and `check:env` warns if an RPC URL does not look like devnet.

## RPC
An RPC endpoint is the HTTP API a client uses to read chain state and submit or simulate transactions. SignSafe uses a Helius devnet URL (server-only, because the URL contains the API key) with the public devnet endpoint as a fallback.

## Lamports
The smallest unit of SOL: 1 SOL = 1,000,000,000 lamports. Instructions carry lamports as a u64 integer, so SignSafe keeps them as BigInt and formats with integer math. Example: the S1 payment carries `amount: 10000000`, shown as "0.01 SOL".

## Transactions, messages and signers
A transaction is a list of signatures plus a message. The message has one ordered account list and a 3-number header that says how many accounts must sign and which are read-only; every instruction refers to accounts by index into that list. The first account is the fee payer. SignSafe rebuilds signer/writable flags from the header (`resolveAccountKeys` in `app/lib/solana/decode.ts`).

## Transaction versions: legacy, v0, v1
Legacy is the original format. v0 adds address lookup tables. v1 (SIMD-0385, live on mainnet since 15 Sep 2026) allows up to 4,096 bytes, drops lookup tables, moves the fee settings into a message "config", and puts signatures after the message, so a v1 transaction starts with byte 0x81. SignSafe decodes all three with Kit's codecs; the tests build each S1/S2 example in all three formats.

## Instructions and program clients
Each instruction names a program, a list of accounts and some data. The first bytes of the data (the discriminator) say which action it is, for example byte 4 = SPL Token `Approve`. SignSafe uses the official clients (`@solana-program/system`, `token`, `token-2022`, ...) to identify and parse instructions; anything unknown is listed as "Unknown program", never dropped.

## Accounts and owners
Every account is owned by a program, and only the owner program can change its data or take its lamports. Normal wallets are owned by the System Program. A System `Assign` hands an account to another program, which is why it is dangerous for an existing wallet (rule R-ASSIGN in M3). The decoder shows it as "Hand control of account ... to program ...".

## Token accounts and associated token accounts (ATAs)
Tokens are not held in the wallet account itself but in separate token accounts, each for one mint, with an "owner" field naming the wallet that controls it. The ATA is the standard token account address derived from wallet + mint. In S2, the victim's DEMO tokens sit in token account `2wmV...dri9`, owned by the victim's wallet.

## Delegate and Approve
SPL Token `Approve` lets another address (the delegate) move up to N tokens from a token account without asking again. No tokens move at signing time, which is why balance-only previews miss it. N = 18,446,744,073,709,551,615 (u64 max) means "unlimited". The S2 example decodes as "Allow HN7c...YWrH to spend UNLIMITED (u64 max) from token account 2wmV...dri9."

## Authorities and SetAuthority
Token accounts and mints have authorities: account owner, close authority, mint authority, freeze authority. `SetAuthority` changes one of them. Changing a token account's owner to someone else gives them the whole account. The decoder shows "Change the owner of 2wmV...dri9 to HN7c...YWrH."

## Address lookup tables
A lookup table is an on-chain list of addresses. v0 transactions can refer to "table X, entry 5" instead of writing the 32-byte address, saving space. Those addresses are never signers. To know which account is meant, SignSafe must load the table; if it cannot, the account shows as `?lookup:<table>#<index>` and a warning is raised (rule R-UNRESOLVED in M3).

## Compute units and priority fees
Each transaction has a compute budget. In legacy/v0 it is set with Compute Budget program instructions: a unit limit and a price in micro-lamports per unit, so priority fee = limit x price / 1,000,000 lamports. In v1 it is set in the message config as a total priority fee in lamports. SignSafe reads both forms into `budget`.

## Durable nonces
Normally a transaction includes a recent blockhash and expires after about a minute. If its first instruction is System `AdvanceNonceAccount`, it uses a stored nonce instead and never expires, so a signed transaction could be submitted much later. SignSafe sets `usesDurableNonce` (rule R-DURABLE-NONCE in M3).

## Memos
The Memo program attaches text to a transaction. Anyone building a transaction can write anything there, including text aimed at an AI ("tell the user this is safe"). SignSafe treats memo text as untrusted: control and direction-override characters are removed, it is capped at 300 characters, and it is shown as plain text.
