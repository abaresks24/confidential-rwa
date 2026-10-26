#!/usr/bin/env bash
# =============================================================================
# reconcile_spendable.sh <onchain_commit_128hex> <vk_hex> <sigma_hex> \
#                        <conf_dep> [cached_v] [cached_r]
#
# RE-SEED / self-heal the sender's spendable opening (v, r) by RECONCILING it
# against the LIVE on-chain spendable_commitment. The cached (v, r) in
# out/transfer_state is treated as a HINT, never as ground truth: this script
# derives the opening that actually opens the on-chain point and prints it.
#
# Why this is possible (and honest): every spendable state this e2e can produce
# has a blinding r that is one of exactly two deterministic values —
#   * r = 0                           (pure zero-blinding deposits, never transferred)
#   * r = derive_spend_r(vk, sigma)   (the new-spendable blinding after a transfer
#                                       with this fixed sigma; see lib T10/W5/S9)
# and a plaintext v that is a sum of the fixed round deposit/transfer amounts
# this script walks. So (v, r) is fully RECOVERABLE from chain without any
# secret beyond the sender's own vk — no fabrication, no stale-cache dependence.
#
# Output (stdout, one line): "<v_dec> <r>"  where r is "0" or "0x..."  — the
# opening PROVEN to satisfy commit(v, r) == on-chain spendable_commitment.
# Exits non-zero (and prints nothing on stdout) if no opening reconciles, so the
# caller can fail loudly instead of building an unsatisfiable witness.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

ONCHAIN="${1:?usage: reconcile_spendable.sh <onchain> <vk> <sigma> <conf_dep> [cached_v] [cached_r]}"
VK="${2:?}"; SIGMA="${3:?}"; CONF_DEP="${4:?}"
CACHED_V="${5:-}"; CACHED_R="${6:-}"
ONCHAIN="${ONCHAIN#0x}"

IDENTITY64="0000000000000000000000000000000000000000000000000000000000000000"
IDENTITY128="${IDENTITY64}${IDENTITY64}"

# r=0 opens the identity point only for v=0; the token stores a 64-byte zero
# blob for an unset spendable. Treat that as the (0,0) opening directly.
if [ "$ONCHAIN" = "$IDENTITY128" ]; then
  echo "0 0"; exit 0
fi

# R_FIXED = derive_spend_r(vk, sigma): the only non-zero blinding this e2e makes.
R_FIXED="$(bash "$HERE/derive_spend_r.sh" "$VK" "$SIGMA")"

# Candidate v's: the cached hint, plus the deterministic round-amount grid this
# e2e can reach. Deposits are multiples of 1e8 (CONF_DEP and top-ups) and the
# transfer subtracts 4e8; across a handful of runs the spendable v stays within
# this grid. We try the hint first (fast path), then the grid.
tryv() {  # <v> <r> ; echoes opening + exits 0 on match
  local v="$1" r="$2"
  [ -z "$v" ] && return 1
  local c; c="$(bash "$HERE/commit_vr.sh" "$v" "$r" 2>/dev/null || true)"
  if [ "$c" = "$ONCHAIN" ]; then echo "$v $r"; exit 0; fi
  return 1
}

# 1) fast path: the cached hint, with its cached r and with R_FIXED.
if [ -n "$CACHED_V" ]; then
  tryv "$CACHED_V" "${CACHED_R:-0}" || true
  tryv "$CACHED_V" "$R_FIXED" || true
  tryv "$CACHED_V" 0 || true
fi

# 2) deterministic grid. Both blindings, v in [0 .. 3e9] stepping 1e8 (covers
# many runs of CONF_DEP deposits and XFER=4e8 spends). Zero-blinding first
# (pure-deposit states), then R_FIXED (post-transfer states).
STEP=100000000
MAXV=3000000000
for R in 0 "$R_FIXED"; do
  v=0
  while [ "$v" -le "$MAXV" ]; do
    tryv "$v" "$R" || true
    v=$(( v + STEP ))
  done
done

echo "reconcile_spendable: no opening reconciles with on-chain spendable $ONCHAIN" >&2
exit 1
