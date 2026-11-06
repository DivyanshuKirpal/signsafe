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

## Simulation (simulateTransaction)
An RPC node can run a transaction against current state without recording it. SignSafe turns off signature checks (`sigVerify: false`) so unsigned transactions work, asks the node to use a fresh blockhash (`replaceRecentBlockhash: true`), and asks for the after-state of chosen accounts. Example: simulating "send 0.01 SOL" from a devnet wallet returned its new balance 0.010005 SOL lower and a `fee` of 5,000 lamports, without sending anything.

## Fees
Every transaction pays a network fee in SOL from the fee payer: 5,000 lamports per signature plus any priority fee. Fees are charged even when the transaction fails. In SignSafe the fee payer's SOL change is labelled "includes the network fee", which is why the sender's change is 0.010005 SOL, not 0.01.

## Rent and closed accounts
Accounts must hold a minimum SOL balance for their size (rent exemption). An account whose balance drops to 0 is deleted at the end of the transaction. SignSafe treats a 0-lamport account as "closed" and a new one as "created": the S1 recipient shows "Account created" plus "+0.01 SOL".

## Inner instructions (CPIs)
A program can call another program during its instruction (a cross-program invocation). Simulation reports these calls as inner instructions, path "1.0" meaning "the first call made while running instruction 1". Example: creating an associated token account calls the System Program (`createAccount`) and the Token program (`initializeAccount3`). Drainers can hide an `Approve` inside such a call, so SignSafe also checks the state diff.

## Delegate allowance (delegatedAmount)
A token account stores both the delegate and how much it may still move (`delegatedAmount`). After the live approval simulation, the USDC token account's balance was unchanged but its delegate became a fresh address with an allowance of u64 max. That state change is how SignSafe sees an approval even when an unknown program makes it.

## Lookup table lifecycle
A lookup table is "warmed up" one slot after addresses are added and can be deactivated by its authority. After deactivation it keeps working for about 512 slots, then the runtime refuses to load it, even though the account still exists until it is closed. Found live on devnet: table `4HWd...zVK6` could be read but simulation was refused, which SignSafe reports as "A lookup table this transaction uses no longer works".

## Genesis hash
Each Solana cluster has a unique genesis hash. Devnet's is `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. SignSafe checks it before using an RPC endpoint, so a mainnet URL can never be used by mistake.

## Who is "the owner"? (why the rules ignore "the user")
A token account's owner is stored in the account itself. A drainer builds the transaction, so it can make itself the fee payer, add itself as a co-signer, or even write its own address into an instruction's "owner" field. SignSafe therefore compares every permission change with the owner read from devnet before the transaction. Example: an unlimited Approve whose delegate is also the fee payer is still Danger, because the token account's real owner is someone else.

## Rules decide, AI explains
The verdict comes from fixed rules with fixed thresholds (for example: an approval of at least 50% of the balance is Danger), computed with whole numbers (`part * 100 >= 50 * balance`), so 500 of 1,000 is Danger and 499 is Caution. Memo text and program logs are never inputs to the rules, so text like "this transaction is verified" cannot change the verdict.

## Verdict order
Danger beats "Could not fully check", which beats Caution, which beats "No known risks found". If the simulation failed but an instruction already shows an unlimited approval, the verdict stays Danger and the gaps are still listed. "No known risks found" means no rule matched on devnet, not that the transaction is harmless.
