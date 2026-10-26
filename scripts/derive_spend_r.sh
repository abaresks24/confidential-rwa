#!/usr/bin/env bash
# =============================================================================
# derive_spend_r.sh <vk_hex> <sigma_hex>  ->  prints "0x..." (32-byte field)
#
# derive_spend_r(vk, sigma) = Poseidon2(SPEND_RANDOMNESS, [vk, sigma]) — the
# deterministic blinding the confidential token assigns to the sender's NEW
# spendable commitment after a transfer (lib constraints W5/T10/S9). Because it
# depends only on the sender's fixed viewing key and the (fixed) sigma, the
# post-transfer spendable blinding is fully recoverable each run — which is what
# lets reconcile_spendable.sh re-seed the opening from chain.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REF_CIRCUITS="$ROOT/reference/stellar-contracts/packages/confidential/circuits"
VK="${1:?usage: derive_spend_r.sh <vk> <sigma>}"
SIGMA="${2:?usage: derive_spend_r.sh <vk> <sigma>}"

source "$HERE/../circuits/toolchain.sh" >/dev/null 2>&1

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp -R "$REF_CIRCUITS"/. "$WORK"/
cp -R "$ROOT/circuits/prep_spend_r" "$WORK/prep_spend_r"
node -e 'const fs=require("fs");const p=process.argv[1]+"/Nargo.toml";let t=fs.readFileSync(p,"utf8");if(!/"prep_spend_r"/.test(t))t=t.replace(/members = \[/,"members = [\n    \"prep_spend_r\",");fs.writeFileSync(p,t);' "$WORK"
cat > "$WORK/prep_spend_r/Prover.toml" <<EOF
vk = "$VK"
sigma = "$SIGMA"
EOF

OUT="$( cd "$WORK" && nargo execute --package prep_spend_r prep_spend_r_witness 2>&1 )"
echo "$OUT" | grep -q "successfully solved" || { echo "ERROR: prep_spend_r did not solve" >&2; echo "$OUT" >&2; exit 1; }
printf '%s' "$OUT" | node -e '
  const d=require("fs").readFileSync(0,"utf8");
  const m=d.match(/Circuit output:\s*(0x[0-9a-fA-F]+)/);
  if(!m){console.error("no Circuit output");process.exit(1);}
  process.stdout.write(m[1]);
'
