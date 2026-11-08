use std::fmt;

use crate::ObligationId;

/// Why a proposed clearing was refused. Each variant names the first rule
/// that failed, so a solver can tell exactly what to fix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClearingError<P> {
    Empty,
    TooManyReductions { max: usize, got: usize },
    DuplicateObligation(ObligationId),
    ZeroAmount(ObligationId),
    IneligibleObligation(ObligationId),
    AssetMismatch(ObligationId),
    ExceedsOutstanding { obligation: ObligationId, outstanding: u128, requested: u128 },
    NetPositionChanged { party: P },
    Overflow,
}

impl<P: fmt::Debug> fmt::Display for ClearingError<P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "the clearing reduces nothing"),
            Self::TooManyReductions { max, got } => {
                write!(f, "the clearing has {got} reductions, the limit is {max}")
            }
            Self::DuplicateObligation(id) => write!(f, "obligation {id} appears more than once"),
            Self::ZeroAmount(id) => write!(f, "obligation {id} is reduced by zero"),
            Self::IneligibleObligation(id) => {
                write!(f, "obligation {id} does not exist or cannot be cleared")
            }
            Self::AssetMismatch(id) => write!(f, "obligation {id} is in another asset"),
            Self::ExceedsOutstanding { obligation, outstanding, requested } => write!(
                f,
                "obligation {obligation} has {outstanding} outstanding, the clearing asks for {requested}"
            ),
            Self::NetPositionChanged { party } => {
                write!(f, "the clearing changes the net position of {party:?}")
            }
            Self::Overflow => write!(f, "amounts overflow"),
        }
    }
}

impl<P: fmt::Debug> std::error::Error for ClearingError<P> {}
