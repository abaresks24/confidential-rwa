# Confidential RWA — private yield-bearing treasury on Stellar

**HackMeridian 2026 · Genesis · Stellar Composed**

> Your tokenized treasury fund keeps earning interest — but nobody can see how much you hold.

## The problem

Stellar carries ~$3.5B of tokenized real-world assets (Franklin Templeton BENJI, Ondo
USDY, Spiko funds, Etherfuse CETES…). Every balance and transfer is **public** — a
company's treasury positions and movements are visible to anyone. OpenZeppelin's new
**Confidential Token** (v0.8.0) encrypts balances, but it **requires a non-rebasing
underlying**. Yield-bearing RWAs like BENJI **rebase** (interest arrives as new shares),
so they cannot be made confidential directly.

## What we built

An adapter that closes that gap — **without breaking OZ's accounting invariant, by
satisfying it**: we put a non-rebasing share token in front of the confidential token.

```
rtFUND  (rebasing RWA, SEP-41)             interest = index growth
   │  deposit
   ▼
wsFUND  (ShareWrapper, NON-rebasing shares)   ← our novel contract (wstETH-style)
   │  deposit  (valid OZ underlying: non-rebasing)
   ▼
OZ CompliantToken  (encrypted Pedersen-commitment balance)
```

Key idea: the **encrypted value is a share count** (stable), and **yield surfaces as a
public exchange rate** — so the hidden number never changes when interest accrues.

## Status (testnet, verified)

Verified by rerunning `scripts/e2e.sh` live against Stellar testnet:

- ✅ **ShareWrapper yield** — deposit → `accrue` → share balance unchanged while
  `exchange_rate` grows → redeem returns more than deposited (private yield). Real on-chain.
- ✅ **Confidential balances** — `confidential_balance` returns only `BytesN<64>` Pedersen
  commitments, no plaintext amount.
- ✅ **Eligibility inheritance** — non-allowlisted account's confidential `register` is
  rejected on-chain (`#3602`) by the policy, not by the UI.
- ✅ **Auditor / selective disclosure** — the issuer's auditor key decrypts a holder's true
  balance (regulator view).
- ✅ **Confidential P2P transfer** (alice → eligible recipient) — real UltraHonk proof,
  amount hidden, auditor-decryptable both sides. (Re-runnability across chained transfers
  is being hardened; see `scripts/e2e.sh` B6.)

### Honest caveats
- OZ's UltraHonk proofs are **non-ZK** (the verifier is `ultra_flavor`, `--oracle_hash
  keccak`, no `--zk`): balances are **confidential** (hidden commitments) but **not
  anonymous / not witness-hiding**. We do not claim ZK anonymity.
- `withdraw` (confidential → public SEP-41 exit) is not yet implemented.
- Demo auditor key `sk_aud = 1` (`K_aud = H`) — a real deployment uses a secret auditor key.

## Deployed contracts (testnet)

| Contract | ID |
|---|---|
| rtFUND (rebasing RWA) | `CDTZL6HUYZMC2FVX5QNSY5YWF2ALELI6IRZKJ4OHLJ4B5P5NWBXBUZJU` |
| wsFUND (ShareWrapper) | `CCQNKSFQNWJINCOMYVCVWHC6SYNTS3MU7G6SF3XMKDMC4VVVTETOY3AH` |
| CompliantToken (confidential) | `CDJRMM26MSY6FNCG53OIED74C5UJ5OPBHKNG4LZA2ZTKSV25QWNPD4SU` |
| verifier / auditor / factory / allowlist_policy | see `deployments/testnet.json` |

## Repo layout

- `contracts/` — our two Rust contracts (`mock-rebasing-rwa`, `share-wrapper`) + tests.
- `circuits/` — client-side UltraHonk proof generation (register/transfer), honest write-up.
- `scripts/` — `deploy.sh`, `e2e.sh`, proving + transfer witness tooling.
- `deployments/testnet.json` — contract IDs + accounts.
- `web/` — Vite + React treasurer UI (Node backend shells the `stellar` CLI).
- `docs/` — `ARCHITECTURE.md`, `AGENT_BRIEF.md`.

## Build & run

```bash
# 1. OpenZeppelin v0.8.0 reference (not vendored, ~2.3G) — required to build the OZ suite + VKs
git clone --depth 1 https://github.com/OpenZeppelin/stellar-contracts.git reference/stellar-contracts

# 2. Contracts
cd contracts && cargo test && cd ..

# 3. Proving toolchain (pins nargo 1.0.0-beta.11 + bb 0.87.0)
./circuits/toolchain.sh

# 4. Deploy to testnet + run the end-to-end demo
./scripts/deploy.sh
./scripts/e2e.sh

# 5. Frontend (local; backend shells the stellar CLI)
cd web && pnpm i && pnpm dev
```

Toolchain: Rust 1.98 (`wasm32v1-none`), stellar CLI 27.0.0+, nargo 1.0.0-beta.11, bb 0.87.0, Node 20.

## License

MIT. Builds on [OpenZeppelin stellar-contracts](https://github.com/OpenZeppelin/stellar-contracts) (MIT).
