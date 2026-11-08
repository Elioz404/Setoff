use std::collections::{BTreeMap, BTreeSet};

use crate::{ClearingError, ObligationId, ObligationSource};

/// One line of a proposed clearing: reduce `obligation` by `amount`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reduction {
    pub obligation: ObligationId,
    pub amount: u128,
}

/// Bounds a clearing must respect, so that checking it stays cheap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClearingLimits {
    pub max_reductions: usize,
}

/// A clearing that passed every rule against the obligations it was checked
/// with. It can only be built by [`validate_clearing`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidatedClearing {
    reductions: Vec<Reduction>,
    cleared: u128,
}

impl ValidatedClearing {
    pub fn reductions(&self) -> &[Reduction] {
        &self.reductions
    }

    /// Total amount of debt the clearing removes, summed over its reductions.
    pub fn cleared(&self) -> u128 {
        self.cleared
    }
}

/// What a clearing takes off one party, on each side of its books.
#[derive(Default)]
struct Movement {
    owes_less: u128,
    is_owed_less: u128,
}

/// Checks a proposed clearing of obligations in `asset`.
///
/// The clearing is accepted only if every reduction targets a distinct,
/// eligible obligation in that asset, is positive and does not exceed what is
/// outstanding, and if every party stops owing exactly as much as it stops
/// being owed. That last rule is what makes the clearing a set-off: nobody
/// gains or loses, so the clearing needs no payment and no trust in whoever
/// proposed it.
pub fn validate_clearing<P, A, S>(
    source: &S,
    asset: &A,
    reductions: &[Reduction],
    limits: ClearingLimits,
) -> Result<ValidatedClearing, ClearingError<P>>
where
    P: Ord + Clone,
    A: Eq,
    S: ObligationSource<P, A>,
{
    if reductions.is_empty() {
        return Err(ClearingError::Empty);
    }
    if reductions.len() > limits.max_reductions {
        return Err(ClearingError::TooManyReductions { max: limits.max_reductions, got: reductions.len() });
    }

    let mut seen = BTreeSet::new();
    let mut movements: BTreeMap<P, Movement> = BTreeMap::new();
    let mut cleared: u128 = 0;

    for reduction in reductions {
        let id = reduction.obligation;
        if !seen.insert(id) {
            return Err(ClearingError::DuplicateObligation(id));
        }
        if reduction.amount == 0 {
            return Err(ClearingError::ZeroAmount(id));
        }
        let obligation = source.eligible(id).ok_or(ClearingError::IneligibleObligation(id))?;
        if obligation.debtor == obligation.creditor {
            return Err(ClearingError::IneligibleObligation(id));
        }
        if obligation.asset != *asset {
            return Err(ClearingError::AssetMismatch(id));
        }
        if reduction.amount > obligation.outstanding {
            return Err(ClearingError::ExceedsOutstanding {
                obligation: id,
                outstanding: obligation.outstanding,
                requested: reduction.amount,
            });
        }

        let debtor = movements.entry(obligation.debtor).or_default();
        debtor.owes_less = add(debtor.owes_less, reduction.amount)?;
        let creditor = movements.entry(obligation.creditor).or_default();
        creditor.is_owed_less = add(creditor.is_owed_less, reduction.amount)?;
        cleared = add(cleared, reduction.amount)?;
    }

    if let Some((party, _)) = movements.iter().find(|(_, m)| m.owes_less != m.is_owed_less) {
        return Err(ClearingError::NetPositionChanged { party: party.clone() });
    }

    Ok(ValidatedClearing { reductions: reductions.to_vec(), cleared })
}

