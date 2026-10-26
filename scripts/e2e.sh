#!/usr/bin/env bash
# =============================================================================
# e2e.sh — Full demo flow against the LIVE testnet deployment.
#
# Reads contract ids from deployments/testnet.json (run scripts/deploy.sh first).
#
# Demonstrates, with on-chain assertions:
#
#   PART A — ShareWrapper yield (OUR novelty; fully real, succeeds):
#     A1. alice deposits rtFUND -> wsFUND (non-rebasing shares)
#     A2. issuer accrues interest on rtFUND (rebase)
#     A3. alice's wsFUND SHARE balance is UNCHANGED, but exchange_rate GROWS
#         (this stable share count is exactly what the confidential token would
#          encrypt — yield surfaces as a public rate, not a balance change)
#     A4. alice redeems her shares for MORE rtFUND than she deposited
#
#   PART B — Confidential suite, end-to-end (real crypto; on-chain):
#     B1. confidential `register` for BOB (NOT allowlisted) is REJECTED on-chain
#         by the allowlist policy  ->  Error(Contract,#3602) NotAuthorizedByPolicy
#         (eligibility enforced ON the confidential token, not in UI).
#     B2. confidential `register` for ALICE (allowlisted) SUCCEEDS: a REAL,
#         CONTRACT-BOUND UltraHonk proof is accepted by the on-chain verifier
#         and a ConfidentialAccount is written (spending/viewing public keys
#         on-chain). Proof built by scripts/make_register.sh, which derives
#         addr_f=address_to_field(token) and acct_f=address_to_field(alice)
#         with the EXACT OZ lib, so the token reassembles the identical public
#         inputs and verification passes. Idempotent: skipped if already
#         registered.
#     B3. alice makes a CONFIDENTIAL DEPOSIT (wsFUND -> confidential balance).
#         A real non-identity Pedersen commitment (amount*G) is committed
#         on-chain as receiving_commitment — the hidden balance.
#     B4. AUDITOR / regulator DECRYPT: recompute total*G with the OZ Pedersen
#         gadget (scripts/commit_point.sh) and assert it equals the on-chain
#         receiving_commitment — recovering alice's true hidden balance.
#
# HONESTY: the register proof is the REAL 14592-byte UltraHonk proof emitted by
# circuits/prove.sh (nargo 1.0.0-beta.11 + bb 0.87.0, keccak oracle) for a
# witness bound to alice's LIVE address and the LIVE token contract (not the
# 0xbeef fixture). Confidential deposit uses zero blinding (OZ: c_dep = a*G),
# so the auditor "decrypt" here is an exact point recomputation, not an ECDH
# channel — honest and sufficient to recover a real on-chain balance. A
# confidential *transfer* proof (ECDH ciphertexts from live balance openings)
# still needs the OZ confidential SDK and is NOT fabricated here.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEPLOY="$ROOT/deployments/testnet.json"
NET=testnet
PROOF_HEX="$ROOT/out/register/proof.hex"

[ -f "$DEPLOY" ] || { echo "missing $DEPLOY — run scripts/deploy.sh first" >&2; exit 1; }
[ -f "$PROOF_HEX" ] || { echo "missing $PROOF_HEX — run scripts/prove register ... first" >&2; exit 1; }

j() { jq -r "$1" "$DEPLOY"; }
RT=$(j '.contracts.rtFUND'); WS=$(j '.contracts.wsFUND')
TOKEN=$(j '.contracts.compliant_token'); ALLOWLIST=$(j '.contracts.allowlist_policy')
AUDITOR=$(j '.contracts.auditor'); AUD_ID=$(j '.auditor_id')
ALICE=$(j '.key_aliases.alice'); BOB=$(j '.key_aliases.bob')
ISSUER=$(j '.key_aliases.issuer'); FP=$(j '.key_aliases.feepayer')

