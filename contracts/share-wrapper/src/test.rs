#![cfg(test)]
extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use mock_rebasing_rwa::{MockRebasingRwa, MockRebasingRwaClient};

use crate::{ShareWrapper, ShareWrapperClient, DEAD_SHARES, RATE_ONE};

struct Harness<'a> {
    e: Env,
    rwa: MockRebasingRwaClient<'a>,
    wrapper: ShareWrapperClient<'a>,
}

fn setup<'a>() -> Harness<'a> {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let rwa_id = e.register(
        MockRebasingRwa,
        (admin.clone(), 7u32, String::from_str(&e, "rtFUND"), String::from_str(&e, "RTF")),
    );
    let wrapper_id = e.register(ShareWrapper, (rwa_id.clone(), admin.clone()));

    Harness {
        rwa: MockRebasingRwaClient::new(&e, &rwa_id),
        wrapper: ShareWrapperClient::new(&e, &wrapper_id),
        e,
    }
}

/// Mint `amount` reported underlying to `who` (index starts at 1.0 so raw == reported).
fn fund(h: &Harness, who: &Address, amount: &i128) {
    h.rwa.mint(who, amount);
}

#[test]
fn deposit_then_redeem_no_accrual_round_trips() {
    let h = setup();
    let alice = Address::generate(&h.e);
    fund(&h, &alice, &1_000_000);

    let minted = h.wrapper.deposit(&alice, &1_000_000);
    // first deposit nets the dead-shares seed
    assert_eq!(minted, 1_000_000 - DEAD_SHARES);
    assert_eq!(h.wrapper.balance(&alice), 1_000_000 - DEAD_SHARES);
    assert_eq!(h.wrapper.exchange_rate(), RATE_ONE);

    let back = h.wrapper.redeem(&alice, &minted);
    // Alice recovers her stake minus the dead-shares dust left in the wrapper.
    assert_eq!(back, 1_000_000 - DEAD_SHARES);
    assert_eq!(h.rwa.balance(&alice), 1_000_000 - DEAD_SHARES);
    assert_eq!(h.wrapper.balance(&alice), 0);
}

/// THE KEY TEST: deposit -> underlying.accrue -> redeem returns MORE underlying
/// while the holder's SHARE balance is unchanged across the accrual.
#[test]
fn yield_accrues_to_share_holder_without_changing_share_balance() {
    let h = setup();
    let alice = Address::generate(&h.e);
    fund(&h, &alice, &1_000_000);

    let shares = h.wrapper.deposit(&alice, &1_000_000);
    let shares_before = h.wrapper.balance(&alice);
    let rate_before = h.wrapper.exchange_rate();
    assert_eq!(rate_before, RATE_ONE);

    // Simulate 6 months of interest: +5%.
    h.rwa.accrue(&500);

    // Share balance is UNCHANGED by the rebase — the hidden number is stable.
    let shares_after = h.wrapper.balance(&alice);
    assert_eq!(shares_before, shares_after, "share balance must not change on accrual");

    // Exchange rate rose ~5%.
    let rate_after = h.wrapper.exchange_rate();
    assert!(rate_after > rate_before, "rate must rise: {} -> {}", rate_before, rate_after);

    // Redeem the SAME share count -> MORE underlying than deposited.
    let returned = h.wrapper.redeem(&alice, &shares);
    assert!(
        returned > 1_000_000 - DEAD_SHARES,
        "yield: redeemed {} should exceed deposited stake {}",
        returned,
        1_000_000 - DEAD_SHARES
    );
    // ~5% more than the net stake (dead shares retain a sliver).
    let net_stake = 1_000_000 - DEAD_SHARES;
    let expected = net_stake + net_stake * 5 / 100;
    let drift = (returned - expected).abs();
    assert!(drift <= 5_000, "returned {} ~ expected {} (drift {})", returned, expected, drift);
}

