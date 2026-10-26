// prep_audit -- AUDITOR-SIDE decryption of a confidential transfer's per-channel
// ciphertexts, using the EXACT OZ lib primitives the transfer circuit used to
// encrypt them. This is the regulator view: given the auditor secret scalar
// sk_aud (the discrete log of the on-chain K_aud), the auditor recovers the
// transfer amount and the sender's new balance from the emitted ciphertexts.
//
// Channels (reference/.../circuits/transfer/src/main.nr, auditor block):
//   s_a   = ecdh(sk_aud, R_e)                         (auditor shares with R_e;
//                                                      S = sk_aud * R_e)
//   recipient:  m_r = SpongeSqueeze_2(AUD_RECIPIENT, s_a_r, sigma)
//               v_transfer = v_tilde_aud_r - m_r[0]
//               r_transfer = r_tilde_aud_r - m_r[1]
//   sender:     m_s = SpongeSqueeze_3(AUD_SENDER, s_a_s, sigma)
//               v_transfer = v_tilde_aud_s - m_s[0]
//               v_new      = b_tilde_aud_s - m_s[1]
//               r_new      = r_tilde_aud_s - m_s[2]
//
// Here K_aud_r == K_aud_s == the single on-chain auditor key (auditor_id 0),
// so s_a_r == s_a_s and one sk_aud decrypts both channels. The deployment's
// auditor key is the Grumpkin generator G (sk_aud = 1) -- EXAMPLE ONLY.
//
// Returns the two independently-recovered transfer amounts (recipient channel,
// sender channel) and the sender's recovered new balance. The e2e asserts the
// two amounts are EQUAL to each other and to the known plaintext transfer.
use stellar_confidential_lib::{domain, ecdh, sponge_squeeze_2, sponge_squeeze_3};
use std::embedded_curve_ops::EmbeddedCurvePoint;

fn main(
    sk_aud: Field,
    r_e_x: Field,
    r_e_y: Field,
    sigma: Field,
    v_tilde_aud_r: Field,
    r_tilde_aud_r: Field,
    v_tilde_aud_s: Field,
    b_tilde_aud_s: Field,
    r_tilde_aud_s: Field,
) -> pub [Field; 5] {
    let r_e_pt = EmbeddedCurvePoint { x: r_e_x, y: r_e_y, is_infinite: false };

    // Auditor shared-secret scalar: S = sk_aud * R_e, s_a = Poseidon2(ECDH, S.x, S.y).
    let s_a = ecdh(sk_aud, r_e_pt);

    // Recipient channel.
    let m_r = sponge_squeeze_2(domain::AUDITOR_RECIPIENT, s_a, sigma);
    let v_transfer_r = v_tilde_aud_r - m_r[0];
    let r_transfer = r_tilde_aud_r - m_r[1];

    // Sender channel.
    let m_s = sponge_squeeze_3(domain::AUDITOR_SENDER, s_a, sigma);
    let v_transfer_s = v_tilde_aud_s - m_s[0];
    let v_new = b_tilde_aud_s - m_s[1];
    let r_new = r_tilde_aud_s - m_s[2];

    // [recipient-channel amount, sender-channel amount, sender new balance,
    //  recovered r_transfer, recovered r_new]
    [v_transfer_r, v_transfer_s, v_new, r_transfer, r_new]
}
