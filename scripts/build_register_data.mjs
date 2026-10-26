// Build the hex-encoded XDR `RegisterData` envelope for the OZ confidential
// token's `register(account, auditor_id, data: Bytes)` entry point.
//
// RegisterData is a soroban #[contracttype] struct:
//   struct RegisterData { payload: RegisterPayload, proof: Bytes }
//   struct RegisterPayload { y: BytesN<64>, pvk: BytesN<64> }
// which serialises as an ScMap keyed by field symbols (lexicographically
// ordered by the host): payload, proof -- and payload is itself an ScMap
// keyed by: pvk, y.
//
// Usage:
//   build_register_data.mjs <proof.hex> [register.json]
//
// If register.json is given (produced by scripts/make_register.sh), the y/pvk
// points are the REAL, CONTRACT-BOUND points for a live account, so the token
// reassembles the identical public-input blob and the on-chain verifier
// ACCEPTS the proof. This is the live-register path.
//
// If register.json is omitted, it falls back to the circuit's FIXTURE points
// (addr_f=0xbeef), which can only ever be rejected on-chain (#3506) because
// the token recomputes addr_f = address_to_field(token) != 0xbeef. That
// fixture path is retained only to demonstrate the verifier genuinely enforces
// the binding; it is NOT a passing register.
import { xdr } from "@stellar/stellar-sdk";
import { readFileSync } from "node:fs";

const [, , proofHexPath, registerJsonPath] = process.argv;
if (!proofHexPath) {
  console.error("usage: build_register_data.mjs <proof.hex> [register.json]");
  process.exit(1);
}

// Fixture Grumpkin points (be(x)||be(y)) from circuits/examples/register.Prover.toml.
// Fallback ONLY -- rejected on-chain by design.
let Y_X = "1b46b003b88a6c34549dc74115f088f4b231a151397526bc10cbf1d15b457646";
let Y_Y = "29116280600c10ead1fdbd9ab4b571896030679bf554d7f1ebf681e5147de21b";
let PVK_X = "2e7421c0e86a4c8eed823edf851c364ecee448bf70eae2a95befe3dd9364cc45";
let PVK_Y = "0b060655740aabef84e7305bb886b75da8d258f346381f03925d69645292fe7a";

if (registerJsonPath) {
  const r = JSON.parse(readFileSync(registerJsonPath, "utf8"));
  const strip = (h) => h.replace(/^0x/, "").padStart(64, "0");
  Y_X = strip(r.y_x);
  Y_Y = strip(r.y_y);
  PVK_X = strip(r.pvk_x);
  PVK_Y = strip(r.pvk_y);
}

const hexToBuf = (h) => Buffer.from(h.replace(/^0x/, "").trim(), "hex");
const y = hexToBuf(Y_X + Y_Y);
const pvk = hexToBuf(PVK_X + PVK_Y);
const proof = hexToBuf(readFileSync(proofHexPath, "utf8"));

if (y.length !== 64 || pvk.length !== 64) throw new Error("point not 64 bytes");

const sym = (s) => xdr.ScVal.scvSymbol(s);
const bytes = (b) => xdr.ScVal.scvBytes(b);

// payload map: { pvk, y } (symbol keys, host expects lexicographic order)
const payload = xdr.ScVal.scvMap([
  new xdr.ScMapEntry({ key: sym("pvk"), val: bytes(pvk) }),
  new xdr.ScMapEntry({ key: sym("y"), val: bytes(y) }),
]);

// RegisterData map: { payload, proof }
const registerData = xdr.ScVal.scvMap([
  new xdr.ScMapEntry({ key: sym("payload"), val: payload }),
  new xdr.ScMapEntry({ key: sym("proof"), val: bytes(proof) }),
]);

const inner = Buffer.from(registerData.toXDR("raw"));
process.stdout.write(inner.toString("hex"));
