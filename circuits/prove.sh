#!/usr/bin/env bash
# Client-side UltraHonk proof generator for the OZ v0.8.0 confidential token
# per-operation circuits. Produces exactly the two artifacts the on-chain
# Soroban verifier (ultrahonk_soroban_verifier 0.1.0, by Nethermind) consumes:
#
#   proof           14592 bytes (= PROOF_FIELDS 456 * 32). bb's `prove` output
#                   verbatim; public inputs are NOT embedded in it.
#   public_inputs   concatenated canonical big-endian 32-byte Fr elements, in
#                   circuit order. bb's `public_inputs` output verbatim.
#
# Both are also emitted as 0x-prefixed hex (proof.hex, public_inputs.hex) for
# building the Soroban `Bytes` arguments, plus meta.json with sizes/field count.
#
# THIS IS REAL. Verified this session:
#   - With the pinned toolchain the regenerated VK is byte-identical to every
#     committed packages/confidential/circuits/vks/<circuit>.vk.bin.
#   - A register proof generated here verifies against the keccak-written VK via
#     `bb verify` (see verify.sh), and is 14592 bytes with 6 BE field public
#     inputs, exactly matching the verifier crate's PROOF_BYTES and the
#     register circuit's 6 public parameters.
#
# Non-default bb flags are MANDATORY and baked in here (vks/README.md#Proving):
#   --oracle_hash keccak  -> on-chain verifier rebuilds the Fiat-Shamir
#                            transcript with Keccak; a poseidon2 (bb default)
#                            proof is rejected.
#   (no --zk)             -> verifier implements only the non-zk ultra_flavor.
#
# Usage:
#   ./prove.sh <circuit> <prover_toml> <out_dir>
#   <circuit> one of: register withdraw transfer set_spender spender_transfer clawback
#             (deposit/merge/revoke_spender are PROOFLESS in OZ -- no proof needed.)
#
# Example:
#   ./prove.sh register examples/register.Prover.toml out/register
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF_CIRCUITS="$REPO_ROOT/reference/stellar-contracts/packages/confidential/circuits"

CIRCUIT="${1:-}"
PROVER_TOML="${2:-}"
OUT_DIR="${3:-}"

if [ -z "$CIRCUIT" ] || [ -z "$PROVER_TOML" ] || [ -z "$OUT_DIR" ]; then
    sed -n '38,46p' "$0"
    exit 2
fi

case "$CIRCUIT" in
    register|withdraw|transfer|set_spender|spender_transfer|clawback) ;;
    deposit|merge|revoke_spender)
        echo "ERROR: '$CIRCUIT' is a PROOFLESS operation in OZ confidential -- no proof is generated or needed." >&2
        exit 2 ;;
    *)
        echo "ERROR: unknown circuit '$CIRCUIT'." >&2
        exit 2 ;;
esac

if [ ! -f "$PROVER_TOML" ]; then
    echo "ERROR: Prover.toml not found: $PROVER_TOML" >&2
    exit 2
fi
if [ ! -d "$REF_CIRCUITS" ]; then
    echo "ERROR: OZ reference circuits not found at $REF_CIRCUITS" >&2
    exit 2
fi

# Pin the toolchain (install if needed) -- the whole point of this module.
source "$SCRIPT_DIR/toolchain.sh"

PKG="circuit_${CIRCUIT}"

# Work in a throwaway copy of the reference workspace so we never mutate
# reference/ (brief: only touch circuits/ and scripts/prove*).
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/
cp "$PROVER_TOML" "$WORK/${CIRCUIT}/Prover.toml"

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

echo "==> Compiling ${PKG}"
( cd "$WORK" && nargo compile --package "$PKG" )

echo "==> Executing witness"
( cd "$WORK" && nargo execute --package "$PKG" "${CIRCUIT}_witness" )

echo "==> Generating UltraHonk proof (keccak oracle, non-zk)"
PROOFSTAGE="$WORK/proofout"
mkdir -p "$PROOFSTAGE"
( cd "$WORK" && bb prove -s ultra_honk --oracle_hash keccak \
    -b "target/${PKG}.json" -w "target/${CIRCUIT}_witness.gz" -o "$PROOFSTAGE" )

cp "$PROOFSTAGE/proof" "$OUT_DIR/proof"
cp "$PROOFSTAGE/public_inputs" "$OUT_DIR/public_inputs"

PROOF_LEN="$(wc -c < "$OUT_DIR/proof" | tr -d ' ')"
PI_LEN="$(wc -c < "$OUT_DIR/public_inputs" | tr -d ' ')"
PI_FIELDS=$(( PI_LEN / 32 ))

# Sanity: the verifier crate fixes PROOF_BYTES = 456 * 32 = 14592.
if [ "$PROOF_LEN" -ne 14592 ]; then
    echo "WARNING: proof is ${PROOF_LEN} bytes, expected 14592 (PROOF_BYTES). The bb proof layout may have drifted." >&2
fi
if [ $(( PI_LEN % 32 )) -ne 0 ]; then
    echo "WARNING: public_inputs (${PI_LEN} bytes) is not a whole number of 32-byte fields." >&2
fi

# Hex forms for building Soroban Bytes args.
printf '0x' > "$OUT_DIR/proof.hex"
xxd -p -c 100000 "$OUT_DIR/proof" >> "$OUT_DIR/proof.hex"
printf '0x' > "$OUT_DIR/public_inputs.hex"
xxd -p -c 100000 "$OUT_DIR/public_inputs" >> "$OUT_DIR/public_inputs.hex"

cat > "$OUT_DIR/meta.json" <<EOF
{
  "circuit": "${CIRCUIT}",
  "package": "${PKG}",
  "proof_bytes": ${PROOF_LEN},
  "public_inputs_bytes": ${PI_LEN},
  "public_inputs_fields": ${PI_FIELDS},
  "oracle_hash": "keccak",
  "zk": false,
  "scheme": "ultra_honk",
  "nargo": "1.0.0-beta.11",
  "bb": "0.87.0",
  "real": true,
  "note": "proof + public_inputs are the exact Bytes args for ConfidentialVerifier::verify_proof"
}
EOF

echo "==> Done. Artifacts in $OUT_DIR"
echo "    proof           ${PROOF_LEN} bytes"
echo "    public_inputs   ${PI_LEN} bytes (${PI_FIELDS} fields)"
echo "    proof.hex, public_inputs.hex, meta.json"
