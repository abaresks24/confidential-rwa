#!/usr/bin/env bash
# =============================================================================
# auditor_decrypt.sh — regulator-side decryption of a confidential transfer.
#
#   auditor_decrypt.sh <transfer.json> [sk_aud_hex]
#
# Reads the emitted per-channel ciphertexts (r_e_point, sigma, v_tilde_aud_r,
# r_tilde_aud_r, v_tilde_aud_s, b_tilde_aud_s, r_tilde_aud_s) from the
# transfer.json produced by make_transfer.sh and runs prep_audit (the EXACT OZ
# lib) to recover, from the auditor secret scalar sk_aud:
#   * the transfer amount via the RECIPIENT channel,
#   * the transfer amount via the SENDER channel,
#   * the sender's new balance.
#
# sk_aud defaults to 1 (the deployment's auditor key is the Grumpkin generator
# G = 1*H-base; EXAMPLE ONLY, publicly decryptable). Prints five decimal lines:
#   v_transfer_recipient  v_transfer_sender  v_new  r_transfer  r_new
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REF_CIRCUITS="$ROOT/reference/stellar-contracts/packages/confidential/circuits"
TJSON="${1:?usage: auditor_decrypt.sh <transfer.json> [sk_aud_hex]}"
SK_AUD="${2:-1}"

source "$HERE/../circuits/toolchain.sh" >/dev/null 2>&1

# Extract fields from transfer.json.
read -r RE_X RE_Y SIGMA VTAR RTAR VTAS BTAS RTAS <<<"$(node -e '
  const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const h=s=>"0x"+s.replace(/^0x/,"");
  const re=t.r_e_point; const rex=h(re.slice(0,64)), rey=h(re.slice(64,128));
  process.stdout.write([rex,rey,h(t.sigma),h(t.v_tilde_aud_r),h(t.r_tilde_aud_r),
    h(t.v_tilde_aud_s),h(t.b_tilde_aud_s),h(t.r_tilde_aud_s)].join(" "));
' "$TJSON")"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/
cp -R "$ROOT/circuits/prep_audit" "$WORK/prep_audit"
node -e 'const fs=require("fs");const p=process.argv[1]+"/Nargo.toml";let t=fs.readFileSync(p,"utf8");if(!/"prep_audit"/.test(t))t=t.replace(/members = \[/,"members = [\n    \"prep_audit\",");fs.writeFileSync(p,t);' "$WORK"

cat > "$WORK/prep_audit/Prover.toml" <<EOF
sk_aud = "$SK_AUD"
r_e_x = "$RE_X"
r_e_y = "$RE_Y"
sigma = "$SIGMA"
v_tilde_aud_r = "$VTAR"
r_tilde_aud_r = "$RTAR"
v_tilde_aud_s = "$VTAS"
b_tilde_aud_s = "$BTAS"
r_tilde_aud_s = "$RTAS"
EOF

OUT="$( cd "$WORK" && nargo execute --package prep_audit prep_audit_witness 2>&1 )"
echo "$OUT" | grep -q "successfully solved" || { echo "ERROR: prep_audit did not solve" >&2; echo "$OUT" >&2; exit 1; }

printf '%s' "$OUT" | node -e '
  const d=require("fs").readFileSync(0,"utf8");
  const m=d.match(/Circuit output:\s*\[([^\]]*)\]/);
  const v=[...m[1].matchAll(/0x[0-9a-fA-F]+/g)].map(x=>BigInt(x[0]).toString());
  // v_transfer_recipient v_transfer_sender v_new r_transfer r_new
  process.stdout.write(v.slice(0,3).join(" "));
'
