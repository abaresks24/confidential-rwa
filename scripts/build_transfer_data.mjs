// Build the hex-encoded XDR `TransferData` envelope for the OZ confidential
// token's `confidential_transfer(from, to, data: Bytes)` entry point.
//
// TransferData is a soroban #[contracttype] struct:
//   struct TransferData { payload: TransferPayload, proof: Bytes }
//   struct TransferPayload {
//     c_spend_new: BytesN<64>, c_transfer: BytesN<64>, r_e_point: BytesN<64>,
//     v_tilde: BytesN<32>, b_tilde: BytesN<32>, sigma: BytesN<32>,
//     v_tilde_aud_r: BytesN<32>, r_tilde_aud_r: BytesN<32>,
//     v_tilde_aud_s: BytesN<32>, b_tilde_aud_s: BytesN<32>,
//     r_tilde_aud_s: BytesN<32>,
//   }
// Both serialise as an ScMap keyed by the field-name symbols. The Soroban host
// requires ScMap entries in ascending key order, so we sort the symbol keys
// lexicographically (matching build_register_data.mjs's hand-ordered maps).
//
// Usage:
//   build_transfer_data.mjs <proof.hex> <transfer.json>
//
// transfer.json is produced by scripts/make_transfer.sh and carries the 11
// payload fields as big-endian hex (64-byte points, 32-byte fields). These are
// the REAL, constraint-satisfying values the prep_transfer witness derived, so
// the token reassembles the identical public-input blob and the on-chain
// verifier ACCEPTS the proof.
import { xdr } from "@stellar/stellar-sdk";
import { readFileSync } from "node:fs";

const [, , proofHexPath, transferJsonPath] = process.argv;
if (!proofHexPath || !transferJsonPath) {
  console.error("usage: build_transfer_data.mjs <proof.hex> <transfer.json>");
  process.exit(1);
}

const t = JSON.parse(readFileSync(transferJsonPath, "utf8"));
const hexToBuf = (h) => Buffer.from(h.replace(/^0x/, "").trim(), "hex");

const point = (h) => {
  const b = hexToBuf(h);
  if (b.length !== 64) throw new Error(`point not 64 bytes: ${b.length}`);
  return b;
};
const field = (h) => {
  const b = hexToBuf(h);
  if (b.length !== 32) throw new Error(`field not 32 bytes: ${b.length}`);
  return b;
};

const sym = (s) => xdr.ScVal.scvSymbol(s);
const bytes = (b) => xdr.ScVal.scvBytes(b);

// payload fields keyed by symbol. Build then sort ascending by key to satisfy
// the host's canonical ScMap ordering.
const payloadEntries = [
  ["c_spend_new", point(t.c_spend_new)],
  ["c_transfer", point(t.c_transfer)],
  ["r_e_point", point(t.r_e_point)],
  ["v_tilde", field(t.v_tilde)],
  ["b_tilde", field(t.b_tilde)],
  ["sigma", field(t.sigma)],
  ["v_tilde_aud_r", field(t.v_tilde_aud_r)],
  ["r_tilde_aud_r", field(t.r_tilde_aud_r)],
  ["v_tilde_aud_s", field(t.v_tilde_aud_s)],
  ["b_tilde_aud_s", field(t.b_tilde_aud_s)],
  ["r_tilde_aud_s", field(t.r_tilde_aud_s)],
]
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  .map(([k, v]) => new xdr.ScMapEntry({ key: sym(k), val: bytes(v) }));

const payload = xdr.ScVal.scvMap(payloadEntries);

const proof = hexToBuf(readFileSync(proofHexPath, "utf8"));

// TransferData map: { payload, proof } (ascending key order: "payload" < "proof").
const transferData = xdr.ScVal.scvMap([
  new xdr.ScMapEntry({ key: sym("payload"), val: payload }),
  new xdr.ScMapEntry({ key: sym("proof"), val: bytes(proof) }),
]);

const inner = Buffer.from(transferData.toXDR("raw"));
process.stdout.write(inner.toString("hex"));