RATE_ONE=10000000
PASS=0; FAIL=0
ok()   { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
hdr()  { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

# read-only invoke -> trimmed scalar
call() { stellar contract invoke --id "$1" --source "$FP" --network "$NET" -- "${@:2}" 2>/dev/null | tr -d '"'; }
# state-changing invoke by a signer; returns full combined output
send() { stellar contract invoke --id "$1" --source "$2" --network "$NET" -- "${@:3}" 2>&1; }

# =============================================================================
hdr "PART A — ShareWrapper yield (OUR novelty)"

# Use a fresh deposit each run so e2e is re-runnable; assert against deltas.
DEP=300000000

bal_rt_before=$(call "$RT" balance --id "$ALICE")
echo "  alice rtFUND before deposit: $bal_rt_before"

hdr "A1. alice deposits $DEP rtFUND -> wsFUND"
minted_line=$(send "$WS" "$ALICE" deposit --from "$ALICE" --underlying_amount "$DEP" | grep -o '"deposit"[^]]*' | head -1 || true)
shares=$(call "$WS" balance --id "$ALICE")
echo "  alice wsFUND shares now: $shares"
[ "$shares" -gt 0 ] && ok "deposit minted shares ($shares)" || bad "no shares minted"

rate1=$(call "$WS" exchange_rate)
under1=$(call "$WS" total_underlying)
echo "  exchange_rate=$rate1  total_underlying=$under1"

hdr "A2. issuer accrues +500 bps (5%) on rtFUND"
accrue_out=$(send "$RT" "$ISSUER" accrue --bps 500 || true)
if echo "$accrue_out" | grep -qiE '"accrue"|accrue.*u32.*500|Success'; then
  ok "accrue submitted"
else
  bad "accrue failed"; echo "$accrue_out" | grep -iE "error" | head -1
fi

hdr "A3. share balance stable, value grows"
shares2=$(call "$WS" balance --id "$ALICE")
rate2=$(call "$WS" exchange_rate)
under2=$(call "$WS" total_underlying)
echo "  shares: $shares -> $shares2   rate: $rate1 -> $rate2   underlying: $under1 -> $under2"
[ "$shares2" = "$shares" ] && ok "share balance UNCHANGED across accrual ($shares2)" || bad "share balance changed!"
[ "$rate2" -gt "$rate1" ] && ok "exchange_rate GREW ($rate1 -> $rate2)" || bad "rate did not grow"

hdr "A4. alice redeems all shares for MORE rtFUND than deposited"
redeem_out=$(send "$WS" "$ALICE" redeem --from "$ALICE" --shares "$shares2")
echo "$redeem_out" | grep -q "Success" || bad "redeem failed"
bal_rt_after=$(call "$RT" balance --id "$ALICE")
# underlying returned = after - (before - deposited)
got_back=$(( bal_rt_after - (bal_rt_before - DEP) ))
echo "  alice rtFUND after redeem: $bal_rt_after   (returned ~$got_back for $DEP deposited)"
[ "$got_back" -gt "$DEP" ] && ok "redeemed MORE than deposited (+$((got_back-DEP)) = private yield)" \
                           || bad "did not get yield ($got_back <= $DEP)"

# =============================================================================
hdr "PART B — Confidential suite, end-to-end (real crypto, on-chain)"

ID_HEX_ZERO="0000000000000000000000000000000000000000000000000000000000000000"
# receiving_commitment identity encoding (64 bytes of 0).
IDENTITY64="${ID_HEX_ZERO}${ID_HEX_ZERO}"

if [ ! -d "$HERE/node_modules/@stellar/stellar-sdk" ]; then
  echo "  installing @stellar/stellar-sdk into scripts/ ..."
  ( cd "$HERE" && npm install --silent @stellar/stellar-sdk >/dev/null 2>&1 )
fi

# Read a field of confidential_balance for an account. The CLI prints a
# JSON-ish map with unquoted hex values; extract with a field-scoped regex.
conf_field() {
  stellar contract invoke --id "$TOKEN" --source "$FP" --network "$NET" -- \
    confidential_balance --account "$1" 2>/dev/null \
  | node -e '
      const d=require("fs").readFileSync(0,"utf8");
      const f=process.argv[1];
      const m=d.match(new RegExp("\"?"+f+"\"?\\s*:\\s*\"?([0-9a-fA-F]+)\"?"));
      process.stdout.write(m?m[1]:"");
    ' "$2"
}

hdr "Build REAL contract-bound register proof for ALICE"
REG_DIR="$ROOT/out/register_alice"
if [ ! -f "$REG_DIR/register.json" ]; then
  echo "  generating (make_register.sh) ..."
  bash "$HERE/make_register.sh" "$TOKEN" "$ALICE" "$REG_DIR" >/dev/null
fi
REG_PROOF_HEX="$REG_DIR/proof.hex"
DATA_ALICE=$(node "$HERE/build_register_data.mjs" "$REG_PROOF_HEX" "$REG_DIR/register.json")
echo "  alice envelope: $(( ${#DATA_ALICE} / 2 )) bytes (real contract-bound Y/PVK + 14592-byte proof)"
# A throwaway envelope for bob's reject (policy gate fires before any proof check).
DATA_BOB=$(node "$HERE/build_register_data.mjs" "$PROOF_HEX")

hdr "B1. confidential register for BOB (NOT allowlisted) — expect reject #3602"
echo "  allowlist.is_authorized(bob): $(call "$ALLOWLIST" is_authorized --account "$BOB" --token "$TOKEN")"
out_bob=$(send "$TOKEN" "$BOB" register --account "$BOB" --auditor_id "$AUD_ID" --data "$DATA_BOB" || true)
if echo "$out_bob" | grep -q "Error(Contract, #3602)"; then
  ok "bob's register REJECTED on-chain by policy (NotAuthorizedByPolicy #3602)"
else
  bad "expected #3602 for bob; got:"; echo "$out_bob" | grep -iE "Error\(Contract" | head -1
fi

hdr "B2. confidential register for ALICE (allowlisted) — REAL proof accepted on-chain"
echo "  allowlist.is_authorized(alice): $(call "$ALLOWLIST" is_authorized --account "$ALICE" --token "$TOKEN")"
spk=$(conf_field "$ALICE" spending_public_key)
if [ -n "$spk" ] && [ "$spk" != "$IDENTITY64" ]; then
  ok "alice already registered (idempotent) — on-chain spending_public_key=${spk:0:16}..."
else
  out_alice=$(send "$TOKEN" "$ALICE" register --account "$ALICE" --auditor_id "$AUD_ID" --data "$DATA_ALICE" || true)
  if echo "$out_alice" | grep -q "Event: Register"; then
    ok "alice REGISTERED on-chain — REAL UltraHonk proof ACCEPTED by verifier"
  else
    bad "alice register failed:"; echo "$out_alice" | grep -iE "Error\(Contract|verify_proof" | head -1
  fi
  spk=$(conf_field "$ALICE" spending_public_key)
fi
exp_spk=$(node -e 'const r=require(process.argv[1]);const s=h=>h.replace(/^0x/,"").padStart(64,"0");process.stdout.write(s(r.y_x)+s(r.y_y))' "$REG_DIR/register.json")
[ "$spk" = "$exp_spk" ] && ok "on-chain spending_public_key == our derived Y (proof bound to alice)" \
                        || bad "spending_public_key mismatch (on=$spk exp=$exp_spk)"

hdr "B3. alice CONFIDENTIAL DEPOSIT — commit a hidden balance (Pedersen) on-chain"
# Deposit exactly the B6 transfer amount (XFER=4e8) so each run's net confidential
# flow is zero: alice's spendable balance stays constant run-to-run, keeping the
# flow re-runnable indefinitely without her spendable drifting out of the
# reconcile grid (prep_reconcile walks v up to 30*1e8).
CONF_DEP=400000000
# ensure alice has >= CONF_DEP wsFUND shares to deposit confidentially. wsFUND
# shares are fewer than rtFUND when the exchange rate > 1, so size the rtFUND
# deposit by the live rate (rate scaled by 1e7) with headroom.
ws_bal=$(call "$WS" balance --id "$ALICE")
if [ "${ws_bal:-0}" -lt "$CONF_DEP" ]; then
  rate=$(call "$WS" exchange_rate)
  need=$(( CONF_DEP - ${ws_bal:-0} ))
  rt_needed=$(( need * rate / RATE_ONE + 20000000 ))   # + headroom
  # Ensure alice holds enough rtFUND to wrap (repeated runs + accrual drain her);
  # top her up from the issuer (rtFUND admin) so e2e is re-runnable.
  rt_bal=$(call "$RT" balance --id "$ALICE")
  if [ "${rt_bal:-0}" -lt "$rt_needed" ]; then
    echo "  minting rtFUND to alice (issuer): raw 50000000000"
    send "$RT" "$ISSUER" mint --to "$ALICE" --raw_amount 50000000000 >/dev/null
  fi
  echo "  topping up alice wsFUND: deposit $rt_needed rtFUND -> wsFUND (rate=$rate)"
  send "$WS" "$ALICE" deposit --from "$ALICE" --underlying_amount "$rt_needed" >/dev/null
  ws_bal=$(call "$WS" balance --id "$ALICE")
  echo "  alice wsFUND now: $ws_bal"
fi
rc_before=$(conf_field "$ALICE" receiving_commitment)
# cumulative confidential total across runs (so the auditor-decrypt check is exact)
TOTAL_FILE="$REG_DIR/conf_total"
prev_total=$( [ -f "$TOTAL_FILE" ] && cat "$TOTAL_FILE" || echo 0 )
dep_out=$(send "$TOKEN" "$ALICE" deposit --from "$ALICE" --to "$ALICE" --amount "$CONF_DEP" || true)
echo "$dep_out" | grep -q "Event: Deposit" && ok "confidential deposit succeeded (Deposit event)" \
                                           || bad "confidential deposit failed"
rc_after=$(conf_field "$ALICE" receiving_commitment)
new_total=$(( prev_total + CONF_DEP ))
echo "$new_total" > "$TOTAL_FILE"
echo "  receiving_commitment: ${rc_before:0:16}... -> ${rc_after:0:16}..."
[ "$rc_after" != "$IDENTITY64" ] && ok "on-chain receiving_commitment is a REAL non-identity Pedersen commitment" \
                                 || bad "receiving_commitment is identity (no hidden balance committed)"

hdr "B4. AUDITOR / regulator DECRYPT — recover alice's true hidden balance"
echo "  cumulative confidential balance (plaintext, known to regulator): $new_total"
expect_commit=$(bash "$HERE/commit_point.sh" "$new_total")
echo "  recomputed  ${new_total}*G = ${expect_commit:0:16}..."
echo "  on-chain commitment       = ${rc_after:0:16}..."
if [ "$expect_commit" = "$rc_after" ]; then
  ok "auditor DECRYPTED alice's balance: on-chain commitment == ${new_total}*G (regulator view)"
else
  bad "auditor decrypt mismatch (expected ${new_total}*G != on-chain commitment)"
fi

hdr "B5. auditor (regulator) key present for selective disclosure"
aud_key=$(call "$AUDITOR" get_key --auditor_id "$AUD_ID")
echo "  auditor_id=$AUD_ID key=${aud_key:0:16}..."
[ -n "$aud_key" ] && ok "auditor key registered" || bad "no auditor key"

# =============================================================================
# B6 — REAL confidential TRANSFER alice -> carol (hidden amount), with the
# witness built by OURSELVES (scripts/make_transfer.sh + circuits/prep_transfer,
# mirroring circuit_transfer::main) — the piece the spec-only OZ SDK would emit.
#
# Asserts, all ON-CHAIN:
#   * carol is eligible (allowlisted + confidentially registered, real proof);
#   * the transfer tx SUCCEEDS (real 14592-byte UltraHonk proof accepted by the
#     on-chain verifier against the token-reassembled 25-field public inputs);
#   * alice's new spendable_commitment and carol's receiving_commitment are
#     non-identity Pedersen points, and NEITHER equals amount*G (the amount is
#     genuinely hidden behind a non-zero blinding — not plaintext on-chain);
#   * the auditor (sk_aud=1, K_aud=H) DECRYPTS BOTH per-transfer channels to the
#     SAME hidden transfer amount, and recovers alice's new balance;
#   * a transfer to a NON-eligible user (bob) is REJECTED on-chain.
# =============================================================================
CAROL=$(j '.key_aliases.carol'); CAROL_ADDR=$(j '.accounts.carol')
ALICE_ADDR=$(j '.accounts.alice')
# Grumpkin H = 1*H, the rotated auditor key (sk_aud=1). Must match get_key above.
AUD_H="054aa86a73cb8a34525e5bbed6e43ba1198e860f5f3950268f71df4591bde402209dcfbf2cfb57f9f6046f44d71ac6faf87254afc7407c04eb621a6287cac126"
XFER=400000000     # hidden transfer amount alice -> carol
SENDER_SK="0x2a"   # alice's confidential spending secret (from make_register.sh)
ST_DIR="$ROOT/out/transfer_state"; mkdir -p "$ST_DIR"
AC_DIR="$ROOT/out/transfer_ac"

hdr "B6. REAL confidential transfer alice -> carol ($XFER HIDDEN), auditor-decryptable"

# carol must be eligible: allowlisted + confidentially registered.
echo "  allowlist.is_authorized(carol): $(call "$ALLOWLIST" is_authorized --account "$CAROL" --token "$TOKEN")"
carol_spk=$(conf_field "$CAROL" spending_public_key)
if [ -n "$carol_spk" ] && [ "$carol_spk" != "$IDENTITY64" ]; then
  ok "carol is eligible (allowlisted + confidentially registered on-chain)"
else
  bad "carol not registered — run: scripts/make_register.sh <token> <carol> out/register_carol 0x2b && register on-chain"
fi
CAROL_PVK=$(conf_field "$CAROL" viewing_public_key)
# verify the auditor key the token will load == H (so our ciphertexts decrypt).
onchain_aud=$(call "$AUDITOR" get_key --auditor_id "$AUD_ID")
[ "$onchain_aud" = "$AUD_H" ] && ok "on-chain auditor key == H (sk_aud=1, decryptable)" \
                              || bad "auditor key != H — rotate auditor_id $AUD_ID to H (scripts/deploy.sh AUDITOR_PK)"

# -----------------------------------------------------------------------------
# RE-SEED alice's spendable opening (v, r) FROM CHAIN — the re-runnability fix.
#
# The transfer witness's T3 constraint requires C_spend == alice's LIVE on-chain
# spendable_commitment. A cached opening in out/transfer_state desyncs the
# moment a prior transfer moved her on-chain balance (or a prior run failed
# mid-flight), producing an unsatisfiable witness and Error(Contract,#3506).
#
# So we do NOT trust the cache. We read the LIVE spendable_commitment and
# reconcile the opening that actually opens it (reconcile_spendable.sh walks the
# deterministic v-grid at r ∈ {0, derive_spend_r(vk, SIGMA)} in one circuit run
# — the only states this e2e can reach). The cache is passed only as telemetry.
# This makes the transfer succeed from ANY current on-chain state.
# -----------------------------------------------------------------------------
SIGMA_X="0x9"                     # FIXED sigma -> post-transfer blinding is deterministic/reconcilable
ALICE_VK="0x179835ffc2237e78c6bcee7ce26fedbb5dfc18cd66d7a16216889043a67f40bb"  # vk_from_sk(0x2a, addr_f(token))
spend_v_file="$ST_DIR/alice_spend_v"; spend_r_file="$ST_DIR/alice_spend_r"
cached_v=$( [ -f "$spend_v_file" ] && cat "$spend_v_file" || echo "(none)" )

# receiving holds the B3 zero-blinding deposit (plaintext new_total, verified in
# B4). merge folds it into spendable, preserving the blinding and adding its
# plaintext to v. Read the PRE-merge spendable and reconcile its opening.
recv_plain=$new_total
alice_spend_premerge=$(conf_field "$ALICE" spendable_commitment)
echo "  re-seeding alice spendable opening from chain (cache hint v=$cached_v, NOT trusted)"
echo "    live pre-merge spendable_commitment = ${alice_spend_premerge:-<empty/identity>}:0:16..."
if recon=$(bash "$HERE/reconcile_spendable.sh" "${alice_spend_premerge:-0}" "$ALICE_VK" "$SIGMA_X" 2>"$AC_DIR/reconcile.log"); then
  read -r rec_v rec_r <<<"$recon"
  ok "re-seeded alice spendable opening FROM CHAIN: v=$rec_v r=$([ "$rec_r" = 0 ] && echo 0 || echo "${rec_r:0:14}...")"
  if [ "$cached_v" != "$rec_v" ]; then
    echo "    (self-heal: cached v=$cached_v DIVERGED from chain v=$rec_v — using chain-derived opening)"
  fi
else
  bad "could not reconcile alice's on-chain spendable opening (see $AC_DIR/reconcile.log)"
  rec_v=0; rec_r=0
fi

echo "  merging alice receiving ($recv_plain, zero-blinding) into spendable (reconciled pre-merge v=$rec_v)"
merge_out=$(send "$TOKEN" "$ALICE" merge --account "$ALICE" || true)
echo "$merge_out" | grep -q "Event: Merge" && ok "alice merge: receiving -> spendable" || bad "merge failed"
# receiving is now identity; reset the B3/B4 cumulative so the NEXT run starts clean.
echo 0 > "$TOTAL_FILE"
# merge preserves the blinding and adds the zero-blinding deposit's plaintext.
spend_v=$(( rec_v + recv_plain ))
spend_r="$rec_r"
echo "  alice spendable opening now (post-merge, chain-reconciled): v=$spend_v r=$([ "$spend_r" = 0 ] && echo 0 || echo "${spend_r:0:14}...")"
[ "$spend_v" -ge "$XFER" ] || bad "alice spendable $spend_v < transfer $XFER"

# Verify the reconciled+merged opening reproduces the LIVE post-merge spendable
# BEFORE we spend real proof time — this is the exact T3 relation the circuit
# enforces; if it fails here, the witness would be unsatisfiable (#3506).
alice_spend_postmerge=$(conf_field "$ALICE" spendable_commitment)
recomputed_spend=$(bash "$HERE/commit_vr.sh" "$spend_v" "${spend_r:-0}")
if [ "$recomputed_spend" = "$alice_spend_postmerge" ]; then
  ok "reconciled opening MATCHES live on-chain spendable (commit(v,r)==chain; witness T3 will hold)"
else
  bad "reconciled opening does NOT match on-chain spendable — refusing to build an unsatisfiable witness"
  echo "    commit(v=$spend_v,r)=${recomputed_spend:0:16}...  on-chain=${alice_spend_postmerge:0:16}..."
fi

# Build the REAL transfer witness + proof + payload (we emit it ourselves).
# FIXED sigma=$SIGMA_X so the new spendable blinding is reconcilable next run.
echo "  building transfer witness/proof (prep_transfer + prove.sh transfer) ..."
bash "$HERE/make_transfer.sh" "$TOKEN" "$ALICE_ADDR" "$CAROL_ADDR" "$spend_v" "$XFER" \
     "$SENDER_SK" "$CAROL_PVK" "$AUD_H" "$AC_DIR" "$SIGMA_X" 0x$(openssl rand -hex 6) "$spend_r" \
     >"$AC_DIR/make.log" 2>&1 \
  && ok "real 14592-byte transfer proof generated (keccak oracle, non-zk)" \
  || { bad "make_transfer failed (see $AC_DIR/make.log)"; tail -3 "$AC_DIR/make.log"; }

# Record alice & carol commitments BEFORE the transfer.
alice_spend_before=$(conf_field "$ALICE" spendable_commitment)
carol_recv_before=$(conf_field "$CAROL" receiving_commitment)

# B6a — transfer to NON-eligible bob must REJECT on-chain.
DATA_X=$(node "$HERE/build_transfer_data.mjs" "$AC_DIR/proof.hex" "$AC_DIR/transfer.json")
echo "  B6a: confidential_transfer alice -> BOB (NOT eligible) — expect reject"
out_bob=$(send "$TOKEN" "$ALICE" confidential_transfer --from "$ALICE" --to "$BOB" --data "$DATA_X" || true)
if echo "$out_bob" | grep -qE "Error\(Contract, #3(60[0-9]|5[0-9][0-9])\)"; then
  ok "transfer to NON-eligible bob REJECTED on-chain ($(echo "$out_bob" | grep -oE 'Error\(Contract, #[0-9]+\)' | head -1))"
else
  bad "expected reject for bob; got:"; echo "$out_bob" | grep -iE "Error\(Contract|Success" | head -1
fi

# -----------------------------------------------------------------------------
# B6b — the real transfer to eligible carol must SUCCEED **ON-CHAIN**.
# HONEST gating: B6b passes only if the tx emits a Transfer event AND both
# commitments actually moved on-chain this run AND alice's new spendable equals
# commit(v_new, derive_spend_r(vk, SIGMA)). TRANSFER_LANDED gates B6c — the
# auditor-decrypt assert must NOT pass off local witness data if the on-chain
# transfer did not land.
# -----------------------------------------------------------------------------
TRANSFER_LANDED=0
echo "  B6b: confidential_transfer alice -> carol (eligible)"
out_x=$(send "$TOKEN" "$ALICE" confidential_transfer --from "$ALICE" --to "$CAROL" --data "$DATA_X" || true)
xfer_event=0
echo "$out_x" | grep -q "Event: Transfer" && xfer_event=1

alice_spend_after=$(conf_field "$ALICE" spendable_commitment)
carol_recv_after=$(conf_field "$CAROL" receiving_commitment)
xfer_times_g=$(bash "$HERE/commit_point.sh" "$XFER")

# The exact on-chain spendable alice MUST have after a successful transfer:
# commit(v_new, R_FIXED) with v_new = spend_v - XFER, R_FIXED the fixed-sigma blinding.
exp_new=$(( spend_v - XFER ))
R_FIXED=$(bash "$HERE/derive_spend_r.sh" "$ALICE_VK" "$SIGMA_X")
exp_spend_after=$(bash "$HERE/commit_vr.sh" "$exp_new" "$R_FIXED")

alice_moved=0; [ -n "$alice_spend_after" ] && [ "$alice_spend_after" != "$IDENTITY64" ] && [ "$alice_spend_after" != "$alice_spend_before" ] && alice_moved=1
carol_moved=0; [ -n "$carol_recv_after" ] && [ "$carol_recv_after" != "$IDENTITY64" ] && [ "$carol_recv_after" != "$carol_recv_before" ] && carol_moved=1
alice_exact=0; [ "$alice_spend_after" = "$exp_spend_after" ] && alice_exact=1

if [ "$xfer_event" = 1 ] && [ "$alice_moved" = 1 ] && [ "$carol_moved" = 1 ] && [ "$alice_exact" = 1 ]; then
  TRANSFER_LANDED=1
  ok "REAL confidential transfer LANDED ON-CHAIN (Transfer event; both commitments moved; alice new spendable == commit(v_new,R_fixed))"
else
  bad "B6b transfer did NOT land on-chain (event=$xfer_event alice_moved=$alice_moved carol_moved=$carol_moved alice_exact=$alice_exact)"
  echo "$out_x" | grep -iE "Error\(Contract" | head -1
fi

# These checks are only meaningful once the transfer landed.
if [ "$TRANSFER_LANDED" = 1 ]; then
  ok "alice spendable_commitment updated to a new non-identity Pedersen point"
  ok "carol receiving_commitment updated to a new non-identity Pedersen point"
  # the transfer commitment delta added to carol is C_transfer = v_t*G + r_t*H with
  # r_t != 0, so it is NOT the plaintext amount*G.
  c_transfer=$(node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(t.c_transfer)' "$AC_DIR/transfer.json")
  [ "$c_transfer" != "$xfer_times_g" ] \
    && ok "transfer commitment is HIDDEN (C_transfer != ${XFER}*G — non-zero blinding, amount not in plaintext)" \
    || bad "transfer commitment leaks plaintext amount"
else
  bad "skipping on-chain commitment-movement asserts — transfer did not land"
fi

hdr "B6c. AUDITOR decrypts BOTH channels to the hidden transfer amount"
# HONEST gating: only decrypt/assert if the on-chain transfer actually landed.
# Decrypting the locally-built witness ciphertexts while the chain did NOT move
# would be a dishonest pass — so if B6b failed, B6c FAILS too.
if [ "$TRANSFER_LANDED" != 1 ]; then
  bad "B6c SKIPPED/FAILED — on-chain transfer did not land, refusing to decrypt local-only witness as if it were a real transfer"
else
  dec=$(bash "$HERE/auditor_decrypt.sh" "$AC_DIR/transfer.json" 1 2>/dev/null)
  read -r v_recip v_sender v_new_dec <<<"$dec"
  echo "  auditor (sk_aud=1) recovered: recipient-channel=$v_recip  sender-channel=$v_sender  sender-new-balance=$v_new_dec"
  [ "$v_recip" = "$XFER" ]  && ok "auditor RECIPIENT channel decrypts to the hidden amount ($XFER)" \
                            || bad "recipient channel decrypt mismatch ($v_recip != $XFER)"
  [ "$v_sender" = "$XFER" ] && ok "auditor SENDER channel decrypts to the hidden amount ($XFER)" \
                            || bad "sender channel decrypt mismatch ($v_sender != $XFER)"
  [ "$v_new_dec" = "$exp_new" ] && ok "auditor recovers alice's new confidential balance ($exp_new)" \
                                || bad "new-balance decrypt mismatch ($v_new_dec != $exp_new)"

  # Persist alice's updated spendable opening ONLY after a confirmed on-chain
  # transfer (so the cache can never advance past chain). Next run re-derives it
  # from chain anyway; this is just a fast-path hint.
  node -e '
    const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const fs=require("fs");
    fs.writeFileSync(process.argv[2], t.openings.v_new);
    fs.writeFileSync(process.argv[3], t.openings.r_new);
  ' "$AC_DIR/transfer.json" "$spend_v_file" "$spend_r_file"
  echo "  persisted alice spendable opening hint for next run: v=$(cat "$spend_v_file") r=$(cut -c1-14 "$spend_r_file")..."
fi

# =============================================================================
hdr "SUMMARY"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  printf '\n\033[1;32mE2E GREEN\033[0m — ShareWrapper yield real & live; confidential register (real proof) + hidden Pedersen balance + auditor decrypt + eligibility reject, all on-chain.\n'
  exit 0
else
  printf '\n\033[1;31mE2E RED\033[0m\n'; exit 1
fi
