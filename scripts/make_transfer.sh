#!/usr/bin/env bash
# =============================================================================
# make_transfer.sh — produce a REAL confidential-transfer proof + payload for a
# LIVE testnet transfer sender -> recipient, so the OZ confidential token's
# `confidential_transfer` ACCEPTS it.
#
#   make_transfer.sh <token> <sender_addr> <recipient_addr> <v_sender> \
#                    <v_transfer> <sender_sk> <recipient_pvk_hex128> \
#                    <auditor_key_hex128> <out_dir> [sigma_hex] [r_e_hex] [r_sender]
#
# This is the piece the (spec-only) OZ confidential SDK would emit. We build
# the transfer witness ourselves by re-deriving EVERY field with the EXACT OZ
# lib (circuits/prep_transfer, which mirrors circuit_transfer::main's
# constraints T1..T_a9). Nothing is faked: the witness is genuinely
# constraint-satisfying, prove.sh produces the real 14592-byte UltraHonk proof,
# and the token reassembles the identical public-input blob.
#
# Preconditions the CALLER must guarantee (this script does NOT check chain
# state; e2e.sh does):
#   * sender is registered with spending secret `sender_sk` bound to this token
#     (addr_f = address_to_field(token)), and vk = vk_from_sk(sender_sk, addr_f).
#   * sender's on-chain `spendable_commitment` == commit(v_sender, r_sender).
#     For our zero-blinding deposits + merge, r_sender = 0 and
#     v_sender = total confidentially-deposited amount.
#   * recipient is registered; recipient_pvk = on-chain viewing_public_key.
#   * auditor_key = on-chain K_aud for auditor_id (both sender & recipient use
#     the same auditor_id here, so K_aud_r == K_aud_s == auditor_key).
#   * v_transfer <= v_sender (so v_new = v_sender - v_transfer >= 0, T4).
#
# Outputs in <out_dir>:
#   transfer.Prover.toml  the real 30-field transfer witness (5 private + 25 pub)
#   proof / proof.hex     the real 14592-byte UltraHonk proof
#   public_inputs(.hex)   prover-side view of the 25 public inputs
#   transfer.json         the 11 TransferPayload fields (hex) + openings the
#                         sender/auditor keep (r_transfer, r_new, vk, v_new)
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REF_CIRCUITS="$ROOT/reference/stellar-contracts/packages/confidential/circuits"

TOKEN="${1:-}"; SENDER="${2:-}"; RECIP="${3:-}"
V_SENDER="${4:-}"; V_TRANSFER="${5:-}"; SENDER_SK="${6:-}"
RECIP_PVK="${7:-}"; AUD_KEY="${8:-}"; OUT_DIR="${9:-}"
SIGMA="${10:-0x7}"; R_E="${11:-0x1234abcd}"; R_SENDER="${12:-0}"

if [ -z "$TOKEN" ] || [ -z "$SENDER" ] || [ -z "$RECIP" ] || [ -z "$V_SENDER" ] \
   || [ -z "$V_TRANSFER" ] || [ -z "$SENDER_SK" ] || [ -z "$RECIP_PVK" ] \
   || [ -z "$AUD_KEY" ] || [ -z "$OUT_DIR" ]; then
  sed -n '7,13p' "$0"; exit 2
fi

source "$HERE/../circuits/toolchain.sh" >/dev/null 2>&1

mkdir -p "$OUT_DIR"; OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# --- split the 128-hex-char (64-byte) points into x||y field halves ----------
split_point() {
  # arg: 128 hex chars (no 0x). echoes "0x<x64> 0x<y64>"
  local h="${1#0x}"
  echo "0x${h:0:64} 0x${h:64:64}"
}
read -r PVK_X PVK_Y <<<"$(split_point "$RECIP_PVK")"
read -r KAUD_X KAUD_Y <<<"$(split_point "$AUD_KEY")"

read -r TOKEN_LO TOKEN_HI <<<"$(node "$HERE/strkey_limbs.mjs" "$TOKEN")"

echo "==> token=$TOKEN  sender=$SENDER  recipient=$RECIP"
echo "    v_sender=$V_SENDER  v_transfer=$V_TRANSFER  r_sender=$R_SENDER"
echo "    recipient PVK.x=$PVK_X"
echo "    auditor   K.x=$KAUD_X"

