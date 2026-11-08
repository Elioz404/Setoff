use near_sdk::json_types::U64;
use near_sdk::{env, near, require, NearToken};

/// Upper bound on reductions per proposal, whatever the configuration says,
/// so that validating and applying a proposal always fits in one call.
pub const MAX_REDUCTIONS_CAP: u32 = 128;

/// Bytes a stored proposal may take per reduction: obligation id, amount, and
/// the vector entry around them.
pub const PROPOSAL_BYTES_PER_REDUCTION: u64 = 8 + 16;

/// Bytes a stored proposal takes besides its reductions: the solver's account
/// id (at most 64 bytes plus its length), the cleared total, the bond and the
/// deadline, with room for the round record around them.
pub const PROPOSAL_BASE_BYTES: u64 = 4 + 64 + 16 + 16 + 8 + 128;

/// Rules of a clearing house, fixed when it is deployed.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// How long a round stays open after its first proposal, in nanoseconds.
    pub round_duration_ns: U64,
    /// Most reductions one proposal may contain.
    pub max_reductions: u32,
    /// NEAR a solver locks with each proposal. It pays for the proposal's
    /// storage and is returned when the proposal is outbid or the round closes.
    pub proposal_bond: NearToken,
    /// Share of the cleared amount paid to the winning solver from the
    /// asset's reward pool, in basis points.
    pub reward_bps: u16,
}

impl Config {
    pub fn validate(&self) {
        require!(self.round_duration_ns.0 > 0, "round duration must be positive");
        require!(
            self.max_reductions >= 2 && self.max_reductions <= MAX_REDUCTIONS_CAP,
            "max_reductions must be between 2 and 128"
        );
        require!(self.reward_bps <= 10_000, "reward_bps cannot exceed 10000");
        require!(
            self.proposal_bond >= self.proposal_storage_cost(),
            "proposal bond does not cover the storage of a full proposal"
        );
    }

    /// Storage cost of the largest proposal this configuration allows.
    pub fn proposal_storage_cost(&self) -> NearToken {
        let bytes = PROPOSAL_BASE_BYTES + u64::from(self.max_reductions) * PROPOSAL_BYTES_PER_REDUCTION;
        env::storage_byte_cost().saturating_mul(u128::from(bytes))
    }

    pub fn max_reductions(&self) -> usize {
        usize::try_from(self.max_reductions).unwrap_or(usize::MAX)
    }
}