fn add<P>(a: u128, b: u128) -> Result<u128, ClearingError<P>> {
    a.checked_add(b).ok_or(ClearingError::Overflow)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::Obligation;

    const LIMITS: ClearingLimits = ClearingLimits { max_reductions: 16 };

    fn book(
        entries: &[(ObligationId, &'static str, &'static str, u128)],
    ) -> BTreeMap<ObligationId, Obligation<&'static str, &'static str>> {
        entries
            .iter()
            .map(|&(id, debtor, creditor, outstanding)| {
                (id, Obligation { debtor, creditor, asset: "usd", outstanding })
            })
            .collect()
    }

    fn r(obligation: ObligationId, amount: u128) -> Reduction {
        Reduction { obligation, amount }
    }

    /// A owes B 100, B owes C 80, C owes A 60.
    fn triangle() -> BTreeMap<ObligationId, Obligation<&'static str, &'static str>> {
        book(&[(1, "a", "b", 100), (2, "b", "c", 80), (3, "c", "a", 60)])
    }

    #[test]
    fn a_cycle_clears_by_its_smallest_debt() {
        let clearing =
            validate_clearing(&triangle(), &"usd", &[r(1, 60), r(2, 60), r(3, 60)], LIMITS).unwrap();
        assert_eq!(clearing.cleared(), 180);
        assert_eq!(clearing.reductions().len(), 3);
    }

    #[test]
    fn an_unbalanced_clearing_names_the_first_party_it_harms() {
        let err =
            validate_clearing(&triangle(), &"usd", &[r(1, 60), r(2, 50), r(3, 60)], LIMITS).unwrap_err();
        assert_eq!(err, ClearingError::NetPositionChanged { party: "b" });
    }

    #[test]
    fn a_path_that_does_not_close_is_refused() {
        let err = validate_clearing(&triangle(), &"usd", &[r(1, 10), r(2, 10)], LIMITS).unwrap_err();
        assert_eq!(err, ClearingError::NetPositionChanged { party: "a" });
    }

    #[test]
    fn reducing_more_than_is_owed_is_refused() {
        let err =
            validate_clearing(&triangle(), &"usd", &[r(1, 70), r(2, 70), r(3, 70)], LIMITS).unwrap_err();
        assert_eq!(err, ClearingError::ExceedsOutstanding { obligation: 3, outstanding: 60, requested: 70 });
    }

    #[test]
    fn each_rule_is_enforced() {
        let t = triangle();
        let usd = &"usd";
        assert_eq!(validate_clearing(&t, usd, &[], LIMITS).unwrap_err(), ClearingError::Empty);
        assert_eq!(
            validate_clearing(&t, usd, &[r(1, 1), r(1, 1)], LIMITS).unwrap_err(),
            ClearingError::DuplicateObligation(1)
        );
        assert_eq!(validate_clearing(&t, usd, &[r(1, 0)], LIMITS).unwrap_err(), ClearingError::ZeroAmount(1));
        assert_eq!(
            validate_clearing(&t, usd, &[r(9, 1)], LIMITS).unwrap_err(),
            ClearingError::IneligibleObligation(9)
        );
        assert_eq!(
            validate_clearing(&t, &"eur", &[r(1, 1)], LIMITS).unwrap_err(),
            ClearingError::AssetMismatch(1)
        );
        assert_eq!(
            validate_clearing(&t, usd, &[r(1, 1), r(2, 1), r(3, 1)], ClearingLimits { max_reductions: 2 })
                .unwrap_err(),
            ClearingError::TooManyReductions { max: 2, got: 3 }
        );
    }

    #[test]
    fn a_discharged_obligation_is_not_eligible() {
        let mut t = triangle();
        t.get_mut(&3).unwrap().outstanding = 0;
        let err = validate_clearing(&t, &"usd", &[r(3, 1)], LIMITS).unwrap_err();
        assert_eq!(err, ClearingError::IneligibleObligation(3));
    }

    #[test]
    fn an_obligation_to_oneself_is_not_eligible() {
        let t = book(&[(1, "a", "a", 10)]);
        let err = validate_clearing(&t, &"usd", &[r(1, 10)], LIMITS).unwrap_err();
        assert_eq!(err, ClearingError::IneligibleObligation(1));
    }

    #[test]
    fn overflowing_sums_are_refused_not_wrapped() {
        let t =
            book(&[(1, "a", "b", u128::MAX), (2, "b", "a", u128::MAX), (3, "a", "b", 1), (4, "b", "a", 1)]);
        let err =
            validate_clearing(&t, &"usd", &[r(1, u128::MAX), r(2, u128::MAX), r(3, 1), r(4, 1)], LIMITS)
                .unwrap_err();
        assert_eq!(err, ClearingError::Overflow);
    }
}
