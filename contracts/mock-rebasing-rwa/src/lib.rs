#![no_std]
//! # mock-rebasing-rwa (rtFUND)
//!
//! A deliberately simple **rebasing** SEP-41 token that stands in for a
//! yield-bearing RWA like Franklin Templeton's BENJI (interest paid as new
//! shares). Balances grow when the admin calls [`MockRebasingRwa::accrue`]:
//! internally each holder keeps a fixed `raw` amount and the reported balance
//! is `raw * index / INDEX_ONE`. Bumping `index` rebases every holder at once.
//!
//! This is a TEST asset. It exists so the ShareWrapper has a credible rebasing
//! underlying to wrap on testnet (no real rebasing RWA is available there).
//!
//! Conventions mirror OZ v0.8.0 (`reference/stellar-contracts/CLAUDE.md`):
//! `panic_with_error!` not `unwrap`, storage TTL trio, section delimiters,
//! event helpers, checked math. The `index`/`raw` split is custom — it is what
//! makes the ShareWrapper demo work.
use soroban_sdk::{contract, contracterror, contractimpl, Address, Env, String};

mod contract;
#[cfg(test)]
mod test;

/// Fixed-point scale for `index` (1.0 == INDEX_ONE).
pub const INDEX_ONE: i128 = 1_0000000; // 7 dp, matches Stellar classic

// ----- TTL trio (mirrors OZ `BALANCE_*`) -----
const DAY_IN_LEDGERS: u32 = 17280;
pub const BALANCE_EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const BALANCE_TTL_THRESHOLD: u32 = BALANCE_EXTEND_AMOUNT - DAY_IN_LEDGERS;
pub const ALLOWANCE_EXTEND_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
pub const ALLOWANCE_TTL_THRESHOLD: u32 = ALLOWANCE_EXTEND_AMOUNT - DAY_IN_LEDGERS;
pub const INSTANCE_EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_EXTEND_AMOUNT - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RwaError {
    /// Negative amount supplied where a non-negative value is required.
    LessThanZero = 1,
    /// Arithmetic over/underflow.
    MathOverflow = 2,
    /// Not enough balance for the requested operation.
    InsufficientBalance = 3,
    /// Not enough allowance for the requested operation.
    InsufficientAllowance = 4,
    /// Allowance expiry ledger is in the past (and amount > 0).
    InvalidLiveUntilLedger = 5,
    /// `accrue` was called with 0 bps (no-op disallowed to avoid empty events).
    ZeroBps = 6,
}

#[contract]
pub struct MockRebasingRwa;

#[contractimpl]
impl MockRebasingRwa {
    /// `admin` holds mint + accrue rights. `index` starts at INDEX_ONE.
    pub fn __constructor(e: &Env, admin: Address, decimals: u32, name: String, symbol: String) {
        contract::set_metadata(e, decimals, name, symbol);
        contract::set_admin(e, &admin);
        contract::set_index(e, INDEX_ONE);
    }

    /// Mint `raw_amount` raw units to `to` (admin only).
    ///
    /// The *reported* balance added is `raw_amount * index / INDEX_ONE`.
    pub fn mint(e: &Env, to: Address, raw_amount: i128) {
        let admin = contract::get_admin(e);
        admin.require_auth();
        contract::mint_raw(e, &to, raw_amount);
    }

    /// Rebase: multiply every balance by `(1 + bps/10_000)` via the index
    /// (admin only). This is how "interest accrues" in the demo.
    pub fn accrue(e: &Env, bps: u32) {
        let admin = contract::get_admin(e);
        admin.require_auth();
        contract::accrue_index(e, bps);
    }

    /// Current rebase index (scaled by [`INDEX_ONE`]).
    pub fn index(e: &Env) -> i128 {
        contract::get_index(e)
    }

    /// Admin address.
    pub fn admin(e: &Env) -> Address {
        contract::get_admin(e)
    }
}

// ################## SEP-41 TOKEN INTERFACE ##################
// `balance(a) = raw[a] * index / INDEX_ONE`. Transfers convert the requested
// (post-index) amount back into raw units and move those, so total supply is
// conserved across an accrue.
#[contractimpl]
impl MockRebasingRwa {
    pub fn balance(e: &Env, id: Address) -> i128 {
        contract::balance(e, &id)
    }

    /// Raw (pre-index) balance. Exposed for debugging/tests.
    pub fn raw_balance(e: &Env, id: Address) -> i128 {
        contract::raw_balance(e, &id)
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
        contract::burn(e, &from, amount);
    }

    pub fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        contract::spend_allowance(e, &from, &spender, amount);
        contract::burn(e, &from, amount);
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
