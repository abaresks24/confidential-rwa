# Agent brief — shared context (READ FIRST)

You are one of several agents building `confidential-rwa` for HackMeridian 2026.
Read `docs/ARCHITECTURE.md` before anything.

## Non-negotiables
- **Honesty**: never label a mock/stand-in as real. If you stub the proof step, say so in
  code comments and README. OZ's own proofs are "not yet zero-knowledge" — don't claim ZK/anonymity.
- **Our novelty is the ShareWrapper** (confidential wrapping of a *rebasing* RWA). The
  confidential suite is composed from OZ as-is — do NOT reinvent it.
- **No scope creep**: do not add the RWA identity-verifier policy, extra tokens, or features
  beyond ARCHITECTURE.md. Eligibility = OZ allowlist-policy as-is.

## Ground truth / reference
- OZ v0.8.0 is cloned at `reference/stellar-contracts` and **compiles**. Mirror its conventions
  (see `reference/stellar-contracts/CLAUDE.md`): `panic_with_error!` not `unwrap`, storage TTL
  trio, `#[contractimpl(contracttrait)]` vs `#[contractimpl]`, 18-hash section delimiters,
  `only_role`/`has_role` auth rules, tests start with `extern crate std;` + `e.mock_all_auths()`.
- Deploy guide to follow verbatim: `reference/stellar-contracts/examples/confidential/README.md`.
- Build contracts with `stellar contract build --package <name>` (plain cargo wasm build fails
  on soroban-sdk 28). Pinned VKs: `reference/stellar-contracts/packages/confidential/circuits/vks/`.

## Toolchain
Rust 1.98.1 (wasm32v1-none present), stellar CLI 27.0.0 (may need upgrade to ≥28.1.0),
nargo 1.0.0-rc.5, bb 0.63.0, node 20, pnpm 9. Network: testnet.

## Definition of done (the loop exits only when ALL true)
1. `cargo test` green for our two crates.
2. `stellar contract build` produces WASMs for rtFUND + wsFUND.
3. Full suite deployed on **testnet**; deploy script reproducible; contract IDs recorded in
   `deployments/testnet.json`.
4. End-to-end script runs the demo flow (deposit → accrue → confidential transfer → eligibility
   reject → auditor view → redeem-with-yield) and asserts expected outcomes.
5. Frontend runs locally, drives the e2e flow, shows hidden balance + growing value + reject + auditor view.
6. No critical flaw: no fake "confidential" that leaks the amount in plaintext on-chain; no
   hardcoded success; eligibility reject is enforced **on-chain**, not just in UI.
