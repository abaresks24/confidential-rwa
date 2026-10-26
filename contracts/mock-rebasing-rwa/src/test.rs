#![cfg(test)]
extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{MockRebasingRwa, MockRebasingRwaClient, INDEX_ONE};

fn setup(e: &Env) -> (MockRebasingRwaClient<'_>, Address) {
    let admin = Address::generate(e);
    let id = e.register(
        MockRebasingRwa,
        (admin.clone(), 7u32, String::from_str(e, "rtFUND"), String::from_str(e, "RTF")),
    );
    (MockRebasingRwaClient::new(e, &id), admin)
}

#[test]
fn mint_then_balance_reflects_index() {
    let e = Env::default();
    e.mock_all_auths();
    let (rwa, _admin) = setup(&e);
    let alice = Address::generate(&e);

    // Mint 100 raw units. index == INDEX_ONE so reported == 100.
    rwa.mint(&alice, &100);
    assert_eq!(rwa.index(), INDEX_ONE);
    assert_eq!(rwa.raw_balance(&alice), 100);
    assert_eq!(rwa.balance(&alice), 100);
}

#[test]
fn accrue_grows_every_holder_proportionally() {
    let e = Env::default();
    e.mock_all_auths();
    let (rwa, _admin) = setup(&e);
    let alice = Address::generate(&e);
    let bob = Address::generate(&e);

    rwa.mint(&alice, &100);
    rwa.mint(&bob, &300);

    // +5% (500 bps)
    rwa.accrue(&500);

    // raw unchanged, reported balance grows 5%
    assert_eq!(rwa.raw_balance(&alice), 100);
    assert_eq!(rwa.raw_balance(&bob), 300);
    assert_eq!(rwa.balance(&alice), 105);
    assert_eq!(rwa.balance(&bob), 315);
    assert_eq!(rwa.index(), INDEX_ONE * 10_500 / 10_000);
}

#[test]
fn transfer_preserves_total_supply_across_accrue() {
    let e = Env::default();
    e.mock_all_auths();
    let (rwa, _admin) = setup(&e);
    let alice = Address::generate(&e);
    let bob = Address::generate(&e);

    rwa.mint(&alice, &1_000_000);
    rwa.accrue(&1_000); // +10%

    let total_before = rwa.balance(&alice) + rwa.balance(&bob);
    rwa.transfer(&alice, &bob, &400_000);
    let total_after = rwa.balance(&alice) + rwa.balance(&bob);

    // ceil-rounding on the raw conversion may cost at most 1 unit of reported dust.
    assert!((total_before - total_after).abs() <= 1, "supply drift {} -> {}", total_before, total_after);
    assert!(rwa.balance(&bob) >= 400_000);
}

#[test]
fn allowance_transfer_from() {
    let e = Env::default();
    e.mock_all_auths();
    let (rwa, _admin) = setup(&e);
    let alice = Address::generate(&e);
    let spender = Address::generate(&e);
    let bob = Address::generate(&e);

    rwa.mint(&alice, &1_000);
    rwa.approve(&alice, &spender, &500, &1_000);
    assert_eq!(rwa.allowance(&alice, &spender), 500);

    rwa.transfer_from(&spender, &alice, &bob, &200);
    assert_eq!(rwa.balance(&bob), 200);
    assert_eq!(rwa.allowance(&alice, &spender), 300);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn transfer_insufficient_balance_panics() {
    let e = Env::default();
    e.mock_all_auths();
    let (rwa, _admin) = setup(&e);
    let alice = Address::generate(&e);
    let bob = Address::generate(&e);

    rwa.mint(&alice, &10);
    rwa.transfer(&alice, &bob, &1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn accrue_zero_bps_panics() {
    let e = Env::default();
    e.mock_all_auths();
    let (rwa, _admin) = setup(&e);
    rwa.accrue(&0);
}

#[test]
fn metadata() {
    let e = Env::default();
    e.mock_all_auths();
    let (rwa, _admin) = setup(&e);
    assert_eq!(rwa.decimals(), 7);
    assert_eq!(rwa.name(), String::from_str(&e, "rtFUND"));
    assert_eq!(rwa.symbol(), String::from_str(&e, "RTF"));
}
