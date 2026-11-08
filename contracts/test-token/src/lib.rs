//! A NEP-141 token anyone can mint from, in amounts capped per call. It
//! exists so that Setoff can be tried end to end on testnet with no real
//! money; it has no value and must never be deployed to mainnet.

// Contract methods receive their JSON arguments by value.
#![allow(clippy::needless_pass_by_value)]

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken {
    token: FungibleToken,
    name: String,
    symbol: String,
    decimals: u8,
    /// Most tokens one faucet call can mint.
    faucet_cap: u128,
}

impl std::fmt::Debug for TestToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TestToken").field("symbol", &self.symbol).finish_non_exhaustive()
    }
}

#[near]
impl TestToken {
    #[init]
    pub fn new(name: String, symbol: String, decimals: u8, faucet_cap: U128) -> Self {
        require!(faucet_cap.0 > 0, "faucet cap must be positive");
        Self {
            token: FungibleToken::new(StorageKey::Token),
            name,
            symbol,
            decimals,
            faucet_cap: faucet_cap.0,
        }
    }

    /// Mints `amount` to the caller, who must already be registered with
    /// `storage_deposit`.
    pub fn faucet(&mut self, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= self.faucet_cap, "amount must be between 1 and the faucet cap");
        let account = env::predecessor_account_id();
        require!(self.token.accounts.contains_key(&account), "register with storage_deposit first");
        self.token.internal_deposit(&account, amount.0);
        FtMint { owner_id: &account, amount, memo: Some("faucet") }.emit();
    }

    pub fn faucet_cap(&self) -> U128 {
        U128(self.faucet_cap)
    }
}

#[near]
impl FungibleTokenCore for TestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestToken {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        U128(used)
    }
}

#[near]
impl StorageManagement for TestToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_owned(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: self.decimals,
        }
    }
}

#[cfg(test)]
mod tests {
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    use super::*;

    fn call(caller: &str, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(caller.parse().unwrap())
            .attached_deposit(deposit)
            .build());
    }

    fn token() -> TestToken {
        call("owner.test", NearToken::from_yoctonear(0));
        TestToken::new("Setoff Test Dollar".into(), "tUSD".into(), 6, U128(1_000_000_000))
    }

    #[test]
    fn a_registered_account_mints_up_to_the_cap() {
        let mut token = token();
        call("ana.test", NearToken::from_millinear(10));
        token.storage_deposit(None, None);
        call("ana.test", NearToken::from_yoctonear(0));
        token.faucet(U128(1_000_000_000));
        assert_eq!(token.ft_balance_of("ana.test".parse().unwrap()), U128(1_000_000_000));
    }

    #[test]
    #[should_panic(expected = "amount must be between 1 and the faucet cap")]
    fn the_faucet_is_capped() {
        let mut token = token();
        call("ana.test", NearToken::from_millinear(10));
        token.storage_deposit(None, None);
        token.faucet(U128(1_000_000_001));
    }

    #[test]
    #[should_panic(expected = "register with storage_deposit first")]
    fn unregistered_accounts_cannot_mint() {
        let mut token = token();
        call("ana.test", NearToken::from_yoctonear(0));
        token.faucet(U128(1));
    }
}
