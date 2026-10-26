//! Storage + rebasing `index`/`raw` accounting + SEP-41 helpers for
//! [`super::MockRebasingRwa`].
//!
//! Kept in a separate module so the rebasing math and the token surface stay
//! readable. Follows the OZ fungible base shape (free functions + storage
//! keys), but balances are stored as **raw** units; the reported balance is
//! `raw * index / INDEX_ONE`.
use soroban_sdk::{
    contracttype, panic_with_error, symbol_short, Address, Env, String,
};

use crate::{
    RwaError, ALLOWANCE_EXTEND_AMOUNT, ALLOWANCE_TTL_THRESHOLD, BALANCE_EXTEND_AMOUNT,
    BALANCE_TTL_THRESHOLD, INDEX_ONE,
};

#[contracttype]
pub struct AllowanceKey {
    pub owner: Address,
    pub spender: Address,
}

#[contracttype]
pub struct AllowanceData {
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contracttype]
pub struct Metadata {
    pub decimals: u32,
    pub name: String,
    pub symbol: String,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Index,
    Meta,
    /// Raw (pre-index) balance of an address.
    RawBalance(Address),
    Allowance(AllowanceKey),
}

// ################## METADATA / ADMIN / INDEX ##################

pub fn set_metadata(e: &Env, decimals: u32, name: String, symbol: String) {
    e.storage().instance().set(&DataKey::Meta, &Metadata { decimals, name, symbol });
}

pub fn get_metadata(e: &Env) -> Metadata {
    e.storage()
        .instance()
        .get(&DataKey::Meta)
        .expect("metadata set in constructor")
}

pub fn set_admin(e: &Env, admin: &Address) {
    e.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Admin).expect("admin set in constructor")
}

pub fn set_index(e: &Env, index: i128) {
    e.storage().instance().set(&DataKey::Index, &index);
}

pub fn get_index(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::Index).expect("index set in constructor")
}

/// Rebase: `index = index * (10_000 + bps) / 10_000`. Checked math.
pub fn accrue_index(e: &Env, bps: u32) {
    if bps == 0 {
        panic_with_error!(e, RwaError::ZeroBps);
    }
    let index = get_index(e);
    let num = index
        .checked_mul(i128::from(10_000u32 + bps))
        .unwrap_or_else(|| panic_with_error!(e, RwaError::MathOverflow));
    let new_index = num / 10_000;
    set_index(e, new_index);
    e.events().publish((symbol_short!("accrue"), bps), new_index);
}

// ################## BALANCES (raw / reported) ##################

pub fn raw_balance(e: &Env, account: &Address) -> i128 {
    let key = DataKey::RawBalance(account.clone());
    if let Some(raw) = e.storage().persistent().get::<_, i128>(&key) {
        e.storage().persistent().extend_ttl(&key, BALANCE_TTL_THRESHOLD, BALANCE_EXTEND_AMOUNT);
        raw
    } else {
        0
    }
}

fn set_raw_balance(e: &Env, account: &Address, raw: i128) {
    let key = DataKey::RawBalance(account.clone());
    e.storage().persistent().set(&key, &raw);
    e.storage().persistent().extend_ttl(&key, BALANCE_TTL_THRESHOLD, BALANCE_EXTEND_AMOUNT);
}

/// Reported balance = `raw * index / INDEX_ONE`.
pub fn balance(e: &Env, account: &Address) -> i128 {
    let raw = raw_balance(e, account);
    let index = get_index(e);
    raw.checked_mul(index)
        .unwrap_or_else(|| panic_with_error!(e, RwaError::MathOverflow))
        / INDEX_ONE
}

/// Convert a reported amount into raw units, rounding up so that a holder can
/// always move their full reported balance (avoids dust lockups).
fn reported_to_raw_ceil(e: &Env, amount: i128) -> i128 {
    let index = get_index(e);
    let num = amount
        .checked_mul(INDEX_ONE)
        .unwrap_or_else(|| panic_with_error!(e, RwaError::MathOverflow));
    // ceil division
    (num + index - 1) / index
}

