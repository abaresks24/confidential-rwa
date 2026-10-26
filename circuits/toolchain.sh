#!/usr/bin/env bash
# Pins the EXACT Noir + Barretenberg toolchain the OZ v0.8.0 confidential
# circuits were built and VK-pinned with. This is the #1 correctness risk for
# proving: a proof generated with the wrong bb version is silently rejected by
# the on-chain verifier even though everything "runs".
#
# Ground truth (reference/stellar-contracts/.github/workflows/noir.yml and
# packages/confidential/circuits/vks/README.md):
#     nargo  1.0.0-beta.11
#     bb     0.87.0
#
# The developer machine shipped with nargo 1.0.0-rc.5 + bb 0.63.0, which do NOT
# work: rc.5 fails to even compile the circuits (poseidon2_permutation stdlib
# signature changed), and 0.63.0 is an older bb generation. This script installs
# the pinned versions via the official noirup/bbup (already present under
# ~/.nargo/bin and ~/.bb). Verified this session: with the pinned pair, the
# regenerated VK is BYTE-IDENTICAL to every committed vks/*.vk.bin.
set -euo pipefail

NARGO_VERSION="1.0.0-beta.11"
BB_VERSION="0.87.0"

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

have() { command -v "$1" >/dev/null 2>&1; }

if ! have noirup; then
    echo "ERROR: noirup not found at ~/.nargo/bin. Install from https://github.com/noir-lang/noirup" >&2
    exit 1
fi
if ! have bbup; then
    echo "ERROR: bbup not found at ~/.bb. Install from aztec-packages/barretenberg/bbup" >&2
    exit 1
fi

current_nargo="$(nargo --version 2>/dev/null | sed -n 's/^nargo version = //p' || true)"
if [ "$current_nargo" != "$NARGO_VERSION" ]; then
    echo "==> Installing nargo ${NARGO_VERSION} (have: ${current_nargo:-none})"
    noirup -v "$NARGO_VERSION"
else
    echo "==> nargo ${NARGO_VERSION} already active"
fi

current_bb="$(bb --version 2>/dev/null | sed 's/^v//' || true)"
if [ "$current_bb" != "$BB_VERSION" ]; then
    echo "==> Installing bb ${BB_VERSION} (have: ${current_bb:-none})"
    bbup -v "$BB_VERSION"
else
    echo "==> bb ${BB_VERSION} already active"
fi

echo "==> Toolchain pinned:"
echo "    nargo: $(nargo --version | sed -n 's/^nargo version = //p')"
echo "    bb:    $(bb --version)"