# --- 1. run prep_transfer in a throwaway copy of the ref workspace -----------
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/
cp -R "$ROOT/circuits/prep_transfer" "$WORK/prep_transfer"
node -e 'const fs=require("fs");const p=process.argv[1]+"/Nargo.toml";let t=fs.readFileSync(p,"utf8");if(!/"prep_transfer"/.test(t))t=t.replace(/members = \[/,"members = [\n    \"prep_transfer\",");fs.writeFileSync(p,t);' "$WORK"

# addr_f is computed in-circuit by prep_transfer (Poseidon2(ADDRESS, lo, hi)),
# identical to the on-chain token. But prep_transfer takes addr_f directly; so
# derive it once here with the same prep_register path would be overkill —
# instead prep_transfer takes token limbs? No: prep_transfer takes addr_f.
# Compute addr_f via the SAME lib primitive the token uses, re-using the
# prep_register helper's address_to_field (it is value-identical). We compute
# it with a tiny inline nargo run is unnecessary: address_to_field is
# Poseidon2(ADDRESS=1, lo, hi) and is already produced by make_register.sh.
# We recompute it here from the sender's register.json if present, else derive.
ADDR_F=""
if [ -f "$OUT_DIR/../register_${SENDER##*-}/register.json" ]; then :; fi
# Robust: always recompute addr_f via prep_register (same lib) so we never
# depend on a cached file.
cp -R "$ROOT/circuits/prep" "$WORK/prep"
node -e 'const fs=require("fs");const p=process.argv[1]+"/Nargo.toml";let t=fs.readFileSync(p,"utf8");if(!/"prep"/.test(t))t=t.replace(/members = \[/,"members = [\n    \"prep\",");fs.writeFileSync(p,t);' "$WORK"
cat > "$WORK/prep/Prover.toml" <<EOF
sk = "$SENDER_SK"
token_lo = "$TOKEN_LO"
token_hi = "$TOKEN_HI"
acct_lo = "0x0"
acct_hi = "0x0"
EOF
PREP_REG_OUT="$( cd "$WORK" && nargo execute --package prep_register prep_addr_witness 2>&1 )"
ADDR_F="$(printf '%s' "$PREP_REG_OUT" | node -e '
  const d=require("fs").readFileSync(0,"utf8");
  const m=d.match(/Circuit output:\s*\[([^\]]*)\]/);
  const v=[...m[1].matchAll(/0x[0-9a-fA-F]+/g)].map(x=>x[0]);
  process.stdout.write(v[4]);  // index 4 = addr_f in prep_register return
')"
echo "    addr_f=$ADDR_F"

cat > "$WORK/prep_transfer/Prover.toml" <<EOF
sk = "$SENDER_SK"
v = "$V_SENDER"
r = "$R_SENDER"
v_transfer = "$V_TRANSFER"
r_e = "$R_E"
sigma = "$SIGMA"
addr_f = "$ADDR_F"
pvk_b_x = "$PVK_X"
pvk_b_y = "$PVK_Y"
k_aud_r_x = "$KAUD_X"
k_aud_r_y = "$KAUD_Y"
k_aud_s_x = "$KAUD_X"
k_aud_s_y = "$KAUD_Y"
EOF

echo "==> prep_transfer: deriving all transfer witness fields (OZ lib, in-circuit)"
PREP_OUT="$( cd "$WORK" && nargo execute --package prep_transfer prep_t_witness 2>&1 )"
echo "$PREP_OUT" | grep -q "successfully solved" || { echo "ERROR: prep_transfer did not solve" >&2; echo "$PREP_OUT" >&2; exit 1; }

FIELDS_RAW="$(printf '%s' "$PREP_OUT" | node -e '
  const d=require("fs").readFileSync(0,"utf8");
  const m=d.match(/Circuit output:\s*\[([^\]]*)\]/);
  if(!m){console.error("no Circuit output");process.exit(1);}
  const v=[...m[1].matchAll(/0x[0-9a-fA-F]+/g)].map(x=>x[0]);
  if(v.length!==20){console.error("expected 20 fields, got "+v.length);process.exit(1);}
  process.stdout.write(v.join(" "));
')"
read -r Y_X Y_Y CS_X CS_Y CSN_X CSN_Y CT_X CT_Y RE_X RE_Y \
        VT BT VTAR RTAR VTAS BTAS RTAS RTRANSFER RNEW VK <<<"$FIELDS_RAW"

