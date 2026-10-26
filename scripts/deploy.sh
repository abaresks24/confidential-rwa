#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Deploy the confidential-rwa suite to Stellar testnet.
#
# Deploys, in order:
#   1. Keypairs: admin, issuer, alice, bob (+ feepayer)  — funded via friendbot
#   2. rtFUND  (mock-rebasing-rwa)   — OUR rebasing RWA (SEP-41)
#   3. wsFUND  (share-wrapper)       — OUR novel non-rebasing wrapper (SEP-41),
#                                      underlying = rtFUND
#   4. verifier + 6 pinned UltraHonk VKs   (OZ example, as-is)
#   5. auditor + Grumpkin generator key    (OZ example, as-is)
#   6. factory  (pins token + allowlist wasm hashes)      (OZ example, as-is)
#   7. allowlist-policy + compliant-token via the factory, underlying = wsFUND
#
# IMPORTANT — underlying is wsFUND, NOT a SAC:
#   The OZ README wraps a *classic SAC* and sets sac_passthrough=true. Our
#   underlying (wsFUND) is a plain SEP-41 custom contract with no `authorized`
#   SAC view, so sac_passthrough=true would TRAP on every gated op (the README
#   warns about exactly this). We deploy with sac_passthrough=FALSE: the
#   allowlist-policy is the sole on-chain eligibility gate, which is precisely
#   the eligibility model ARCHITECTURE.md specifies.
#
# Idempotent: re-running reuses existing aliases/keys. To start fully fresh,
# `stellar keys rm crwa-* ; stellar contract alias rm crwa-*` first.
#
# Writes every contract id + account to deployments/testnet.json.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REF="$ROOT/reference/stellar-contracts"
WASM_DIR="$REF/target/wasm32v1-none/release"
OUR_WASM_DIR="$ROOT/contracts/target/wasm32v1-none/release"
VKS="$REF/packages/confidential/circuits/vks"
OUT="$ROOT/deployments/testnet.json"
NET=testnet

# Project-namespaced aliases so we never collide with the user's other keys.
PFX=crwa

mkdir -p "$ROOT/deployments"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*" >&2; }

# --- Auditor key K_aud = 1*H = H (sk_aud = 1). EXAMPLE ONLY: the secret is
# public, do not reuse. K_aud MUST equal sk_aud*H (the viewing-key convention
# PVK = vk*H) so the auditor's ECDH channel is actually decryptable: the
# transfer circuit computes S = r_e*K_aud and the auditor recovers it as
# sk_aud*R_e = sk_aud*r_e*H = r_e*(sk_aud*H) = r_e*K_aud. The Pedersen value-
# generator G is NOT of the form sk*H (its DLOG base H is unknown), so a G
# auditor key would make the auditor ECDH channel structurally undecryptable.
# H is the lib's second Pedersen generator (index 1), i.e. 1*H. ---
AUDITOR_PK=054aa86a73cb8a34525e5bbed6e43ba1198e860f5f3950268f71df4591bde402209dcfbf2cfb57f9f6046f44d71ac6faf87254afc7407c04eb621a6287cac126
AUDITOR_ID=0

# =============================================================================
# 0. Toolchain + network
# =============================================================================
log "stellar CLI: $(stellar --version | head -1)"
# The OZ README asks for >= 28.1.0 for `stellar contract build`. We verified
# this machine's 27.0.0 builds all 6 OZ example wasms AND deploys/invokes on
# testnet (VK binary-file registration included). 27.0.0 is NOT a blocker here.
rustup target add wasm32v1-none >/dev/null 2>&1 || true
stellar network use "$NET" >/dev/null

# =============================================================================
# 1. Keypairs (friendbot-funded)
# =============================================================================
ensure_key() {
  local name="$PFX-$1"
  if ! stellar keys address "$name" >/dev/null 2>&1; then
    log "generate + fund key $name"
    stellar keys generate "$name" --network "$NET" --fund >/dev/null
  else
    # top up in case it existed but is low
    stellar keys fund "$name" --network "$NET" >/dev/null 2>&1 || true
  fi
  stellar keys address "$name"
}

log "Keypairs"
FEEPAYER_ADDR=$(ensure_key feepayer)
ADMIN_ADDR=$(ensure_key admin)
ISSUER_ADDR=$(ensure_key issuer)
ALICE_ADDR=$(ensure_key alice)
BOB_ADDR=$(ensure_key bob)
echo "feepayer=$FEEPAYER_ADDR admin=$ADMIN_ADDR issuer=$ISSUER_ADDR alice=$ALICE_ADDR bob=$BOB_ADDR"

