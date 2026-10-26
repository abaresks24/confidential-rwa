#!/usr/bin/env bash
# =============================================================================
# reconcile_spendable.sh <onchain_commit_128hex> <vk_hex> <sigma_hex> [step]
#
# RE-SEED / self-heal the sender's spendable opening (v, r) by RECONCILING it
# against the LIVE on-chain spendable_commitment. Any cached (v, r) in
# out/transfer_state is only a hint and is NEVER trusted: this script derives
# the opening that actually opens the on-chain point, in ONE circuit run.
#
# Why this is possible (and honest): every spendable state this e2e can produce
# has a blinding r that is one of exactly two deterministic values —
#   * r = 0                           (pure zero-blinding deposits, never transferred)
#   * r = derive_spend_r(vk, sigma)   (the new-spendable blinding after a transfer
#                                       with this fixed sigma; see lib T10/W5/S9)
# and a plaintext v that is a multiple of the fixed round deposit/transfer step.
# prep_reconcile walks that grid in-circuit, recomputing commit(v, r) with the
# EXACT OZ Pedersen gadget, and returns the (v, r) that matches the real
# on-chain point. No secret beyond the sender's own vk — no fabrication, no
# stale-cache dependence.
#
# Output (stdout, one line): "<v_dec> <r>"  where r is "0" or "0x..."  — the
# opening PROVEN to satisfy commit(v, r) == on-chain spendable_commitment.
# Exits non-zero (prints nothing on stdout) if nothing reconciles, so the caller
# fails loudly instead of building an unsatisfiable witness.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REF_CIRCUITS="$ROOT/reference/stellar-contracts/packages/confidential/circuits"

ONCHAIN="${1:?usage: reconcile_spendable.sh <onchain> <vk> <sigma> [step]}"
# STEP is the plaintext-balance granularity the grid walks. It MUST divide every
# balance this e2e can produce. Confidential deposits/transfers here are 1e6-
# aligned (the genesis spendable is 899_000_000 = 899 * 1e6, transfers net to
# e.g. 1_849_000_000 = 1849 * 1e6), NOT 1e8-aligned, so the step is 1e6. Paired
# with prep_reconcile's N=2001 this sweeps v in {0, 1e6, ..., 2_000_000_000} at
# both deterministic blindings in a single sub-second circuit execution.
# (prep_reconcile sweeps v in {0, 1e6, ..., 4_000_000_000} with N=4001.)
VK="${2:?}"; SIGMA="${3:?}"; STEP="${4:-1000000}"
ONCHAIN="${ONCHAIN#0x}"

IDENTITY64="0000000000000000000000000000000000000000000000000000000000000000"
IDENTITY128="${IDENTITY64}${IDENTITY64}"
# The token stores a 64-byte zero blob for an unset spendable → opening (0, 0).
if [ "$ONCHAIN" = "$IDENTITY128" ]; then
  echo "0 0"; exit 0
fi

CX="0x${ONCHAIN:0:64}"
CY="0x${ONCHAIN:64:64}"

source "$HERE/../circuits/toolchain.sh" >/dev/null 2>&1

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/
cp -R "$ROOT/circuits/prep_reconcile" "$WORK/prep_reconcile"
node -e 'const fs=require("fs");const p=process.argv[1]+"/Nargo.toml";let t=fs.readFileSync(p,"utf8");if(!/"prep_reconcile"/.test(t))t=t.replace(/members = \[/,"members = [\n    \"prep_reconcile\",");fs.writeFileSync(p,t);' "$WORK"
cat > "$WORK/prep_reconcile/Prover.toml" <<EOF
cx = "$CX"
cy = "$CY"
vk = "$VK"
sigma = "$SIGMA"
step = "$STEP"
EOF

OUT="$( cd "$WORK" && nargo execute --package prep_reconcile prep_reconcile_witness 2>&1 )"
echo "$OUT" | grep -q "successfully solved" || { echo "ERROR: prep_reconcile did not solve" >&2; echo "$OUT" >&2; exit 1; }

# Circuit output: [found, v, r]
read -r FOUND V R <<<"$(printf '%s' "$OUT" | node -e '
  const d=require("fs").readFileSync(0,"utf8");
  const m=d.match(/Circuit output:\s*\[([^\]]*)\]/);
  if(!m){console.error("no Circuit output");process.exit(1);}
  const v=[...m[1].matchAll(/0x[0-9a-fA-F]+/g)].map(x=>x[0]);
  const found=BigInt(v[0]).toString();
  const vv=BigInt(v[1]).toString();
  const rr=BigInt(v[2])===0n ? "0" : v[2];
  process.stdout.write(found+" "+vv+" "+rr);
')"

if [ "$FOUND" != "1" ]; then
  echo "reconcile_spendable: no opening reconciles with on-chain spendable $ONCHAIN (grid step=$STEP). Widen the grid in prep_reconcile (N) if a run deposited beyond it." >&2
  exit 1
fi
echo "$V $R"
