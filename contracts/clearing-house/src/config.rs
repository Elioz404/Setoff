use near_sdk::json_types::U64;
use near_sdk::{env, near, require, NearToken};

/// Longest a round may stay open: one hour. Lines of the best proposal cannot
/// be paid while their round is open, so this bounds how long anyone, honest
/// or not, can hold back a payment by proposing a clearing.
pub const MAX_ROUND_DURATION_NS: u64 = 60 * 60 * 1_000_000_000;

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

/// Bytes a round's winner may add when it closes: its solver record and the
/// balance entry its reward goes to, each keyed by an account id of up to 64
/// bytes, with the per-entry overhead NEAR charges.
pub const WINNER_RECORD_BYTES: u64 = 2 * (40 + 4 + 64 + 64 + 32);

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
        require!(
            self.round_duration_ns.0 > 0 && self.round_duration_ns.0 <= MAX_ROUND_DURATION_NS,
            "round duration must be positive and at most one hour"
        );
        require!(
            self.max_reductions >= 2 && self.max_reductions <= MAX_REDUCTIONS_CAP,
            "max_reductions must be between 2 and 128"
        );
        require!(self.reward_bps <= 10_000, "reward_bps cannot exceed 10000");
        require!(
            self.proposal_bond >= self.proposal_storage_cost(),
            "proposal bond does not cover the storage of a full proposal and its winnings"
        );
    }

    /// Storage cost of the largest proposal this configuration allows, plus
    /// what its winner adds when the round closes. The bond covers both, so
    /// the contract never pays for a solver's storage out of its own balance.
    pub fn proposal_storage_cost(&self) -> NearToken {
        let bytes = PROPOSAL_BASE_BYTES
            + u64::from(self.max_reductions) * PROPOSAL_BYTES_PER_REDUCTION
            + WINNER_RECORD_BYTES;
        env::storage_byte_cost().saturating_mul(u128::from(bytes))
    }

    pub fn max_reductions(&self) -> usize {
        usize::try_from(self.max_reductions).unwrap_or(usize::MAX)
    }
}
