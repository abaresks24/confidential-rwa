// prep_transfer -- off-circuit witness preparation for a LIVE confidential
// transfer (circuit_transfer). This is the piece the spec-only OZ confidential
// SDK would emit; we implement it ourselves by re-deriving EVERY transfer
// witness field with the EXACT OZ lib primitives, so:
//
//   * the real transfer circuit (prove.sh transfer) accepts the witness, and
//   * the on-chain token reassembles the identical 25-field public-input blob
//     and the verifier ACCEPTS the proof.
//
// It is a faithful mirror of circuit_transfer::main's constraints T1..T_a9
// (reference/.../circuits/transfer/src/main.nr) and of that circuit's own
// `print_fixtures` test -- every derivation funnels through stellar_confidential_lib.
//
// Inputs
// ------
// Private (owned by the sender's wallet):
//   sk          sender spending secret scalar        (T1: Y = sk*H)
//   v           sender spendable PLAINTEXT balance    (T3: C_spend = v*G + r*H)
//   r           sender spendable blinding             (0 for our zero-blinding deposits)
//   v_transfer  transfer amount                       (hidden)
//   r_e         ephemeral ECDH scalar (!= 0)          (T13)
//   sigma       random salt
// Trusted public (loaded by the token from on-chain state):
//   addr_f      address_to_field(token)               (T2 binds vk to this token)
//   pvk_b_x/y   recipient viewing public key          (T5 recipient ECDH)
//   k_aud_r_x/y recipient auditor key                 (T_a1)
//   k_aud_s_x/y sender auditor key                    (T_a5)
//
// Returns (33 fields, grouped so make_transfer.sh can slice them):
//   [0..1]   Y.x, Y.y                 (public idx 2,3)
//   [2..3]   C_spend.x, C_spend.y     (public idx 0,1 -- must equal on-chain spendable)
//   [4..5]   C_spend'.x, C_spend'.y   (public idx 11,12 / payload.c_spend_new)
//   [6..7]   C_transfer.x, C_transfer.y     (public idx 13,14 / payload.c_transfer)
//   [8..9]   R_e.x, R_e.y             (public idx 15,16 / payload.r_e_point)
//   [10]     v_tilde                  (public idx 17 / payload.v_tilde)
//   [11]     b_tilde                  (public idx 18 / payload.b_tilde)
//   [12]     v_tilde_aud_r            (public idx 20 / payload.v_tilde_aud_r)
//   [13]     r_tilde_aud_r            (public idx 21 / payload.r_tilde_aud_r)
//   [14]     v_tilde_aud_s            (public idx 22 / payload.v_tilde_aud_s)
//   [15]     b_tilde_aud_s            (public idx 23 / payload.b_tilde_aud_s)
//   [16]     r_tilde_aud_s            (public idx 24 / payload.r_tilde_aud_s)
//   [17]     r_transfer               (the transfer-commitment blinding; lets the
//                                       auditor / recipient check C_transfer = v_t*G + r_t*H)
//   [18]     r_new                    (new spendable blinding; sender wallet keeps it)
//   [19]     vk                       (sender viewing key; for balance decrypt)
use stellar_confidential_lib::{
    commit, derive_spend_r, derive_transfer_blind, domain, ecdh, encrypt_amount, encrypt_balance,
    H, scalar_mul, sponge_squeeze_2, sponge_squeeze_3, vk_from_sk,
};
use std::embedded_curve_ops::EmbeddedCurvePoint;

fn main(
    sk: Field,
    v: Field,
    r: Field,
    v_transfer: Field,
    r_e: Field,
    sigma: Field,
    addr_f: Field,
    pvk_b_x: Field,
    pvk_b_y: Field,
    k_aud_r_x: Field,
    k_aud_r_y: Field,
    k_aud_s_x: Field,
    k_aud_s_y: Field,
) -> pub [Field; 20] {
    assert(r_e != 0); // T13

    // T1 -- sender key ownership.
    let y = scalar_mul(sk, H);

    // T2 -- contract-bound viewing key.
    let vk = vk_from_sk(sk, addr_f);

    // T3 -- opening of the sender's current spendable balance.
    let c_spend = commit(v, r);

    // T4 -- range validity (also enforced in the real circuit).
    v.assert_max_bit_size::<127>();
    v_transfer.assert_max_bit_size::<127>();
    let v_new = v - v_transfer;
    v_new.assert_max_bit_size::<127>();

    // T6 -- ephemeral public key.
    let r_e_pt = scalar_mul(r_e, H);

    // T5 -- recipient ECDH shared secret.
    let pvk_b = EmbeddedCurvePoint { x: pvk_b_x, y: pvk_b_y, is_infinite: false };
    let s = ecdh(r_e, pvk_b);

    // T7 / T8 / T9 -- transfer commitment + encrypted amount.
    let r_transfer = derive_transfer_blind(s, sigma);
    let c_transfer = commit(v_transfer, r_transfer);
    let v_tilde = encrypt_amount(v_transfer, s, sigma);

    // T10 / T11 / T12 -- new spendable commitment + encrypted balance.
    let r_new = derive_spend_r(vk, sigma);
    let c_spend_new = commit(v_new, r_new);
    let b_tilde = encrypt_balance(v_new, vk, sigma);

    // Auditor keys (the real circuit asserts these on-curve; we trust the
    // on-chain-registered points here).
    let k_aud_r = EmbeddedCurvePoint { x: k_aud_r_x, y: k_aud_r_y, is_infinite: false };
    let k_aud_s = EmbeddedCurvePoint { x: k_aud_s_x, y: k_aud_s_y, is_infinite: false };

    // T_a1..T_a4 -- recipient-auditor channel.
    let s_a_r = ecdh(r_e, k_aud_r);
    let m_r = sponge_squeeze_2(domain::AUDITOR_RECIPIENT, s_a_r, sigma);
    let v_tilde_aud_r = v_transfer + m_r[0];
    let r_tilde_aud_r = r_transfer + m_r[1];

    // T_a5..T_a9 -- sender-auditor channel.
    let s_a_s = ecdh(r_e, k_aud_s);
    let m_s = sponge_squeeze_3(domain::AUDITOR_SENDER, s_a_s, sigma);
    let v_tilde_aud_s = v_transfer + m_s[0];
    let b_tilde_aud_s = v_new + m_s[1];
    let r_tilde_aud_s = r_new + m_s[2];

    [
        y.x, y.y,
        c_spend.x, c_spend.y,
        c_spend_new.x, c_spend_new.y,
        c_transfer.x, c_transfer.y,
        r_e_pt.x, r_e_pt.y,
        v_tilde,
        b_tilde,
        v_tilde_aud_r,
        r_tilde_aud_r,
        v_tilde_aud_s,
        b_tilde_aud_s,
        r_tilde_aud_s,
        r_transfer,
        r_new,
        vk,
    ]
}