# =============================================================================
# 2. Build wasms (our two + the 6 OZ examples)
# =============================================================================
log "Build our contracts (rtFUND, wsFUND)"
( cd "$ROOT/contracts" \
  && stellar contract build --package mock-rebasing-rwa >/dev/null \
  && stellar contract build --package share-wrapper >/dev/null )

# Hash-pin OUR contracts: the sha256 of the built wasm is exactly the hash the
# network stores on install, so recording it makes the deploy reproducible and
# auditable (compare against `stellar contract info hash --id <id>`).
sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
RTFUND_WASM_HASH=$(sha256_of "$OUR_WASM_DIR/mock_rebasing_rwa.wasm")
WSFUND_WASM_HASH=$(sha256_of "$OUR_WASM_DIR/share_wrapper.wasm")
echo "  rtFUND wasm sha256=$RTFUND_WASM_HASH"
echo "  wsFUND wasm sha256=$WSFUND_WASM_HASH"

log "Build OZ examples (verifier auditor allowlist-policy compliant-token factory)"
for ex in verifier auditor allowlist-policy compliant-token factory; do
  ( cd "$REF" && stellar contract build --package "confidential-$ex-example" >/dev/null )
done

# helper: deploy a contract only if the alias is not already set; echo its id
deploy_once() {
  local alias="$PFX-$1"; shift
  local wasm="$1"; shift
  if stellar contract alias show "$alias" >/dev/null 2>&1; then
    stellar contract alias show "$alias"
    return 0
  fi
  stellar contract deploy --alias "$alias" --source "$PFX-feepayer" --network "$NET" \
    --wasm "$wasm" -- "$@" | tail -1
}

# =============================================================================
# 3. rtFUND — our rebasing RWA
# =============================================================================
log "Deploy rtFUND (mock-rebasing-rwa)"
RTFUND=$(deploy_once rtfund "$OUR_WASM_DIR/mock_rebasing_rwa.wasm" \
  --admin "$PFX-issuer" --decimals 7 --name "Rebasing Treasury Fund" --symbol rtFUND)
echo "rtFUND=$RTFUND"

# =============================================================================
# 4. wsFUND — our novel non-rebasing wrapper over rtFUND
# =============================================================================
log "Deploy wsFUND (share-wrapper), underlying = rtFUND"
WSFUND=$(deploy_once wsfund "$OUR_WASM_DIR/share_wrapper.wasm" \
  --underlying "$RTFUND" --admin "$PFX-admin")
echo "wsFUND=$WSFUND"

# =============================================================================
# 5. verifier + 6 VKs  (OZ, as-is)
# =============================================================================
log "Deploy verifier"
VERIFIER=$(deploy_once verifier "$WASM_DIR/confidential_verifier_example.wasm" \
  --admin "$PFX-admin" --manager "$PFX-admin")
echo "verifier=$VERIFIER"

register_vk() {
  # Idempotent: each circuit accepts exactly one registration; swallow re-reg.
  local name=$1 ct=$2
  if stellar contract invoke --id "$PFX-verifier" --source "$PFX-admin" --network "$NET" \
      -- get_verification_key --circuit_type "$ct" >/dev/null 2>&1; then
    echo "  vk $name ($ct) already registered"
    return 0
  fi
  stellar contract invoke --id "$PFX-verifier" --source "$PFX-admin" --network "$NET" \
    -- register_verification_key --circuit_type "$ct" \
    --verification_key-file-path "$VKS/$name.vk.bin" --operator "$PFX-admin" >/dev/null
  echo "  vk $name ($ct) registered"
}
log "Register the 6 pinned VKs"
register_vk register 0
register_vk withdraw 1
register_vk transfer 2
register_vk spender_transfer 3
register_vk set_spender 4
register_vk clawback 100

# =============================================================================
# 6. auditor + Grumpkin generator key  (OZ, as-is)
# =============================================================================
log "Deploy auditor"
AUDITOR=$(deploy_once auditor "$WASM_DIR/confidential_auditor_example.wasm" \
  --admin "$PFX-admin" --manager "$PFX-admin")
echo "auditor=$AUDITOR"

