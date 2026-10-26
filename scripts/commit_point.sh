#!/usr/bin/env bash
# commit_point.sh <value>  ->  prints the 64-byte hex (be(x)||be(y)) of value*G
#
# value*G is the EXACT zero-blinding Pedersen commitment the confidential token
# stores as receiving_commitment after deposit(value) (OZ: c_dep = amount * G).
# Uses the OZ lib's `commit(value, 0)` so G and the encoding match on-chain.
# This is the regulator/auditor decryption check: recompute value*G and match
# it against the on-chain commitment to recover a holder's true hidden balance.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REF_CIRCUITS="$ROOT/reference/stellar-contracts/packages/confidential/circuits"
VALUE="${1:?usage: commit_point.sh <value>}"

source "$HERE/../circuits/toolchain.sh" >/dev/null 2>&1

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/
cp -R "$ROOT/circuits/prep_commit" "$WORK/prep_commit"
node -e 'const fs=require("fs");const p=process.argv[1]+"/Nargo.toml";let t=fs.readFileSync(p,"utf8");if(!/"prep_commit"/.test(t))t=t.replace(/members = \[/,"members = [\n    \"prep_commit\",");fs.writeFileSync(p,t);' "$WORK"
printf 'value = "%s"\n' "$VALUE" > "$WORK/prep_commit/Prover.toml"

OUT="$( cd "$WORK" && nargo execute --package prep_commit prep_commit_witness 2>&1 )"
echo "$OUT" | grep -q "successfully solved" || { echo "ERROR: prep_commit did not solve" >&2; echo "$OUT" >&2; exit 1; }

printf '%s' "$OUT" | node -e '
  const data=require("fs").readFileSync(0,"utf8");
  const m=data.match(/Circuit output:\s*\[([^\]]*)\]/);
  if(!m){console.error("no Circuit output");process.exit(1);}
  const vals=[...m[1].matchAll(/0x[0-9a-fA-F]+/g)].map(x=>x[0].replace(/^0x/,"").padStart(64,"0"));
  if(vals.length!==2){console.error("expected 2 coords");process.exit(1);}
  process.stdout.write(vals[0]+vals[1]);
'
