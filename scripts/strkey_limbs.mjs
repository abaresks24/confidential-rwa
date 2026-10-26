// strkey_limbs.mjs <STRKEY>
//
// Reproduces the on-chain `address_to_field` pre-hash decomposition
// (packages/confidential/src/storage.rs::address_to_field):
//   strkey = addr.to_string()        // 56-char G.../C... strkey, ASCII
//   lo = le_bytes_to_u256(strkey[0..28])
//   hi = le_bytes_to_u256(strkey[28..56])
// where le_bytes_to_u256 reverses the 28 bytes (LE) into a 32-byte BE U256.
//
// Prints:  <lo_hex> <hi_hex>   (0x-prefixed field elements for Prover.toml)
const [, , strkey] = process.argv;
if (!strkey || strkey.length !== 56) {
  console.error(`usage: strkey_limbs.mjs <56-char strkey>; got length ${strkey?.length}`);
  process.exit(1);
}
const bytes = Buffer.from(strkey, "ascii"); // 56 bytes
if (bytes.length !== 56) {
  console.error(`strkey is not 56 ASCII bytes (${bytes.length})`);
  process.exit(1);
}
function leToField(slice28) {
  // reverse bytes (LE -> BE), left-pad to 32, hex
  const be = Buffer.from(slice28).reverse();
  return "0x" + be.toString("hex"); // 28 bytes -> 56 hex chars, canonical < r
}
const lo = leToField(bytes.subarray(0, 28));
const hi = leToField(bytes.subarray(28, 56));
process.stdout.write(`${lo} ${hi}`);
