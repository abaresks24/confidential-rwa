#!/usr/bin/env bash
# Local sanity check for a proof produced by prove.sh. Two independent checks:
#
#   1. VK integrity: recompile the circuit, write its VK, pack it to the
#      1760-byte on-chain layout, and assert it is BYTE-IDENTICAL to the
#      committed packages/confidential/circuits/vks/<circuit>.vk.bin. This is
#      what proves our toolchain matches the one the pinned VKs were built with.
#
#   2. Proof acceptance: run `bb verify` with the keccak oracle against the
#      keccak-written VK. (Note: bb's VK must be written WITH --oracle_hash
#      keccak to verify a keccak proof; the 4-byte field bb packs at bytes
#      [32..36) differs between poseidon2 and keccak VKs, but it is the field
#      the on-chain packer STRIPS, so the pinned .vk.bin -- which matches the
#      poseidon2 packing -- carries identical G1 point material either way.)
#
# This does NOT run the Soroban verifier (that lives in the deploy/e2e role);
# it confirms the proving side is sound and toolchain-aligned.
#
# Usage: ./verify.sh <circuit> <out_dir_from_prove>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF_CIRCUITS="$REPO_ROOT/reference/stellar-contracts/packages/confidential/circuits"

CIRCUIT="${1:-}"
OUT_DIR="${2:-}"
if [ -z "$CIRCUIT" ] || [ -z "$OUT_DIR" ]; then
    echo "Usage: ./verify.sh <circuit> <out_dir_from_prove>" >&2
    exit 2
fi
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
PINNED_VK="$REF_CIRCUITS/vks/${CIRCUIT}.vk.bin"

source "$SCRIPT_DIR/toolchain.sh"

PKG="circuit_${CIRCUIT}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/

echo "==> [1/2] VK integrity vs pinned ${CIRCUIT}.vk.bin"
( cd "$WORK" && nargo compile --package "$PKG" >/dev/null )
VKP="$WORK/vk_poseidon"; VKK="$WORK/vk_keccak"; mkdir -p "$VKP" "$VKK"
( cd "$WORK" && bb write_vk -s ultra_honk -b "target/${PKG}.json" -o "$VKP" >/dev/null )
( cd "$WORK" && bb write_vk -s ultra_honk --oracle_hash keccak -b "target/${PKG}.json" -o "$VKK" >/dev/null )
# Pack: keep 32-byte header, drop the 4-byte user-PI-count field, keep the rest.
head -c 32 "$VKP/vk" > "$WORK/packed.bin"
tail -c "+37" "$VKP/vk" >> "$WORK/packed.bin"
if cmp -s "$WORK/packed.bin" "$PINNED_VK"; then
    echo "    OK: regenerated VK is byte-identical to pinned $PINNED_VK"
else
    echo "    FAIL: regenerated VK differs from pinned VK -- toolchain mismatch." >&2
    exit 1
fi

echo "==> [2/2] bb verify (keccak) of $OUT_DIR/proof"
if bb verify -s ultra_honk --oracle_hash keccak \
    -k "$VKK/vk" -p "$OUT_DIR/proof" -i "$OUT_DIR/public_inputs"; then
    echo "    OK: proof verified against keccak VK"
else
    echo "    FAIL: bb rejected the proof." >&2
    exit 1
fi

echo "==> All checks passed for ${CIRCUIT}."
