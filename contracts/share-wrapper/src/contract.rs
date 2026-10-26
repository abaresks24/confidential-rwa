//! SEP-41 share-token impl + storage + share math for [`super::ShareWrapper`].
//!
//! The deposit/redeem rate math is the heart of the project; it is tested at
//! the unit level in `test.rs`. Share accounting is a plain non-rebasing
//! fungible token (free functions + storage keys, OZ style). The underlying is
//! held on the underlying SEP-41 at the wrapper's own address, so
//! `total_underlying` is simply `underlying.balance(this_contract)` — which is
//! exactly what grows when the underlying rebases.
use soroban_sdk::{
    contracttype, panic_with_error, symbol_short, token, Address, Env, String,
};

use crate::{
    WrapperError, ALLOWANCE_EXTEND_AMOUNT, ALLOWANCE_TTL_THRESHOLD, BALANCE_EXTEND_AMOUNT,
    BALANCE_TTL_THRESHOLD, DEAD_SHARES, RATE_ONE,
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
    Underlying,
    Admin,
    Meta,
    TotalShares,
    ShareBalance(Address),
    Allowance(AllowanceKey),
}

// ################## CONFIG / METADATA ##################

pub fn set_underlying(e: &Env, underlying: &Address) {
    e.storage().instance().set(&DataKey::Underlying, underlying);
}

pub fn get_underlying(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Underlying).expect("underlying set in constructor")
}

pub fn set_admin(e: &Env, admin: &Address) {
    e.storage().instance().set(&DataKey::Admin, admin);
}

pub fn set_metadata(e: &Env, decimals: u32, name: String, symbol: String) {
    e.storage().instance().set(&DataKey::Meta, &Metadata { decimals, name, symbol });
}

pub fn get_metadata(e: &Env) -> Metadata {
    e.storage().instance().get(&DataKey::Meta).expect("metadata set in constructor")
}

// ################## SHARE SUPPLY / BALANCES ##################

pub fn set_total_shares(e: &Env, total: i128) {
    e.storage().instance().set(&DataKey::TotalShares, &total);
}

pub fn get_total_shares(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
}

pub fn balance(e: &Env, account: &Address) -> i128 {
    let key = DataKey::ShareBalance(account.clone());
    if let Some(bal) = e.storage().persistent().get::<_, i128>(&key) {
        e.storage().persistent().extend_ttl(&key, BALANCE_TTL_THRESHOLD, BALANCE_EXTEND_AMOUNT);
        bal
    } else {
        0
    }
}

fn set_balance(e: &Env, account: &Address, amount: i128) {
    let key = DataKey::ShareBalance(account.clone());
    e.storage().persistent().set(&key, &amount);
    e.storage().persistent().extend_ttl(&key, BALANCE_TTL_THRESHOLD, BALANCE_EXTEND_AMOUNT);
}

fn mint_shares(e: &Env, to: &Address, amount: i128) {
    let new_bal = balance(e, to)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow));
    set_balance(e, to, new_bal);
    let new_total = get_total_shares(e)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow));
    set_total_shares(e, new_total);
    e.events().publish((symbol_short!("mint"), to.clone()), amount);
}

/// Internal share burn used by both `redeem` and the SEP-41 `burn` surface.
pub fn burn_shares(e: &Env, from: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    let bal = balance(e, from);
    if bal < amount {
        panic_with_error!(e, WrapperError::InsufficientBalance);
    }
    set_balance(e, from, bal - amount);
    let new_total = get_total_shares(e)
        .checked_sub(amount)
        .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow));
    set_total_shares(e, new_total);
    e.events().publish((symbol_short!("burn"), from.clone()), amount);
}

pub fn transfer(e: &Env, from: &Address, to: &Address, amount: i128) {
    if amount < 0 {
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    let from_bal = balance(e, from);
    if from_bal < amount {
        panic_with_error!(e, WrapperError::InsufficientBalance);
    }
    set_balance(e, from, from_bal - amount);
    let to_bal = balance(e, to)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow));
    set_balance(e, to, to_bal);
    e.events().publish((symbol_short!("transfer"), from.clone(), to.clone()), amount);
}

// ################## UNDERLYING / RATE MATH ##################

/// Underlying held by the wrapper = underlying.balance(this contract).
/// This grows automatically when the underlying rebases.
pub fn total_underlying(e: &Env) -> i128 {
    let underlying = get_underlying(e);
    token::TokenClient::new(e, &underlying).balance(&e.current_contract_address())
}

