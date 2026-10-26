// prep_reconcile -- RE-SEED / self-heal the sender's spendable opening by
// finding, in ONE circuit run, which (v, r) opens the LIVE on-chain
// spendable_commitment.
//
// It walks a deterministic grid of plaintext balances v = i * step (i in
// 0..N) at the only two blindings this e2e ever produces:
//   * r = 0                        (pure zero-blinding deposits)
//   * r = derive_spend_r(vk, sigma) (new-spendable blinding after a transfer)
// For each candidate it recomputes commit(v, r) with the EXACT OZ Pedersen
// gadget and compares to the on-chain point (cx, cy). It returns the matching
// (v, r) so the caller can build a witness whose C_spend equals the on-chain
// spendable_commitment byte-for-byte -- the relation the transfer circuit's T3
// constraint enforces, and the whole reason a stale cache caused #3506.
//
// Honest: nothing is fabricated. v is recovered by exhaustive match against the
// real on-chain point, r is a deterministic lib output. If nothing matches,
// found=0 and the caller fails loudly rather than proving an unsatisfiable
// witness.
//
// Returns [found, v, r]:
//   found = 1 if a candidate matched, else 0.
//   v     = the matching plaintext balance (0 if none).
//   r     = the matching blinding (0 if none).
use stellar_confidential_lib::{commit, derive_spend_r};

global N: u32 = 31; // grid points per blinding: v in {0, step, ..., 30*step}

fn main(cx: Field, cy: Field, vk: Field, sigma: Field, step: Field) -> pub [Field; 3] {
    let r_fixed = derive_spend_r(vk, sigma);

    let mut found: Field = 0;
    let mut out_v: Field = 0;
    let mut out_r: Field = 0;

    // blinding r = 0
    for i in 0..N {
        let v = (i as Field) * step;
        let c = commit(v, 0);
        if (c.x == cx) & (c.y == cy) {
            found = 1;
            out_v = v;
            out_r = 0;
        }
    }
    // blinding r = r_fixed
    for i in 0..N {
        let v = (i as Field) * step;
        let c = commit(v, r_fixed);
        if (c.x == cx) & (c.y == cy) {
            found = 1;
            out_v = v;
            out_r = r_fixed;
        }
    }

    [found, out_v, out_r]
}