echo "==> derived C_spend=${CS_X:0:14}...  C_spend'=${CSN_X:0:14}...  C_transfer=${CT_X:0:14}..."

# --- 2. write the REAL transfer Prover.toml (5 private + 25 public) ----------
# The 25 public fields in the circuit's declared order (idx 0..24).
PROVER="$OUT_DIR/transfer.Prover.toml"
cat > "$PROVER" <<EOF
# REAL confidential-transfer witness. Generated by scripts/make_transfer.sh
# (prep_transfer mirrors circuit_transfer::main constraints T1..T_a9).
# sender=$SENDER recipient=$RECIP  v_transfer HIDDEN in the proof.
sk = "$SENDER_SK"
v = "$V_SENDER"
r = "$R_SENDER"
v_transfer = "$V_TRANSFER"
r_e = "$R_E"
c_spend_x = "$CS_X"
c_spend_y = "$CS_Y"
y_x = "$Y_X"
y_y = "$Y_Y"
pvk_b_x = "$PVK_X"
pvk_b_y = "$PVK_Y"
addr_f = "$ADDR_F"
k_aud_r_x = "$KAUD_X"
k_aud_r_y = "$KAUD_Y"
k_aud_s_x = "$KAUD_X"
k_aud_s_y = "$KAUD_Y"
c_spend_new_x = "$CSN_X"
c_spend_new_y = "$CSN_Y"
c_transfer_x = "$CT_X"
c_transfer_y = "$CT_Y"
r_e_x = "$RE_X"
r_e_y = "$RE_Y"
v_tilde = "$VT"
b_tilde = "$BT"
sigma = "$SIGMA"
v_tilde_aud_r = "$VTAR"
r_tilde_aud_r = "$RTAR"
v_tilde_aud_s = "$VTAS"
b_tilde_aud_s = "$BTAS"
r_tilde_aud_s = "$RTAS"
EOF
echo "==> wrote $PROVER"

# --- 3. generate the real proof ----------------------------------------------
echo "==> generating UltraHonk transfer proof (keccak oracle, non-zk)"
"$ROOT/circuits/prove.sh" transfer "$PROVER" "$OUT_DIR"

# --- 4. emit transfer.json for the envelope builder --------------------------
V_NEW=$(( V_SENDER - V_TRANSFER ))
OUT_DIR="$OUT_DIR" \
CSN_X="$CSN_X" CSN_Y="$CSN_Y" CT_X="$CT_X" CT_Y="$CT_Y" RE_X="$RE_X" RE_Y="$RE_Y" \
VT="$VT" BT="$BT" SIGMA="$SIGMA" VTAR="$VTAR" RTAR="$RTAR" VTAS="$VTAS" BTAS="$BTAS" RTAS="$RTAS" \
RTRANSFER="$RTRANSFER" RNEW="$RNEW" VK="$VK" VNEW="$V_NEW" VTRANSFER="$V_TRANSFER" \
SENDER="$SENDER" RECIP="$RECIP" node -e '
  const fs=require("fs"); const E=process.env;
  const s=h=>h.replace(/^0x/,"").padStart(64,"0");
  const o={
    sender:E.SENDER, recipient:E.RECIP,
    c_spend_new: s(E.CSN_X)+s(E.CSN_Y),
    c_transfer:  s(E.CT_X)+s(E.CT_Y),
    r_e_point:   s(E.RE_X)+s(E.RE_Y),
    v_tilde: s(E.VT), b_tilde: s(E.BT), sigma: s(E.SIGMA),
    v_tilde_aud_r: s(E.VTAR), r_tilde_aud_r: s(E.RTAR),
    v_tilde_aud_s: s(E.VTAS), b_tilde_aud_s: s(E.BTAS), r_tilde_aud_s: s(E.RTAS),
    openings: { v_transfer:E.VTRANSFER, v_new:E.VNEW,
                r_transfer:"0x"+s(E.RTRANSFER), r_new:"0x"+s(E.RNEW), vk:"0x"+s(E.VK) },
    note:"real transfer payload; token reassembles the identical PI blob -> verifier accepts"
  };
  fs.writeFileSync(E.OUT_DIR+"/transfer.json", JSON.stringify(o,null,2));
'
echo "==> wrote $OUT_DIR/transfer.json"
echo "==> DONE. Real confidential-transfer proof + payload in $OUT_DIR"
