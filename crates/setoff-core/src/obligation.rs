/// Identifier of an obligation, unique within one clearing house.
pub type ObligationId = u64;

/// What a debtor still owes a creditor in one asset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Obligation<P, A> {
    pub debtor: P,
    pub creditor: P,
    pub asset: A,
    /// Amount still owed, in the asset's smallest unit.
    pub outstanding: u128,
}

/// Read access to the obligations that may take part in a clearing.
///
/// Implementations return `None` for an obligation that does not exist or is
/// not eligible (not yet accepted by its debtor, already discharged, and so
/// on), so the rules never have to know how eligibility is decided.
pub trait ObligationSource<P, A> {
    fn eligible(&self, id: ObligationId) -> Option<Obligation<P, A>>;
}

impl<P: Clone, A: Clone> ObligationSource<P, A>
    for std::collections::BTreeMap<ObligationId, Obligation<P, A>>
{
    fn eligible(&self, id: ObligationId) -> Option<Obligation<P, A>> {
        self.get(&id).filter(|o| o.outstanding > 0).cloned()
    }
}
