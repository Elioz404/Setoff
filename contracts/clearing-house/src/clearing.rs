use near_sdk::json_types::{U128, U64};
use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, NearToken, Promise};
use setoff_core::{
    validate_clearing, ClearingError, ClearingLimits, Obligation, ObligationSource, Reduction,
    ValidatedClearing,
};

use crate::events::Event;
use crate::obligations::{ObligationStatus, StoredObligation};
use crate::{storage, BalanceKey, ClearingHouse, ClearingHouseExt};

/// One line of a proposal, as solvers send it.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReductionInput {
    pub obligation: U64,
    pub amount: U128,
}

/// The best proposal of an open round.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredProposal {
    pub solver: AccountId,
    pub reductions: Vec<(u64, u128)>,
    pub cleared: u128,
    pub bond: NearToken,
}

/// The clearing round of one asset. A round opens with its first proposal and
/// closes `round_duration_ns` later; until then any solver can replace the
/// best proposal with one that clears more.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Round {
    pub id: u64,
    pub closes_at_ns: Option<u64>,
    pub best: Option<StoredProposal>,
}

impl Round {
    pub fn first() -> Self {
        Self { id: 1, closes_at_ns: None, best: None }
    }

    fn next(&self) -> Self {
        Self { id: self.id + 1, closes_at_ns: None, best: None }
    }
}

/// The contract's obligations as the clearing rules see them: only accepted
/// obligations with something outstanding are eligible.
struct Book<'a>(&'a IterableMap<u64, StoredObligation>);

impl ObligationSource<AccountId, AccountId> for Book<'_> {
    fn eligible(&self, id: u64) -> Option<Obligation<AccountId, AccountId>> {
        self.0.get(&id).filter(|o| o.status == ObligationStatus::Active && o.outstanding > 0).map(|o| {
            Obligation {
                debtor: o.debtor.clone(),
                creditor: o.creditor.clone(),
                asset: o.asset.clone(),
                outstanding: o.outstanding,
            }
        })
    }
}

#[near]
impl ClearingHouse {
    /// Proposes a clearing of `asset` obligations for the current round.
    ///
    /// The proposal must pass every set-off rule and clear strictly more than
    /// the round's best so far. The caller locks `proposal_bond`; the bond of
    /// the proposal it replaces goes back to that proposal's solver.
    #[payable]
    pub fn submit(&mut self, asset: AccountId, reductions: Vec<ReductionInput>) -> U128 {
        self.require_asset(&asset);
        let solver = env::predecessor_account_id();
        let now = env::block_timestamp();
        let mut round = self.round(&asset);
        if let Some(closes_at) = round.closes_at_ns {
            require!(now < closes_at, "the round is over: call close_round first");
        }

        let reductions: Vec<Reduction> =
            reductions.iter().map(|r| Reduction { obligation: r.obligation.0, amount: r.amount.0 }).collect();
        let validated = self
            .check(&asset, &reductions)
            .unwrap_or_else(|e| env::panic_str(&format!("clearing refused: {e}")));
        let best_so_far = round.best.as_ref().map_or(0, |p| p.cleared);
        require!(validated.cleared() > best_so_far, "the proposal does not clear more than the current best");

        let bond = self.config.proposal_bond;
        storage::collect(&solver, bond);

        if let Some(outbid) = round.best.take() {
            Promise::new(outbid.solver).transfer(outbid.bond).detach();
        }
        round.closes_at_ns.get_or_insert(now + self.config.round_duration_ns.0);
        round.best = Some(StoredProposal {
            solver: solver.clone(),
            reductions: validated.reductions().iter().map(|r| (r.obligation, r.amount)).collect(),
            cleared: validated.cleared(),
            bond,
        });
        let round_id = round.id;
        self.rounds.insert(asset.clone(), round);

        Event::ProposalSubmitted { asset, round: U64(round_id), solver, cleared: U128(validated.cleared()) }
            .emit();
        U128(validated.cleared())
    }

    /// Closes the round of `asset` once its time is up, applying the best
    /// proposal if it still passes the rules. Payments made during the round
    /// can make it stale; it is then discarded and nothing changes. Anyone can
    /// call this. The solver's bond is returned either way, less the storage
    /// its winnings take.
    pub fn close_round(&mut self, asset: AccountId) {
        self.require_asset(&asset);
        let round = self.round(&asset);
        let (Some(closes_at), Some(best)) = (round.closes_at_ns, round.best.clone()) else {
            env::panic_str("the round has no proposal yet");
        };
        require!(env::block_timestamp() >= closes_at, "the round is still open");
        self.rounds.insert(asset.clone(), round.next());

        let before = self.storage_usage();
        let reductions: Vec<Reduction> =
            best.reductions.iter().map(|&(obligation, amount)| Reduction { obligation, amount }).collect();
        match self.check(&asset, &reductions) {
            Ok(validated) => self.apply(&asset, round.id, &best.solver, &validated),
            Err(reason) => {
                Event::RoundDiscarded { asset, round: U64(round.id), reason: reason.to_string() }.emit();
            }
        }
        let after = self.storage_usage();
        let storage_cost = storage::cost(before, after);
        let refund = best.bond.saturating_sub(storage_cost);
        if !refund.is_zero() {
            Promise::new(best.solver).transfer(refund).detach();
        }
    }
}

impl ClearingHouse {
    pub(crate) fn round(&self, asset: &AccountId) -> Round {
        self.rounds.get(asset).cloned().unwrap_or_else(|| env::panic_str("asset has no round"))
    }

    fn check(
        &self,
        asset: &AccountId,
        reductions: &[Reduction],
    ) -> Result<ValidatedClearing, ClearingError<AccountId>> {
        let limits = ClearingLimits { max_reductions: self.config.max_reductions() };
        validate_clearing(&Book(&self.obligations), asset, reductions, limits)
    }

    fn apply(&mut self, asset: &AccountId, round: u64, solver: &AccountId, clearing: &ValidatedClearing) {
        for reduction in clearing.reductions() {
            self.reduce(reduction.obligation, reduction.amount, true);
        }
        let reward = self.pay_reward(asset, solver, clearing.cleared());
        let stats = self.solvers.entry(solver.clone()).or_default();
        stats.rounds_won += 1;
        stats.cleared = U128(stats.cleared.0.saturating_add(clearing.cleared()));
        Event::ClearingApplied {
            asset: asset.clone(),
            round: U64(round),
            solver: solver.clone(),
            cleared: U128(clearing.cleared()),
            reward: U128(reward),
            reductions: u32::try_from(clearing.reductions().len()).unwrap_or(u32::MAX),
        }
        .emit();
    }

    /// Moves the solver's reward out of the asset's pool into its balance.
    fn pay_reward(&mut self, asset: &AccountId, solver: &AccountId, cleared: u128) -> u128 {
        let bps = u128::from(self.config.reward_bps);
        let earned = (cleared / 10_000) * bps + (cleared % 10_000) * bps / 10_000;
        let pool = self.rewards.get(asset).copied().unwrap_or(0);
        let reward = earned.min(pool);
        if reward > 0 {
            self.rewards.insert(asset.clone(), pool - reward);
            self.credit(BalanceKey { account: solver.clone(), asset: asset.clone() }, reward);
        }
        reward
    }
}