if ! stellar contract invoke --id "$PFX-auditor" --source "$PFX-admin" --network "$NET" \
    -- get_key --auditor_id "$AUDITOR_ID" >/dev/null 2>&1; then
  log "Register auditor key (Grumpkin generator G — EXAMPLE sk=1)"
  stellar contract invoke --id "$PFX-auditor" --source "$PFX-admin" --network "$NET" \
    -- register_key --auditor_id "$AUDITOR_ID" --point "$AUDITOR_PK" --operator "$PFX-admin" >/dev/null
fi

# =============================================================================
# 7. factory (pins token + allowlist wasm hashes)  (OZ, as-is)
# =============================================================================
log "Upload token + allowlist wasms"
TOKEN_WASM_HASH=$(stellar contract upload --source "$PFX-feepayer" --network "$NET" \
  --wasm "$WASM_DIR/confidential_compliant_token_example.wasm")
ALLOWLIST_WASM_HASH=$(stellar contract upload --source "$PFX-feepayer" --network "$NET" \
  --wasm "$WASM_DIR/confidential_allowlist_policy_example.wasm")
echo "token_wasm_hash=$TOKEN_WASM_HASH"
echo "allowlist_wasm_hash=$ALLOWLIST_WASM_HASH"

log "Deploy factory"
FACTORY=$(deploy_once factory "$WASM_DIR/confidential_factory_example.wasm" \
  --token_wasm_hash "$TOKEN_WASM_HASH" --allowlist_wasm_hash "$ALLOWLIST_WASM_HASH")
echo "factory=$FACTORY"

# =============================================================================
# 8. allowlist-policy + compliant-token via the factory (underlying = wsFUND)
# =============================================================================
SALT=0
log "Predict allowlist + token addresses (salt=$SALT)"
ALLOWLIST_ADDR=$(stellar contract invoke --id "$PFX-factory" --source "$PFX-feepayer" --network "$NET" \
  -- predict_allowlist_address --admin "$PFX-admin" --manager "$PFX-admin" --salt "$SALT" | tr -d '"')
TOKEN_ADDR=$(stellar contract invoke --id "$PFX-factory" --source "$PFX-feepayer" --network "$NET" \
  -- predict_token_address \
  --admin "$PFX-admin" --underlying_asset "$WSFUND" --verifier "$VERIFIER" --auditor "$AUDITOR" \
  --compliance "{\"policy\": \"$ALLOWLIST_ADDR\", \"sac_passthrough\": false}" --salt "$SALT" | tr -d '"')
echo "predicted allowlist=$ALLOWLIST_ADDR token=$TOKEN_ADDR"

if ! stellar contract alias show "$PFX-allowlist" >/dev/null 2>&1; then
  log "deploy_allowlist_and_token (sac_passthrough=false; wsFUND is plain SEP-41, not a SAC)"
  stellar contract invoke --id "$PFX-factory" --source "$PFX-admin" --network "$NET" \
    -- deploy_allowlist_and_token \
    --policy_admin "$PFX-admin" --policy_manager "$PFX-admin" --token_admin "$PFX-admin" \
    --underlying_asset "$WSFUND" --verifier "$VERIFIER" --auditor "$AUDITOR" \
    --sac_passthrough false --salt "$SALT" >/dev/null
  stellar contract alias add allowlist --id "$ALLOWLIST_ADDR" --network "$NET" 2>/dev/null || true
  stellar contract alias add "$PFX-allowlist" --id "$ALLOWLIST_ADDR" --network "$NET"
  stellar contract alias add "$PFX-token" --id "$TOKEN_ADDR" --network "$NET"
else
  echo "allowlist/token already deployed"
fi
ALLOWLIST=$ALLOWLIST_ADDR
TOKEN=$TOKEN_ADDR
echo "allowlist=$ALLOWLIST token=$TOKEN"

log "Token compliance_config"
stellar contract invoke --id "$PFX-token" --source "$PFX-feepayer" --network "$NET" -- compliance_config || true

# =============================================================================
# 9. Grant token roles (freezer, config_manager, clawback) to admin
# =============================================================================
log "Grant token roles to admin"
for role in freezer config_manager clawback; do
  stellar contract invoke --id "$PFX-token" --source "$PFX-admin" --network "$NET" \
    -- grant_role --account "$PFX-admin" --role "$role" --caller "$PFX-admin" >/dev/null 2>&1 \
    && echo "  granted $role" || echo "  $role already granted / skipped"
done

