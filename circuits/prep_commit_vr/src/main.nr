// prep_commit_vr -- compute a Pedersen commitment C = commit(v, r) for an
// ARBITRARY blinding r, using the EXACT OZ Grumpkin generators G,H and the same
// `commit` gadget the confidential token uses on-chain.
//
// This is the reconciliation primitive for the re-runnable confidential
// transfer: given a CANDIDATE spendable opening (v, r) that the sender's wallet
// believes to be current, recompute commit(v, r) and compare it byte-for-byte
// against the LIVE on-chain `spendable_commitment`. If they match, the opening
// is proven in-sync with chain (no stale cache); if not, the e2e self-heals by
// trying the other recoverable candidate openings.
//
// Unlike prep_commit (which hardcodes r = 0 for zero-blinding deposits), this
// takes r as an input so it can verify the post-transfer spendable opening
// whose blinding is r_new = derive_spend_r(vk, sigma) != 0.
use stellar_confidential_lib::commit;

fn main(v: Field, r: Field) -> pub [Field; 2] {
    let c = commit(v, r);
    [c.x, c.y]
}
