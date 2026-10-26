// prep_register - off-circuit witness preparation for a LIVE register.
//
// The register fixture (circuits/examples/register.Prover.toml) is bound to
// addr_f=0xbeef, which is NOT what the on-chain token computes. The token does
//   addr_f = address_to_field(token_contract) = Poseidon2(-_addr, lo, hi)
//   acct_f = address_to_field(account)
// where (lo, hi) are the LE-interpreted halves of the 56-byte strkey.
//
// This helper recomputes addr_f / acct_f with the EXACT same OZ primitives
// (stellar_confidential_lib), then derives the spending/viewing keys for a
// chosen secret `sk`:
//   vk  = vk_from_sk(sk, addr_f)
//   Y   = sk * H
//   PVK = vk * H
//
// It returns everything the register circuit needs as PUBLIC inputs, so we can
// write a real, contract-bound Prover.toml and produce a proof the live
// verifier ACCEPTS. `nargo execute` prints the return tuple; make_register.sh
// parses it.
use stellar_confidential_lib::{domain, H, poseidon_with_domain, pvk_from_vk, scalar_mul, vk_from_sk};

fn address_to_field(lo: Field, hi: Field) -> Field {
    poseidon_with_domain(domain::ADDRESS, [lo, hi])
}

fn main(
    sk: Field,
    token_lo: Field,
    token_hi: Field,
    acct_lo: Field,
    acct_hi: Field,
) -> pub [Field; 6] {
    assert(sk != 0);

    let addr_f = address_to_field(token_lo, token_hi);
    let acct_f = address_to_field(acct_lo, acct_hi);

    let vk = vk_from_sk(sk, addr_f);
    assert(vk != 0);

    let y = scalar_mul(sk, H);
    let pvk = pvk_from_vk(vk);

    // [Y.x, Y.y, PVK.x, PVK.y, addr_f, acct_f] - exactly the register PI order.
    [y.x, y.y, pvk.x, pvk.y, addr_f, acct_f]
}
