// prep_spend_r -- derive_spend_r(vk, sigma), the deterministic post-transfer
// spendable blinding (lib W5/T10/S9). See scripts/derive_spend_r.sh.
use stellar_confidential_lib::derive_spend_r;

fn main(vk: Field, sigma: Field) -> pub Field {
    derive_spend_r(vk, sigma)
}