#[test]
fn two_depositors_split_yield_pro_rata() {
    let h = setup();
    let alice = Address::generate(&h.e);
    let bob = Address::generate(&h.e);
    fund(&h, &alice, &1_000_000);
    fund(&h, &bob, &3_000_000);

    let a_shares = h.wrapper.deposit(&alice, &1_000_000);
    let b_shares = h.wrapper.deposit(&bob, &3_000_000);

    // Bob deposited 3x after dead-shares only affected the first deposit, so
    // bob should hold ~3x alice's shares.
    assert!(b_shares > a_shares * 29 / 10 && b_shares < a_shares * 31 / 10);

    h.rwa.accrue(&1_000); // +10% on the whole pool

    let a_out = h.wrapper.redeem(&alice, &a_shares);
    let b_out = h.wrapper.redeem(&bob, &b_shares);

    // Each holder gets ~10% more than their stake; ratio of payouts ~= 3:1.
    assert!(a_out > 1_000_000 - DEAD_SHARES);
    assert!(b_out > 3_000_000);
    let ratio_x10 = b_out * 10 / a_out;
    assert!((29..=31).contains(&ratio_x10), "payout ratio x10 = {}", ratio_x10);
}

/// First-deposit inflation attack is mitigated: the attacker locks dead shares,
/// donates a large amount, but a later honest depositor still gets fair shares
/// (does NOT round to zero) and can redeem a fair amount back.
#[test]
fn first_deposit_inflation_attack_is_mitigated() {
    let h = setup();
    let attacker = Address::generate(&h.e);
    let victim = Address::generate(&h.e);

    // Attacker makes the smallest allowed first deposit.
    fund(&h, &attacker, &(DEAD_SHARES + 1));
    let atk_shares = h.wrapper.deposit(&attacker, &(DEAD_SHARES + 1));
    assert_eq!(atk_shares, 1); // attacker ends up with just 1 share

    // Attacker donates a large amount directly to the wrapper to inflate price/share.
    fund(&h, &attacker, &1_000_000);
    h.rwa.transfer(&attacker, &h.wrapper.address, &1_000_000);

    // Victim deposits a normal amount. With dead shares seeding the supply, the
    // victim still receives > 0 shares (attack would otherwise round to 0).
    fund(&h, &victim, &5_000_000);
    let victim_shares = h.wrapper.deposit(&victim, &5_000_000);
    assert!(victim_shares > 0, "victim must receive non-zero shares");

    // Victim can redeem back close to what they put in (not stolen by attacker).
    let victim_out = h.wrapper.redeem(&victim, &victim_shares);
    assert!(
        victim_out >= 5_000_000 * 90 / 100,
        "victim recovered {} of 5_000_000",
        victim_out
    );

    // Attacker with 1 share cannot drain more than their fair sliver.
    let attacker_out = h.wrapper.redeem(&attacker, &atk_shares);
    assert!(
        attacker_out < 5_000_000,
        "attacker drained {} which must be far below victim stake",
        attacker_out
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn first_deposit_below_dead_shares_panics() {
    let h = setup();
    let alice = Address::generate(&h.e);
    fund(&h, &alice, &DEAD_SHARES);
    h.wrapper.deposit(&alice, &DEAD_SHARES); // == DEAD_SHARES, not > it
}

#[test]
fn share_token_transfer_is_non_rebasing() {
    let h = setup();
    let alice = Address::generate(&h.e);
    let bob = Address::generate(&h.e);
    fund(&h, &alice, &1_000_000);
    let shares = h.wrapper.deposit(&alice, &1_000_000);

    h.wrapper.transfer(&alice, &bob, &100);
    assert_eq!(h.wrapper.balance(&alice), shares - 100);
    assert_eq!(h.wrapper.balance(&bob), 100);

    // Accrual does not change any share balance (non-rebasing invariant).
    let a = h.wrapper.balance(&alice);
    let b = h.wrapper.balance(&bob);
    h.rwa.accrue(&2_000);
    assert_eq!(h.wrapper.balance(&alice), a);
    assert_eq!(h.wrapper.balance(&bob), b);
}

#[test]
fn metadata_and_underlying() {
    let h = setup();
    assert_eq!(h.wrapper.decimals(), 7);
    assert_eq!(h.wrapper.symbol(), String::from_str(&h.e, "wsFUND"));
    assert_eq!(h.wrapper.underlying(), h.rwa.address);
}