# =============================================================================
# 10. Onboarding: allowlist alice (NOT bob). Mint rtFUND to alice.
# =============================================================================
log "Allowlist alice (bob intentionally NOT allowlisted)"
stellar contract invoke --id "$PFX-allowlist" --source "$PFX-admin" --network "$NET" \
  -- allow --account "$PFX-alice" --operator "$PFX-admin" >/dev/null
echo "  alice allowed:"
stellar contract invoke --id "$PFX-allowlist" --source "$PFX-feepayer" --network "$NET" \
  -- is_authorized --account "$PFX-alice" --token "$TOKEN"
echo "  bob allowed (expect false):"
stellar contract invoke --id "$PFX-allowlist" --source "$PFX-feepayer" --network "$NET" \
  -- is_authorized --account "$PFX-bob" --token "$TOKEN"

log "Mint rtFUND to alice (issuer)"
# rtFUND.mint takes RAW units; index starts at 1.0 so raw==reported initially.
stellar contract invoke --id "$PFX-rtfund" --source "$PFX-issuer" --network "$NET" \
  -- mint --to "$PFX-alice" --raw_amount 1000000000 >/dev/null
echo "  alice rtFUND balance:"
stellar contract invoke --id "$PFX-rtfund" --source "$PFX-feepayer" --network "$NET" \
  -- balance --id "$PFX-alice"

# =============================================================================
# 11. Record everything
# =============================================================================
log "Write $OUT"
cat > "$OUT" <<JSON
{
  "network": "$NET",
  "network_passphrase": "Test SDF Network ; September 2015",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "underlying of the confidential token is wsFUND (plain SEP-41, NOT a SAC); sac_passthrough=false so the allowlist-policy is the sole on-chain eligibility gate. The auditor key is the Grumpkin generator G (sk=1) — EXAMPLE ONLY, publicly decryptable.",
  "accounts": {
    "feepayer": "$FEEPAYER_ADDR",
    "admin": "$ADMIN_ADDR",
    "issuer": "$ISSUER_ADDR",
    "alice": "$ALICE_ADDR",
    "bob": "$BOB_ADDR"
  },
  "key_aliases": {
    "feepayer": "$PFX-feepayer",
    "admin": "$PFX-admin",
    "issuer": "$PFX-issuer",
    "alice": "$PFX-alice",
    "bob": "$PFX-bob"
  },
  "contracts": {
    "rtFUND": "$RTFUND",
    "wsFUND": "$WSFUND",
    "verifier": "$VERIFIER",
    "auditor": "$AUDITOR",
    "factory": "$FACTORY",
    "allowlist_policy": "$ALLOWLIST",
    "compliant_token": "$TOKEN"
  },
  "wasm_hashes": {
    "rtFUND": "$RTFUND_WASM_HASH",
    "wsFUND": "$WSFUND_WASM_HASH",
    "compliant_token": "$TOKEN_WASM_HASH",
    "allowlist_policy": "$ALLOWLIST_WASM_HASH"
  },
  "wasm_hashes_note": "sha256 of each built WASM == the hash deployed on-chain (verify live: stellar contract info hash --id <id> --network testnet). rtFUND=mock_rebasing_rwa.wasm, wsFUND=share_wrapper.wasm.",
  "ours": ["rtFUND", "wsFUND"],
  "oz_as_is": ["verifier", "auditor", "factory", "allowlist_policy", "compliant_token"],
  "auditor_id": $AUDITOR_ID,
  "vks_registered": ["register:0","withdraw:1","transfer:2","spender_transfer:3","set_spender:4","clawback:100"]
}
JSON

# =============================================================================
# 12. Verify OUR contracts are hash-pinned: built sha256 == live on-chain hash
# =============================================================================
log "Verify hash-pin (built wasm sha256 == on-chain wasm hash) for rtFUND, wsFUND"
verify_pin() {
  local name="$1" id="$2" built="$3"
  local onchain
  onchain=$(stellar contract info hash --id "$id" --network "$NET" 2>/dev/null | tail -1)
  if [ "$onchain" = "$built" ]; then
    echo "  OK $name: $built (matches on-chain)"
  else
    echo "  MISMATCH $name: built=$built on-chain=$onchain" >&2
    return 1
  fi
}
verify_pin rtFUND "$RTFUND" "$RTFUND_WASM_HASH"
verify_pin wsFUND "$WSFUND" "$WSFUND_WASM_HASH"

log "DONE. Contract IDs:"
jq '.contracts' "$OUT"
