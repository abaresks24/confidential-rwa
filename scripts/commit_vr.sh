#!/usr/bin/env bash
# =============================================================================
# commit_vr.sh <v> <r>  ->  prints the 64-byte hex (be(x)||be(y)) of commit(v, r)
#
# commit(v, r) = v*G + r*H with the EXACT OZ Grumpkin generators, i.e. the same
# Pedersen commitment the confidential token stores as spendable_commitment.
#
# Used to RECONCILE a candidate spendable opening (v, r) against the LIVE
# on-chain commitment before building a confidential transfer: if the printed
# point equals the on-chain spendable_commitment, the opening is in-sync with
# chain (the witness will satisfy the relation and the proof verifies). r may be
# "0" (decimal) or "0x..." (hex); v is decimal or 0x.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REF_CIRCUITS="$ROOT/reference/stellar-contracts/packages/confidential/circuits"
V="${1:?usage: commit_vr.sh <v> <r>}"
R="${2:?usage: commit_vr.sh <v> <r>}"

source "$HERE/../circuits/toolchain.sh" >/dev/null 2>&1

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/
cp -R "$ROOT/circuits/prep_commit_vr" "$WORK/prep_commit_vr"
node -e 'const fs=require("fs");const p=process.argv[1]+"/Nargo.toml";let t=fs.readFileSync(p,"utf8");if(!/"prep_commit_vr"/.test(t))t=t.replace(/members = \[/,"members = [\n    \"prep_commit_vr\",");fs.writeFileSync(p,t);' "$WORK"
cat > "$WORK/prep_commit_vr/Prover.toml" <<EOF
v = "$V"
r = "$R"
EOF

OUT="$( cd "$WORK" && nargo execute --package prep_commit_vr prep_commit_vr_witness 2>&1 )"
echo "$OUT" | grep -q "successfully solved" || { echo "ERROR: prep_commit_vr did not solve" >&2; echo "$OUT" >&2; exit 1; }

printf '%s' "$OUT" | node -e '
  const data=require("fs").readFileSync(0,"utf8");
  const m=data.match(/Circuit output:\s*\[([^\]]*)\]/);
  if(!m){console.error("no Circuit output");process.exit(1);}
  const vals=[...m[1].matchAll(/0x[0-9a-fA-F]+/g)].map(x=>x[0].replace(/^0x/,"").padStart(64,"0"));
  if(vals.length!==2){console.error("expected 2 coords");process.exit(1);}
  process.stdout.write(vals[0]+vals[1]);
'