/// underlying-per-share scaled by RATE_ONE. 1:1 when no shares.
pub fn exchange_rate(e: &Env) -> i128 {
    let shares = get_total_shares(e);
    if shares == 0 {
        return RATE_ONE;
    }
    total_underlying(e)
        .checked_mul(RATE_ONE)
        .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow))
        / shares
}

/// Shares for a deposit, computed against pre-deposit totals.
/// `shares = amount * total_shares / total_underlying` (floor). First deposit
/// is 1:1 against the amount.
fn shares_for_deposit(e: &Env, amount: i128, total_shares: i128, total_under: i128) -> i128 {
    if total_shares == 0 || total_under == 0 {
        // First deposit: 1 share per 1 underlying.
        amount
    } else {
        amount
            .checked_mul(total_shares)
            .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow))
            / total_under
    }
}

pub fn preview_deposit(e: &Env, underlying_amount: i128) -> i128 {
    if underlying_amount < 0 {
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    let total_shares = get_total_shares(e);
    let total_under = total_underlying(e);
    let minted = shares_for_deposit(e, underlying_amount, total_shares, total_under);
    if total_shares == 0 {
        // net of the dead-shares seed
        (minted - DEAD_SHARES).max(0)
    } else {
        minted
    }
}

pub fn preview_redeem(e: &Env, shares: i128) -> i128 {
    if shares < 0 {
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    let total_shares = get_total_shares(e);
    if total_shares == 0 {
        return 0;
    }
    shares
        .checked_mul(total_underlying(e))
        .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow))
        / total_shares
}

// ################## DEPOSIT / REDEEM ##################

pub fn deposit(e: &Env, from: &Address, underlying_amount: i128) -> i128 {
    if underlying_amount < 0 {
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    let total_shares = get_total_shares(e);
    let total_under = total_underlying(e);

    // Compute shares BEFORE pulling funds in (rate must use pre-deposit totals).
    let gross_shares = shares_for_deposit(e, underlying_amount, total_shares, total_under);

    let this = e.current_contract_address();
    // Pull the underlying into the wrapper. Requires `from`'s auth, carried by
    // the outer deposit() require_auth + sub-auth.
    let underlying = get_underlying(e);
    token::TokenClient::new(e, &underlying).transfer(from, &this, &underlying_amount);

    let minted = if total_shares == 0 {
        // First deposit: permanently lock DEAD_SHARES to the contract itself to
        // block the first-depositor inflation attack. Depositor gets the rest.
        if gross_shares <= DEAD_SHARES {
            panic_with_error!(e, WrapperError::FirstDepositTooSmall);
        }
        mint_shares(e, &this, DEAD_SHARES);
        let user_shares = gross_shares - DEAD_SHARES;
        mint_shares(e, from, user_shares);
        user_shares
    } else {
        if gross_shares <= 0 {
            panic_with_error!(e, WrapperError::ZeroShares);
        }
        mint_shares(e, from, gross_shares);
        gross_shares
    };

    e.events().publish((symbol_short!("deposit"), from.clone()), (underlying_amount, minted));
    minted
}

pub fn redeem(e: &Env, from: &Address, shares: i128) -> i128 {
    if shares < 0 {
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    if shares == 0 {
        panic_with_error!(e, WrapperError::ZeroShares);
    }
    let total_shares = get_total_shares(e);
    // underlying_out = shares * total_underlying / total_shares (floor)
    let assets = shares
        .checked_mul(total_underlying(e))
        .unwrap_or_else(|| panic_with_error!(e, WrapperError::MathOverflow))
        / total_shares;
    if assets <= 0 {
        panic_with_error!(e, WrapperError::ZeroAssets);
    }

    // Burn first (checks sufficient balance), then pay out.
    burn_shares(e, from, shares);

    let underlying = get_underlying(e);
    token::TokenClient::new(e, &underlying).transfer(
        &e.current_contract_address(),
        from,
        &assets,
    );

    e.events().publish((symbol_short!("redeem"), from.clone()), (shares, assets));
    assets
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
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    if amount > 0 && live_until_ledger < e.ledger().sequence() {
        panic_with_error!(e, WrapperError::InvalidLiveUntilLedger);
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
        panic_with_error!(e, WrapperError::LessThanZero);
    }
    let data = allowance_data(e, owner, spender);
    let current = if data.live_until_ledger < e.ledger().sequence() { 0 } else { data.amount };
    if current < amount {
        panic_with_error!(e, WrapperError::InsufficientAllowance);
    }
    let key = DataKey::Allowance(AllowanceKey { owner: owner.clone(), spender: spender.clone() });
    e.storage()
        .temporary()
        .set(&key, &AllowanceData { amount: current - amount, live_until_ledger: data.live_until_ledger });
}
