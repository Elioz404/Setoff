use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId};

use crate::events::Event;
use crate::{storage, BalanceKey, ClearingHouse, ClearingHouseExt};

/// Longest reference (an invoice number, for instance) an obligation may carry.
pub const MAX_REFERENCE_LEN: usize = 64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObligationStatus {
    /// Issued by the creditor, waiting for the debtor.
    Pending,
    /// Accepted by the debtor: payable, and open to set-off.
    Active,
    /// Nothing left outstanding, by payment or set-off.
    Discharged,
    /// Refused by the debtor.
    Rejected,
    /// Taken back by the creditor before the debtor answered.
    Withdrawn,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredObligation {
    pub debtor: AccountId,
    pub creditor: AccountId,
    pub asset: AccountId,
    /// Amount the debtor accepted.
    pub amount: u128,
    pub outstanding: u128,
    /// Part of `amount` discharged by set-off rather than payment.
    pub cleared: u128,
    pub status: ObligationStatus,
    pub reference: String,
    pub issued_at_ns: u64,
}

#[near]
impl ClearingHouse {
    /// Records that `debtor` owes the caller `amount` of `asset`. Both must be
    /// members. The debtor still has to accept it before it can be paid or
    /// cleared. The caller
    /// pays for its storage, including the balance entry future payments are
    /// credited to.
    #[payable]
    pub fn issue(&mut self, debtor: AccountId, asset: AccountId, amount: U128, reference: String) -> U64 {
        let creditor = env::predecessor_account_id();
        require!(debtor != creditor, "an obligation needs two different parties");
        require!(amount.0 > 0, "amount must be positive");
        require!(reference.len() <= MAX_REFERENCE_LEN, "reference is longer than 64 bytes");
        self.require_asset(&asset);
        self.require_member(&creditor);
        self.require_member(&debtor);

        let before = self.storage_usage();
        let id = self.next_obligation_id;
        self.next_obligation_id += 1;
        self.balances.entry(BalanceKey { account: creditor.clone(), asset: asset.clone() }).or_insert(0);
        self.obligations.insert(
            id,
            StoredObligation {
                debtor: debtor.clone(),
                creditor: creditor.clone(),
                asset: asset.clone(),
                amount: amount.0,
                outstanding: amount.0,
                cleared: 0,
                status: ObligationStatus::Pending,
                reference: reference.clone(),
                issued_at_ns: env::block_timestamp(),
            },
        );
        let after = self.storage_usage();
        storage::charge(before, after, &creditor);
        Event::ObligationIssued { id: U64(id), debtor, creditor, asset, amount, reference }.emit();
        U64(id)
    }

    /// The debtor confirms an obligation. From then on it can be paid, and it
    /// can be reduced by set-off. The debtor pays for the storage this adds.
    #[payable]
    pub fn accept(&mut self, id: U64) {
        let caller = env::predecessor_account_id();
        let obligation = self.pending_obligation(id.0);
        require!(obligation.debtor == caller, "only the debtor can accept an obligation");
        self.require_member(&caller);
        let before = self.storage_usage();
        self.set_status(id.0, ObligationStatus::Active);
        self.active.insert(id.0);
        let after = self.storage_usage();
        storage::charge(before, after, &caller);
        Event::ObligationAccepted { id }.emit();
    }

    /// The debtor refuses an obligation it does not recognise.
    pub fn reject(&mut self, id: U64) {
        let obligation = self.pending_obligation(id.0);
        require!(
            obligation.debtor == env::predecessor_account_id(),
            "only the debtor can reject an obligation"
        );
        self.set_status(id.0, ObligationStatus::Rejected);
        Event::ObligationRejected { id }.emit();
    }

    /// The creditor takes back an obligation the debtor has not answered yet.
    pub fn withdraw(&mut self, id: U64) {
        let obligation = self.pending_obligation(id.0);
        require!(
            obligation.creditor == env::predecessor_account_id(),
            "only the creditor can withdraw an obligation"
        );
        self.set_status(id.0, ObligationStatus::Withdrawn);
        Event::ObligationWithdrawn { id }.emit();
    }
}

impl ClearingHouse {
    fn pending_obligation(&self, id: u64) -> StoredObligation {
        let obligation = self.obligation(id);
        require!(obligation.status == ObligationStatus::Pending, "obligation is no longer pending");
        obligation
    }

    pub(crate) fn obligation(&self, id: u64) -> StoredObligation {
        self.obligations.get(&id).cloned().unwrap_or_else(|| env::panic_str("unknown obligation"))
    }

    fn set_status(&mut self, id: u64, status: ObligationStatus) {
        if let Some(obligation) = self.obligations.get_mut(&id) {
            obligation.status = status;
        }
    }

    /// Takes `amount` off an active obligation, by payment or by set-off, and
    /// discharges it when nothing is left. Returns what remains outstanding.
    pub(crate) fn reduce(&mut self, id: u64, amount: u128, by_set_off: bool) -> u128 {
        let obligation =
            self.obligations.get_mut(&id).unwrap_or_else(|| env::panic_str("unknown obligation"));
        require!(obligation.status == ObligationStatus::Active, "obligation is not active");
        obligation.outstanding = obligation
            .outstanding
            .checked_sub(amount)
            .unwrap_or_else(|| env::panic_str("reduction exceeds what is outstanding"));
        if by_set_off {
            obligation.cleared += amount;
        }
        let remaining = obligation.outstanding;
        if remaining == 0 {
            obligation.status = ObligationStatus::Discharged;
            self.active.remove(&id);
        }
        remaining
    }
}
