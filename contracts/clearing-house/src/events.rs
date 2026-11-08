//! NEP-297 events, so indexers and the web page can follow the house without
//! reading its state.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, NearToken};

#[near(event_json(standard = "setoff"))]
pub enum Event {
    #[event_version("1.0.0")]
    MemberAdmitted { account: AccountId },
    #[event_version("1.0.0")]
    MemberExpelled { account: AccountId },
    #[event_version("1.0.0")]
    ObligationIssued {
        id: U64,
        debtor: AccountId,
        creditor: AccountId,
        asset: AccountId,
        amount: U128,
        reference: String,
    },
    #[event_version("1.0.0")]
    ObligationAccepted { id: U64 },
    #[event_version("1.0.0")]
    ObligationRejected { id: U64 },
    #[event_version("1.0.0")]
    ObligationWithdrawn { id: U64 },
    #[event_version("1.0.0")]
    PaymentApplied { id: U64, payer: AccountId, amount: U128, remaining: U128 },
    #[event_version("1.0.0")]
    ProposalSubmitted { asset: AccountId, round: U64, solver: AccountId, cleared: U128 },
    #[event_version("1.0.0")]
    ClearingApplied {
        asset: AccountId,
        round: U64,
        solver: AccountId,
        cleared: U128,
        reward: U128,
        reductions: u32,
    },
    #[event_version("1.0.0")]
    RoundDiscarded { asset: AccountId, round: U64, reason: String },
    #[event_version("1.0.0")]
    BondReturned { solver: AccountId, amount: NearToken },
    #[event_version("1.0.0")]
    BondReturnFailed { solver: AccountId, amount: NearToken },
    #[event_version("1.0.0")]
    OwnershipTransferred { from: AccountId, to: AccountId },
    #[event_version("1.0.0")]
    RewardsFunded { asset: AccountId, by: AccountId, amount: U128 },
    #[event_version("1.0.0")]
    BalanceWithdrawn { account: AccountId, asset: AccountId, amount: U128 },
    #[event_version("1.0.0")]
    WithdrawalFailed { account: AccountId, asset: AccountId, amount: U128 },
}
