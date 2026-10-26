// prep_commit -- compute the zero-blinding deposit commitment value*G, using
// the EXACT OZ Grumpkin generator G and Pedersen gadget. This is what the
// confidential token stores as receiving_commitment after deposit(amount):
//   c_dep = amount * G   (blinding r = 0)
//
// The regulator/auditor "decrypts" a zero-blinding deposit by recomputing
// value*G for a candidate value and matching it against the on-chain
// commitment. Here we produce the expected point so the e2e can assert the
// on-chain receiving_commitment equals it -- i.e. the auditor recovers alice's
// true hidden balance.
use stellar_confidential_lib::commit;

fn main(value: Field) -> pub [Field; 2] {
    let c = commit(value, 0);
    [c.x, c.y]
}
