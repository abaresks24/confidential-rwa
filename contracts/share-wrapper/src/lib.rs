#![no_std]
//! # share-wrapper (wsFUND) — THE NOVEL CONTRACT
//!
//! A wstETH-style **non-rebasing** share token over a **rebasing** SEP-41
//! underlying (see `mock-rebasing-rwa`). This is what lets a rebasing RWA be
//! wrapped by OpenZeppelin's confidential token, whose underlying MUST be
//! non-rebasing (`reference/.../system-model.md` Underlying Token Assumptions).
//!
//! ## Model
//! - The wrapper holds the underlying. Users hold **shares**.
//! - `deposit(underlying_amount)` mints
//!   `shares = underlying_amount * total_shares / total_underlying`
//!   (first deposit: ~1:1, minus the dead-shares seed — see below).
//! - `redeem(shares)` returns
//!   `underlying = shares * total_underlying / total_shares`.
//! - When the underlying rebases (interest), `total_underlying` held by the
//!   wrapper grows, `total_shares` stays fixed → **exchange rate rises**, share
//!   count is stable.
//!
//! Because the share count never changes on accrual, it is a valid confidential
//! underlying: the encrypted balance (a share count) is stable, yield surfaces
//! as a public, readable exchange rate. That is the core idea of the project.
//!
//! ## First-deposit inflation guard
//! Classic ERC4626 attack: the first depositor mints 1 wei of shares, then
//! donates a large amount of underlying directly, inflating the price per share
//! so a later depositor's deposit rounds down to 0 shares. We mitigate with
//! OpenZeppelin's "dead shares" approach: on the very first deposit we
//! permanently lock [`DEAD_SHARES`] shares to the contract address and credit
//! the depositor the remainder. Combined with checked, floor-rounded math this
//! bounds the attacker's achievable price-per-share inflation.
//!
//! The share token itself is a plain non-rebasing SEP-41 (no fee on transfer,
//! deterministic revert) so it satisfies the OZ Underlying Token Assumptions.
use soroban_sdk::{contract, contracterror, contractimpl, Address, Env, String};

mod contract;
#[cfg(test)]
mod test;

/// Exchange-rate fixed-point scale (underlying-per-share * RATE_ONE).
pub const RATE_ONE: i128 = 1_0000000; // 7 dp

/// Dead shares permanently locked on the first deposit to block the
/// first-depositor inflation attack (mirrors OZ ERC4626 virtual/dead shares).
pub const DEAD_SHARES: i128 = 1_000;

// ----- TTL trio (mirrors OZ `BALANCE_*`) -----
const DAY_IN_LEDGERS: u32 = 17280;
pub const BALANCE_EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const BALANCE_TTL_THRESHOLD: u32 = BALANCE_EXTEND_AMOUNT - DAY_IN_LEDGERS;
pub const ALLOWANCE_EXTEND_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
pub const ALLOWANCE_TTL_THRESHOLD: u32 = ALLOWANCE_EXTEND_AMOUNT - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum WrapperError {
    LessThanZero = 1,
    MathOverflow = 2,
    InsufficientBalance = 3,
    InsufficientAllowance = 4,
    InvalidLiveUntilLedger = 5,
    /// Deposit too small: would mint zero shares.
    ZeroShares = 6,
    /// Redeem too small: would return zero underlying.
    ZeroAssets = 7,
    /// First deposit must exceed the dead-shares seed.
    FirstDepositTooSmall = 8,
}

#[contract]
pub struct ShareWrapper;

#[contractimpl]
impl ShareWrapper {
    /// Bind the wrapper to its rebasing `underlying` SEP-41. `admin` for
    /// metadata only (no privileged runtime powers — shares are permissionless).
    pub fn __constructor(e: &Env, underlying: Address, admin: Address) {
        contract::set_underlying(e, &underlying);
        contract::set_admin(e, &admin);
        contract::set_total_shares(e, 0);
        contract::set_metadata(
            e,
            7,
            String::from_str(e, "Wrapped Share rtFUND"),
            String::from_str(e, "wsFUND"),
        );
    }

    /// Pull `underlying_amount` of the underlying from `from`, mint shares to
    /// `from`. Returns shares minted to `from`.
    pub fn deposit(e: &Env, from: Address, underlying_amount: i128) -> i128 {
        from.require_auth();
        contract::deposit(e, &from, underlying_amount)
    }

    /// Burn `shares` from `from`, return underlying to `from`. Returns the
    /// underlying amount returned.
    pub fn redeem(e: &Env, from: Address, shares: i128) -> i128 {
        from.require_auth();
        contract::redeem(e, &from, shares)
    }

    /// Underlying held by the wrapper (grows as the underlying rebases).
    pub fn total_underlying(e: &Env) -> i128 {
        contract::total_underlying(e)
    }

    /// Total shares outstanding (including the locked dead shares).
    pub fn total_shares(e: &Env) -> i128 {
        contract::get_total_shares(e)
    }

    /// Exchange rate underlying-per-share, scaled by [`RATE_ONE`]. Public; this
    /// is where yield shows. Returns `RATE_ONE` (1:1) when no shares exist.
    pub fn exchange_rate(e: &Env) -> i128 {
        contract::exchange_rate(e)
    }

    /// Underlying SEP-41 address.
    pub fn underlying(e: &Env) -> Address {
        contract::get_underlying(e)
    }

    /// Preview shares minted for a given underlying deposit (no state change).
    pub fn preview_deposit(e: &Env, underlying_amount: i128) -> i128 {
        contract::preview_deposit(e, underlying_amount)
    }

    /// Preview underlying returned for a given share redemption (no state change).
    pub fn preview_redeem(e: &Env, shares: i128) -> i128 {
        contract::preview_redeem(e, shares)
    }
}

// ################## SEP-41 SHARE TOKEN INTERFACE ##################
// Plain non-rebasing share token (valid OZ confidential underlying).
#[contractimpl]
impl ShareWrapper {
    pub fn balance(e: &Env, id: Address) -> i128 {
        contract::balance(e, &id)
    }

    pub fn allowance(e: &Env, from: Address, spender: Address) -> i128 {
        contract::allowance(e, &from, &spender)
    }

    pub fn approve(e: &Env, from: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        from.require_auth();
        contract::approve(e, &from, &spender, amount, live_until_ledger);
    }

    pub fn transfer(e: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        contract::transfer(e, &from, &to, amount);
    }

    pub fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        contract::spend_allowance(e, &from, &spender, amount);
        contract::transfer(e, &from, &to, amount);
    }

    pub fn burn(e: &Env, from: Address, amount: i128) {
        from.require_auth();
        contract::burn_shares(e, &from, amount);
    }

    pub fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        contract::spend_allowance(e, &from, &spender, amount);
        contract::burn_shares(e, &from, amount);
    }

    pub fn decimals(e: &Env) -> u32 {
        contract::get_metadata(e).decimals
    }

    pub fn name(e: &Env) -> String {
        contract::get_metadata(e).name
    }

    pub fn symbol(e: &Env) -> String {
        contract::get_metadata(e).symbol
    }
}
