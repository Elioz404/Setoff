use near_sdk::{env, near, require, AccountId};

use crate::events::Event;
use crate::{storage, ClearingHouse, ClearingHouseExt};

#[near]
impl ClearingHouse {
    /// Admits firms as members. Only the owner can do it, the way a clearing
    /// house admits the firms that sign its set-off agreement; the owner pays
    /// for the storage. The owner can be a DAO, so admissions can be voted.
    #[payable]
    pub fn admit(&mut self, accounts: Vec<AccountId>) {
        self.require_owner();
        require!(!accounts.is_empty(), "nobody to admit");
        let before = self.storage_usage();
        for account in accounts {
            if self.members.insert(account.clone()) {
                Event::MemberAdmitted { account }.emit();
            }
        }
        let after = self.storage_usage();
        storage::charge(before, after, &env::predecessor_account_id());
    }

    /// Stops a member from issuing or accepting new obligations. What it
    /// already owes, or is owed, stays payable and can still be cleared.
    pub fn expel(&mut self, account: AccountId) {
        self.require_owner();
        require!(self.members.remove(&account), "not a member");
        Event::MemberExpelled { account }.emit();
    }
}

impl ClearingHouse {
    pub(crate) fn require_member(&self, account: &AccountId) {
        if !self.members.contains(account) {
            env::panic_str(&format!("{account} is not a member of this clearing house"));
        }
    }
}
