# confidential-rwa — Architecture (HackMeridian 2026, Genesis / Stellar Composed)

## One-liner (non-crypto)
"Your tokenized treasury fund keeps earning interest — but nobody can see how much
you hold." Make a **rebasing** yield-bearing RWA **confidential**, which
OpenZeppelin's confidential token structurally **cannot** do on its own.

## The novelty (what is NOT shipped by OZ)
OZ v0.8.0 ships the whole confidential stack (encrypted balances, UltraHonk proofs,
auditor, freeze, clawback, factory, SAC-passthrough eligibility). But its confidential
token **requires a non-rebasing underlying** (`packages/confidential/docs/.../system-model.md`
Underlying Token Assumptions: *non-rebasing, no fee on transfer, deterministic revert*).

Yield-bearing RWAs like Franklin Templeton **BENJI rebase** (interest paid as new shares).
So they cannot be wrapped directly. **Our contribution is the adapter that lifts that
limitation**: a wstETH-style non-rebasing **ShareWrapper** that sits between a rebasing
RWA and the OZ confidential token.

```
rtFUND (mock rebasing RWA, SEP-41)                  <- interest = index growth
   │  deposit
   ▼
wsFUND (ShareWrapper, NON-rebasing shares, SEP-41)  <- OUR NOVEL CONTRACT
   │  deposit (valid OZ underlying: non-rebasing)
   ▼
OZ CompliantToken (confidential shares)             <- encrypted share balance
```

Key insight that makes confidentiality + yield compose cleanly:
- The **encrypted amount is a share count** (fixed, non-rebasing) → valid OZ underlying.
- **Yield shows up as a growing public exchange rate** (rtFUND per wsFUND), not as a
  balance change. So the hidden number never has to change when interest accrues.

## What is "composed from OZ" (honest, not our novelty)
- Confidential token, verifier, auditor registry, clawback, freeze — deployed **as-is**
  from `reference/stellar-contracts/examples/confidential/*`.
- Eligibility gate = OZ **allowlist-policy** example (Policy trait). We do NOT claim the
  eligibility-inheritance as novelty (OZ's `sac_passthrough` + Policy trait already cover it).

## Contracts
| Crate | Role | Source |
|---|---|---|
| `mock-rebasing-rwa` (rtFUND) | SEP-41 whose balances grow via an admin `accrue(bps)` (rebasing, BENJI-like) | **ours** |
| `share-wrapper` (wsFUND) | wstETH-style non-rebasing shares over rtFUND; `deposit`/`redeem`/`exchange_rate` | **ours (novel)** |
| verifier / auditor / allowlist-policy / compliant-token / factory | confidential suite | OZ examples, as-is |

## Demo (2 min, live)
1. Alice is allowlisted; holds rtFUND. Deposits rtFUND → wsFUND → confidential shares.
2. On-ledger: Alice's confidential balance is a **Pedersen commitment** (hidden).
3. Issuer calls `rtFUND.accrue()` (simulate 6 months interest). wsFUND exchange rate rises.
4. Alice's hidden share count is unchanged, but **redeems for more rtFUND than she deposited** — private yield.
5. Transfer to a **non-allowlisted** address → **rejected on-chain** (eligibility).
6. Auditor decrypts and shows Alice's true balance (regulator view).

## Real vs stand-in (per user decision "réel, sinon stand-in")
- Target: **real UltraHonk proofs** generated client-side (bb 0.63.0) against OZ pinned VKs,
  verified on-chain. Timebox the version-matching; if blocked, stand-in the proof step
  (real Pedersen commitments, stubbed verify) and **label it clearly** in README + demo.

## Toolchain facts (verified this session)
- Rust 1.98.1 + targets `wasm32-unknown-unknown`, `wasm32v1-none`. OZ stack compiles natively (20s, exit 0).
- stellar CLI **27.0.0** — OZ README wants **≥28.1.0** for `stellar contract build` / deploy. **Must verify/upgrade.**
- nargo 1.0.0-rc.5, bb 0.63.0, node 20, pnpm 9.
- OZ reference clone: `reference/stellar-contracts` @ v0.8.0 (`ddc327e`). Pinned VKs in
  `packages/confidential/circuits/vks/*.vk.bin`. Deploy guide: `examples/confidential/README.md`.
