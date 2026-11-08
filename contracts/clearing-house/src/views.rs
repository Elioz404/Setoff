use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, NearToken};

use crate::obligations::{ObligationStatus, StoredObligation};
use crate::{BalanceKey, ClearingHouse, ClearingHouseExt, Config};

/// Most entries a list view returns in one call.
const MAX_PAGE: u32 = 100;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObligationView {
    pub id: U64,
    pub debtor: AccountId,
    pub creditor: AccountId,
    pub asset: AccountId,
    pub amount: U128,
    pub outstanding: U128,
    pub cleared: U128,
    pub status: ObligationStatus,
    pub reference: String,
    pub issued_at_ns: U64,
}

impl ObligationView {
    fn new(id: u64, o: &StoredObligation) -> Self {
        Self {
            id: U64(id),
            debtor: o.debtor.clone(),
            creditor: o.creditor.clone(),
            asset: o.asset.clone(),
            amount: U128(o.amount),
            outstanding: U128(o.outstanding),
            cleared: U128(o.cleared),
            status: o.status,
            reference: o.reference.clone(),
            issued_at_ns: U64(o.issued_at_ns),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalView {
    pub solver: AccountId,
    pub cleared: U128,
    pub reductions: Vec<crate::ReductionInput>,
    pub bond: NearToken,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoundView {
    pub asset: AccountId,
    pub id: U64,
    pub closes_at_ns: Option<U64>,
    pub best: Option<ProposalView>,
}

/// What a solver has achieved in this house.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SolverStats {
    pub rounds_won: u64,
    pub cleared: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolverView {
    pub solver: AccountId,
    pub stats: SolverStats,
}

#[near]
impl ClearingHouse {
    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_assets(&self) -> Vec<AccountId> {
        self.assets.iter().cloned().collect()
    }

    pub fn get_obligation(&self, id: U64) -> Option<ObligationView> {
        self.obligations.get(&id.0).map(|o| ObligationView::new(id.0, o))
    }

    pub fn obligation_count(&self) -> U64 {
        U64(self.next_obligation_id)
    }

    /// Obligations in the order they were issued.
    pub fn list_obligations(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<ObligationView> {
        page(self.obligations.iter(), from_index, limit).map(|(id, o)| ObligationView::new(*id, o)).collect()
    }

    /// Accepted obligations in `asset` with something still outstanding: the
    /// graph a solver works on.
    pub fn list_active(
        &self,
        asset: AccountId,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<ObligationView> {
        page(self.active.iter(), from_index, limit)
            .filter_map(|id| self.obligations.get(id).map(|o| (id, o)))
            .filter(|(_, o)| o.asset == asset)
            .map(|(id, o)| ObligationView::new(*id, o))
            .collect()
    }

    pub fn active_count(&self) -> U64 {
        U64(u64::from(self.active.len()))
    }

    pub fn get_round(&self, asset: AccountId) -> RoundView {
        let round = self.round(&asset);
        RoundView {
            asset,
            id: U64(round.id),
            closes_at_ns: round.closes_at_ns.map(U64),
            best: round.best.map(|p| ProposalView {
                solver: p.solver,
                cleared: U128(p.cleared),
                reductions: p
                    .reductions
                    .into_iter()
                    .map(|(obligation, amount)| crate::ReductionInput {
                        obligation: U64(obligation),
                        amount: U128(amount),
                    })
                    .collect(),
                bond: p.bond,
            }),
        }
    }

    pub fn get_balance(&self, account: AccountId, asset: AccountId) -> U128 {
        U128(self.balances.get(&BalanceKey { account, asset }).copied().unwrap_or(0))
    }

    pub fn get_reward_pool(&self, asset: AccountId) -> U128 {
        U128(self.rewards.get(&asset).copied().unwrap_or(0))
    }

    pub fn list_solvers(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<SolverView> {
        page(self.solvers.iter(), from_index, limit)
            .map(|(solver, stats)| SolverView { solver: solver.clone(), stats: stats.clone() })
            .collect()
    }
}

fn page<I: Iterator>(items: I, from_index: Option<U64>, limit: Option<u32>) -> impl Iterator<Item = I::Item> {
    let skip = usize::try_from(from_index.map_or(0, |i| i.0)).unwrap_or(usize::MAX);
    let take = usize::try_from(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)).unwrap_or(0);
    items.skip(skip).take(take)
}
