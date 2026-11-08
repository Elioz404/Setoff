//! Property tests: any set of debt cycles clears, nothing else does, and a
//! clearing never changes what any party is owed on net.

use std::collections::BTreeMap;

use proptest::prelude::*;
use setoff_core::{validate_clearing, ClearingError, ClearingLimits, Obligation, ObligationId, Reduction};

type Book = BTreeMap<ObligationId, Obligation<u8, &'static str>>;

const LIMITS: ClearingLimits = ClearingLimits { max_reductions: 64 };

/// Debt cycles over up to eight parties: each is a list of distinct parties
/// (the debt runs from each to the next and back to the first) and an amount.
fn cycles() -> impl Strategy<Value = Vec<(Vec<u8>, u128)>> {
    let cycle = (Just((0u8..8).collect::<Vec<_>>()).prop_shuffle(), 2usize..=5, 1u128..1_000_000_000_000)
        .prop_map(|(parties, len, amount)| (parties[..len].to_vec(), amount));
    prop::collection::vec(cycle, 1..6)
}

/// Builds one obligation per cycle edge, each owing at least what its cycle
/// clears, and the clearing that cancels every cycle.
fn book_and_clearing(cycles: &[(Vec<u8>, u128)], slack: &[u128]) -> (Book, Vec<Reduction>) {
    let mut book = Book::new();
    let mut reductions = Vec::new();
    let mut id: ObligationId = 0;
    for (parties, amount) in cycles {
        for (i, &debtor) in parties.iter().enumerate() {
            let creditor = parties[(i + 1) % parties.len()];
            let extra = slack[usize::try_from(id).unwrap() % slack.len()];
            book.insert(id, Obligation { debtor, creditor, asset: "usd", outstanding: amount + extra });
            reductions.push(Reduction { obligation: id, amount: *amount });
            id += 1;
        }
    }
    (book, reductions)
}

fn net_positions(book: &Book) -> BTreeMap<u8, i128> {
    let mut net = BTreeMap::new();
    for o in book.values() {
        let amount = i128::try_from(o.outstanding).unwrap();
        *net.entry(o.creditor).or_insert(0) += amount;
        *net.entry(o.debtor).or_insert(0) -= amount;
    }
    net
}

proptest! {
    #[test]
    fn any_set_of_cycles_clears(cycles in cycles(), slack in prop::collection::vec(0u128..1_000_000, 1..8)) {
        let (book, reductions) = book_and_clearing(&cycles, &slack);
        let clearing = validate_clearing(&book, &"usd", &reductions, LIMITS).unwrap();
        let expected: u128 = reductions.iter().map(|r| r.amount).sum();
        prop_assert_eq!(clearing.cleared(), expected);
    }

    #[test]
    fn clearing_preserves_every_net_position(cycles in cycles(), slack in prop::collection::vec(0u128..1_000_000, 1..8)) {
        let (mut book, reductions) = book_and_clearing(&cycles, &slack);
        let before = net_positions(&book);
        let clearing = validate_clearing(&book, &"usd", &reductions, LIMITS).unwrap();
        for r in clearing.reductions() {
            let o = book.get_mut(&r.obligation).unwrap();
            o.outstanding -= r.amount;
        }
        prop_assert_eq!(net_positions(&book), before);
    }

    #[test]
    fn shaving_any_line_breaks_the_balance(
        cycles in cycles(),
        slack in prop::collection::vec(0u128..1_000_000, 1..8),
        pick in any::<prop::sample::Index>(),
    ) {
        let (book, mut reductions) = book_and_clearing(&cycles, &slack);
        let line = pick.index(reductions.len());
        prop_assume!(reductions[line].amount > 1);
        reductions[line].amount -= 1;
        let err = validate_clearing(&book, &"usd", &reductions, LIMITS).unwrap_err();
        let breaks_balance = matches!(err, ClearingError::NetPositionChanged { .. });
        prop_assert!(breaks_balance, "unexpected error: {:?}", err);
    }

    #[test]
    fn padding_any_line_is_refused(
        cycles in cycles(),
        slack in prop::collection::vec(0u128..1_000_000, 1..8),
        pick in any::<prop::sample::Index>(),
    ) {
        let (book, mut reductions) = book_and_clearing(&cycles, &slack);
        let line = pick.index(reductions.len());
        reductions[line].amount += 1;
        prop_assert!(validate_clearing(&book, &"usd", &reductions, LIMITS).is_err());
    }
}
