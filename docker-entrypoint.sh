#!/usr/bin/env bash
# =============================================================================
# Fly container entrypoint.
#
# 1. Put the pinned Noir/bb toolchain on PATH (installed in the image).
# 2. Configure the Soroban `testnet` network for the stellar CLI.
# 3. Recreate the `crwa-*` key aliases the scripts use, from Fly secrets that
#    hold the testnet secret seeds (NEVER baked into the image).
# 4. Launch the Next.js standalone server (serves UI + all /api/* handlers).
#
# Expected secrets (testnet seeds, S...):
#   SK_ADMIN SK_ISSUER SK_ALICE SK_CAROL SK_BOB SK_FEEPAYER
# Aliases created (matching deployments/testnet.json key_aliases):
#   crwa-admin crwa-issuer crwa-alice crwa-carol crwa-bob crwa-feepayer
# A missing seed is logged and skipped (the matching flows just won't work).
# =============================================================================
set -euo pipefail

export PATH="/root/.nargo/bin:/root/.bb:${PATH}"
export REPO_ROOT="${REPO_ROOT:-/app}"

echo "==> Toolchain:"
echo "    stellar: $(stellar --version 2>/dev/null | head -1 || echo MISSING)"
echo "    nargo:   $(nargo --version 2>/dev/null | sed -n 's/^nargo version = //p' || echo MISSING)"
echo "    bb:      $(bb --version 2>/dev/null || echo MISSING)"

# --- network -----------------------------------------------------------------
echo "==> Configuring testnet network"
stellar network add testnet \
  --rpc-url "https://soroban-testnet.stellar.org" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --global 2>/dev/null || echo "    (testnet network already configured)"

# --- keys --------------------------------------------------------------------
add_key() {
  local alias="$1" seed="$2"
  if [ -z "${seed:-}" ]; then
    echo "    - ${alias}: no secret provided, skipping"
    return 0
  fi
  # stellar 27.x: --secret-key reads the S... key from stdin. --overwrite
  # replaces any stale alias. Verified to roundtrip to the same G-address.
  if printf '%s\n' "$seed" | stellar keys add "$alias" --secret-key --overwrite >/dev/null 2>&1; then
    echo "    - ${alias}: $(stellar keys address "$alias" 2>/dev/null)"
  else
    echo "    - ${alias}: FAILED to add (is the seed a valid S... key?)"
  fi
}

echo "==> Importing key aliases from secrets"
add_key "crwa-admin"    "${SK_ADMIN:-}"
add_key "crwa-issuer"   "${SK_ISSUER:-}"
add_key "crwa-alice"    "${SK_ALICE:-}"
add_key "crwa-carol"    "${SK_CAROL:-}"
add_key "crwa-bob"      "${SK_BOB:-}"
add_key "crwa-feepayer" "${SK_FEEPAYER:-}"

# --- stage genesis confidential proof artifacts ------------------------------
# The confidential deposit/auditor/send flows read + write opening state under
# /app/out (register_alice/conf_total, transfer_ac/transfer.json,
# transfer_state/*). The image ships these at /app/seed/out with values that
# match the LIVE on-chain commitments. Copy each file in only if it is not
# already present, so a long-running container's self-updated state is NEVER
# clobbered on restart — we only backfill a fresh/empty /app/out.
if [ -d /app/seed/out ]; then
  echo "==> Staging genesis confidential artifacts into /app/out (backfill only)"
  ( cd /app/seed/out && find . -type f -print0 | while IFS= read -r -d '' f; do
      dest="/app/out/${f#./}"
      if [ ! -e "$dest" ]; then
        mkdir -p "$(dirname "$dest")"
        cp "$f" "$dest"
        echo "    + ${f#./}"
      else
        echo "    = ${f#./} (already present, kept)"
      fi
    done )
fi

# --- server ------------------------------------------------------------------
export PORT="${PORT:-8080}"
export HOSTNAME="0.0.0.0"
echo "==> Starting Next.js server on :${PORT}"
exec node /app/web/server.js