pub fn mint_raw(e: &Env, to: &Address, raw_amount: i128) {
    if raw_amount < 0 {
        panic_with_error!(e, RwaError::LessThanZero);
    }
    let cur = raw_balance(e, to);
    let new = cur
        .checked_add(raw_amount)
        .unwrap_or_else(|| panic_with_error!(e, RwaError::MathOverflow));
    set_raw_balance(e, to, new);
    e.events().publish((symbol_short!("mint"), to.clone()), raw_amount);
}

pub fn transfer(e: &Env, from: &Address, to: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(e, RwaError::LessThanZero);
    }
    let raw = reported_to_raw_ceil(e, amount);
    let from_raw = raw_balance(e, from);
    if from_raw < raw {
        panic_with_error!(e, RwaError::InsufficientBalance);
    }
    set_raw_balance(e, from, from_raw - raw);
    let to_raw = raw_balance(e, to)
        .checked_add(raw)
        .unwrap_or_else(|| panic_with_error!(e, RwaError::MathOverflow));
    set_raw_balance(e, to, to_raw);
    e.events().publish((symbol_short!("transfer"), from.clone(), to.clone()), amount);
}

pub fn burn(e: &Env, from: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(e, RwaError::LessThanZero);
    }
    let raw = reported_to_raw_ceil(e, amount);
    let from_raw = raw_balance(e, from);
    if from_raw < raw {
        panic_with_error!(e, RwaError::InsufficientBalance);
    }
    set_raw_balance(e, from, from_raw - raw);
    e.events().publish((symbol_short!("burn"), from.clone()), amount);
}

// ################## ALLOWANCES ##################

pub fn allowance(e: &Env, owner: &Address, spender: &Address) -> i128 {
    let data = allowance_data(e, owner, spender);
    if data.live_until_ledger < e.ledger().sequence() {
        return 0;
    }
    data.amount
}

fn allowance_data(e: &Env, owner: &Address, spender: &Address) -> AllowanceData {
    let key = DataKey::Allowance(AllowanceKey { owner: owner.clone(), spender: spender.clone() });
    if let Some(data) = e.storage().temporary().get::<_, AllowanceData>(&key) {
        data
    } else {
        AllowanceData { amount: 0, live_until_ledger: 0 }
    }
}

pub fn approve(e: &Env, owner: &Address, spender: &Address, amount: i128, live_until_ledger: u32) {
    if amount < 0 {
        panic_with_error!(e, RwaError::LessThanZero);
    }
    if amount > 0 && live_until_ledger < e.ledger().sequence() {
        panic_with_error!(e, RwaError::InvalidLiveUntilLedger);
    }
    let key = DataKey::Allowance(AllowanceKey { owner: owner.clone(), spender: spender.clone() });
    e.storage().temporary().set(&key, &AllowanceData { amount, live_until_ledger });
    if amount > 0 {
        let live_for = live_until_ledger
            .checked_sub(e.ledger().sequence())
            .unwrap_or(0)
            .max(ALLOWANCE_TTL_THRESHOLD);
        e.storage().temporary().extend_ttl(&key, live_for, ALLOWANCE_EXTEND_AMOUNT.max(live_for));
    }
    e.events().publish((symbol_short!("approve"), owner.clone(), spender.clone()), (amount, live_until_ledger));
}

pub fn spend_allowance(e: &Env, owner: &Address, spender: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(e, RwaError::LessThanZero);
    }
    let data = allowance_data(e, owner, spender);
    let current = if data.live_until_ledger < e.ledger().sequence() { 0 } else { data.amount };
    if current < amount {
        panic_with_error!(e, RwaError::InsufficientAllowance);
    }
    let key = DataKey::Allowance(AllowanceKey { owner: owner.clone(), spender: spender.clone() });
    e.storage()
        .temporary()
        .set(&key, &AllowanceData { amount: current - amount, live_until_ledger: data.live_until_ledger });
}
