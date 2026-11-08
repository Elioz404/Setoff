use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PromiseError, PromiseOrValue};
use setoff_core::apply_payment;

use crate::events::Event;
use crate::obligations::ObligationStatus;
use crate::{BalanceKey, ClearingHouse, ClearingHouseExt};

const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

/// What a token transfer to the clearing house is for, sent as its `msg`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferMessage {
    /// Pays towards one obligation. Anything above what is outstanding is returned.
    Pay { obligation: U64 },
    /// Adds to the pool that rewards solvers for clearing this asset.
    FundRewards,
}

#[near]
impl FungibleTokenReceiver for ClearingHouse {
    /// Receives NEP-141 tokens sent with `ft_transfer_call`. A malformed
    /// message, an unknown token or a payment that does not match an active
    /// obligation panics, and the token contract then returns the transfer.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let asset = env::predecessor_account_id();
        self.require_asset(&asset);
        let message: TransferMessage = near_sdk::serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("unreadable transfer message"));
        let unused = match message {
            TransferMessage::Pay { obligation } => self.pay(obligation.0, &asset, &sender_id, amount.0),
            TransferMessage::FundRewards => {
                let pool = self.rewards.get(&asset).copied().unwrap_or(0);
                let pool =
                    pool.checked_add(amount.0).unwrap_or_else(|| env::panic_str("reward pool overflow"));
                self.rewards.insert(asset.clone(), pool);
                Event::RewardsFunded { asset, by: sender_id, amount }.emit();
                0
            }
        };
        PromiseOrValue::Value(U128(unused))
    }
}

#[near]
impl ClearingHouse {
    /// Sends the caller's credited balance in `asset` (all of it, or `amount`)
    /// to its account on the token contract. The balance is debited first and
    /// restored if the transfer fails, for example because the caller is not
    /// registered with the token.
    #[payable]
    pub fn withdraw_balance(&mut self, asset: AccountId, amount: Option<U128>) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "attach exactly 1 yoctoNEAR");
        let account = env::predecessor_account_id();
        let key = BalanceKey { account: account.clone(), asset: asset.clone() };
        let balance = self.balances.get(&key).copied().unwrap_or(0);
        let amount = amount.map_or(balance, |a| a.0);
        require!(amount > 0, "nothing to withdraw");
        require!(amount <= balance, "amount exceeds the balance");
        self.balances.insert(key, balance - amount);

        ext_ft_core::ext(asset.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), Some("setoff balance".to_owned()))
            .then(
                Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_WITHDRAW_CALLBACK).on_withdraw(
                    account,
                    asset,
                    U128(amount),
                ),
            )
            .detach();
    }

    #[private]
    pub fn on_withdraw(
        &mut self,
        account: AccountId,
        asset: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_ok() {
            Event::BalanceWithdrawn { account, asset, amount }.emit();
        } else {
            self.credit(BalanceKey { account: account.clone(), asset: asset.clone() }, amount.0);
            Event::WithdrawalFailed { account, asset, amount }.emit();
        }
    }
}

impl ClearingHouse {
    /// Applies a payment of `paid` to obligation `id`, credits the creditor and
    /// returns the part that was not needed.
    fn pay(&mut self, id: u64, asset: &AccountId, payer: &AccountId, paid: u128) -> u128 {
        let obligation = self.obligation(id);
        require!(obligation.status == ObligationStatus::Active, "obligation is not active");
        require!(obligation.asset == *asset, "payment is in another asset than the obligation");
        let outcome = apply_payment(obligation.outstanding, paid);
        let remaining = self.reduce(id, outcome.applied, false);
        self.credit(BalanceKey { account: obligation.creditor, asset: asset.clone() }, outcome.applied);
        Event::PaymentApplied {
            id: U64(id),
            payer: payer.clone(),
            amount: U128(outcome.applied),
            remaining: U128(remaining),
        }
        .emit();
        outcome.refund
    }
}
