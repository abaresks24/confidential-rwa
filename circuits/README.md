# circuits — client-side UltraHonk proof generation (REAL)

Proof generation for the OpenZeppelin v0.8.0 confidential-token per-operation
circuits, targeting the **pinned verification keys** in
`reference/stellar-contracts/packages/confidential/circuits/vks/*.vk.bin` and
the on-chain Soroban verifier (`ultrahonk_soroban_verifier` 0.1.0, Nethermind's
`rs-soroban-ultrahonk`).

## Status: REAL, not a stand-in

Real UltraHonk proofs are generated client-side and verify against the committed
VKs. No part of the proof path is stubbed. The version-alignment risk flagged in
`docs/ARCHITECTURE.md` was investigated and **resolved** — details below.

### The version risk (investigated, resolved)

The pinned VKs were built with **nargo 1.0.0-beta.11 + bb 0.87.0** (ground truth:
`reference/.../.github/workflows/noir.yml`, `vks/README.md`). The machine shipped
with **nargo 1.0.0-rc.5 + bb 0.63.0**, which do NOT work:

- **nargo 1.0.0-rc.5 fails to even compile the circuits.** The `std::hash::poseidon2_permutation`
  stdlib signature changed between beta.11 and rc.5 (now 1 arg, was 2), so
  `lib/src/lib.rs` won't type-check. Observed error:
  `Function expects 1 parameter but 2 were given` at `lib/src/lib.nr:253`.
- **bb 0.63.0 is an older generation** than the 0.87.0 the VKs were pinned to.

Both pinned versions were installed via the official `noirup` / `bbup`
(`circuits/toolchain.sh` does this; both installers were already present under
`~/.nargo/bin` and `~/.bb`). With the pinned pair:

- **All 6 circuit VKs regenerate byte-identical to the committed `vks/*.vk.bin`**
  (register, withdraw, transfer, set_spender, spender_transfer, clawback —
  verified this session with `cmp`).
- A `register` proof generated here is **14592 bytes** (= the verifier crate's
  `PROOF_BYTES` = 456 × 32) with **6 big-endian 32-byte public inputs** (exactly
  the register circuit's 6 `pub` params), and **`bb verify` accepts it**.

### The two non-default bb flags that matter

Baked into `prove.sh` (see `vks/README.md#Proving`):

- `--oracle_hash keccak` — the on-chain verifier rebuilds the Fiat–Shamir
  transcript with Keccak; bb's default `poseidon2` proof is **rejected**.
- **no `--zk`** — the verifier implements only the non-zk `ultra_flavor`.
  (Consequence, honest: these proofs are **not** zero-knowledge / witness-hiding.
  Do not claim ZK anonymity — matches the OZ caveat.)

Subtlety found while verifying: `bb write_vk` with vs without `--oracle_hash keccak`
produces VKs that differ **only** in the 4-byte user-PI-count field at bytes
`[32..36)` — which is exactly the field the on-chain packer *strips*. The G1
point material is identical, so the pinned `.vk.bin` (which matches the default
poseidon2 packing) carries the correct key for the keccak proof. For a local
`bb verify` round-trip you must write the VK **with** `--oracle_hash keccak`
(done in `verify.sh`); on-chain this is a non-issue because the stored VK is the
packed `.vk.bin`.

## What the Soroban verifier consumes

`ConfidentialVerifier::verify_proof(circuit_type, public_inputs: Bytes, proof: Bytes)`:

- `proof` — 14592 bytes, bb's `prove` output verbatim (public inputs NOT embedded).
- `public_inputs` — concatenated canonical big-endian 32-byte `Fr` elements in
  circuit order, bb's `public_inputs` output verbatim.

`prove.sh` emits both, plus `proof.hex` / `public_inputs.hex` (0x-prefixed) for
building the Soroban `Bytes` args, and `meta.json` with sizes/field counts.

Note: in OZ the token's storage layer assembles the *trusted* public inputs from
on-chain state (never caller bytes) and only the proof rides in the `data`
envelope; the public-input file here is the prover-side view that must match
that assembled blob element-for-element.

## Usage

```bash
# Pin/verify the toolchain (installs beta.11 / 0.87.0 if needed)
./circuits/toolchain.sh

# Generate a proof: <circuit> <prover_toml> <out_dir>
./circuits/prove.sh register circuits/examples/register.Prover.toml out/register
# or via the repo-conventional path:
./scripts/prove register circuits/examples/register.Prover.toml out/register

# Self-check: VK byte-match vs pinned + bb verify of the proof
./circuits/verify.sh register out/register
```

Circuits: `register withdraw transfer set_spender spender_transfer clawback`.
`deposit`, `merge`, `revoke_spender` are **proofless** in OZ (deposit credits
`a·G` with zero blinding, verified homomorphically) — `prove.sh` refuses them
with an explanatory message.

## Coverage: what has a ready fixture vs what needs the SDK

- **`register`** — shipped with a real, constraint-satisfying fixture
  (`examples/register.Prover.toml`, lifted from the circuit's own test vectors).
  `prove.sh register … && verify.sh register …` both pass. This end-to-end
  success is what proves the toolchain/VK/proof/verify chain is sound.
- **`withdraw` / `transfer` / `set_spender` / `spender_transfer` / `clawback`** —
  use the **identical** `prove.sh` recipe, but their witnesses contain
  commitments and auditor ECDH ciphertexts that are **computed from live balance
  openings and keys**, not static literals (the circuit test fixtures derive
  them at compile time via helper gadgets). Those witness fields are produced by
  the OZ confidential **SDK / wallet** (`packages/confidential/docs/sdk/`), which
  owns the holder's secret openings. Hand-authoring a Prover.toml for them would
  risk an unsatisfying witness, so none is faked here. Point the SDK-produced
  `Prover.toml` at `prove.sh <circuit>` and the same real pipeline applies.

## Reproducibility

`toolchain.sh` pins nargo 1.0.0-beta.11 + bb 0.87.0. `prove.sh` works in a
throwaway copy of the reference circuits workspace (never mutates `reference/`).
`verify.sh` re-derives the VK and asserts byte-equality with the committed
`.vk.bin`, so toolchain drift fails loudly.
