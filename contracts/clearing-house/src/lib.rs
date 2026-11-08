//! The Setoff clearing house.
//!
//! Members record what they owe each other as obligations: a creditor issues
//! one, the debtor accepts it. Solvers then compete, round by round and per
//! asset, to propose the clearing that cancels the most debt; the contract
//! accepts a proposal only if it passes the rules in [`setoff_core`], so no
//! member's net position ever changes. What remains is paid in the asset's
//! NEP-141 token and credited to the creditor, who withdraws it.

// Contract methods receive their JSON arguments by value.
#![allow(clippy::needless_pass_by_value)]

mod clearing;
mod config;
mod events;
mod obligations;
mod payments;
mod storage;
mod views;

#[cfg(test)]
mod tests;

use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub use clearing::{ReductionInput, Round, StoredProposal};
pub use config::Config;
pub use obligations::{ObligationStatus, StoredObligation};
pub use views::{ObligationView, RoundView, SolverStats};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Assets,
    Obligations,
    Active,
    Rounds,
    Balances,
    Rewards,
    Solvers,
}

/// A member's claimable balance in one asset.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct BalanceKey {
    pub account: AccountId,
    pub asset: AccountId,
}

#[near(contract_state)]
#[derive(Debug, PanicOnDefault)]
pub struct ClearingHouse {
    owner: AccountId,
    config: Config,
    /// NEP-141 token contracts obligations may be denominated in.
    assets: IterableSet<AccountId>,
    obligations: IterableMap<u64, StoredObligation>,
    /// Ids of accepted obligations that still have something outstanding.
    active: IterableSet<u64>,
    next_obligation_id: u64,
    /// The clearing round of each asset.
    rounds: LookupMap<AccountId, Round>,
    /// Amounts credited to members and solvers, waiting to be withdrawn.
    balances: LookupMap<BalanceKey, u128>,
    /// Tokens members put aside, per asset, to reward the solvers that clear their debt.
    rewards: LookupMap<AccountId, u128>,
    solvers: IterableMap<AccountId, SolverStats>,
}

#[near]
impl ClearingHouse {
    /// Deploys the clearing house. The configuration is fixed for the life of
    /// the contract, so members can read the rules once and rely on them.
    #[init]
    pub fn new(owner: AccountId, config: Config, assets: Vec<AccountId>) -> Self {
        config.validate();
        let mut house = Self {
            owner,
            config,
            assets: IterableSet::new(StorageKey::Assets),
            obligations: IterableMap::new(StorageKey::Obligations),
            active: IterableSet::new(StorageKey::Active),
            next_obligation_id: 0,
            rounds: LookupMap::new(StorageKey::Rounds),
            balances: LookupMap::new(StorageKey::Balances),
            rewards: LookupMap::new(StorageKey::Rewards),
            solvers: IterableMap::new(StorageKey::Solvers),
        };
        for asset in assets {
            house.insert_asset(asset);
        }
        house
    }

    /// Accepts obligations in one more NEP-141 token. Only the owner can call
    /// it, and pays for the storage it adds.
    #[payable]
    pub fn add_asset(&mut self, asset: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can add assets");
        let before = self.storage_usage();
        self.insert_asset(asset);
        let after = self.storage_usage();
        storage::charge(before, after, &self.owner);
    }
}

impl ClearingHouse {
    fn insert_asset(&mut self, asset: AccountId) {
        require!(self.assets.insert(asset.clone()), "asset is already accepted");
        self.rounds.insert(asset.clone(), Round::first());
        self.rewards.insert(asset, 0);
    }

    /// Bytes the contract uses, counting changes not yet written: collections
    /// only write when flushed, so measuring without this would miss them and
    /// let callers add storage without paying for it.
    fn storage_usage(&mut self) -> u64 {
        self.assets.flush();
        self.obligations.flush();
        self.active.flush();
        self.rounds.flush();
        self.balances.flush();
        self.rewards.flush();
        self.solvers.flush();
        env::storage_usage()
    }

    fn require_asset(&self, asset: &AccountId) {
        require!(self.assets.contains(asset), "asset is not accepted by this clearing house");
    }

    fn credit(&mut self, key: BalanceKey, amount: u128) {
        let balance = self.balances.entry(key).or_insert(0);
        *balance = balance.checked_add(amount).unwrap_or_else(|| env::panic_str("balance overflow"));
    }
}
